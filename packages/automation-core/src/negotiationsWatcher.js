/**
 * negotiationsWatcher.js — оркестрация чатов ОДНОГО арендатора: отвечаем, когда сообщений
 * стало больше, чем мы сами сохранили в прошлый раз, И последнее из них — от работодателя.
 *
 * Осознанно не различаем "новый тред"/"существующий" отдельной веткой — на новый тред
 * HR-бот hh.ru иногда успевает ответить (join-событие + вопрос) ДО того, как мы вообще
 * первый раз посмотрели тред, и первый снимок уже мог содержать непрочитанный вопрос.
 * Решение "отвечать или нет" единое: смотрим только на то, кто последний.
 *
 * Защита от зацикливания: рост числа сообщений считаем от того, что storage сам сохранил
 * в прошлый раз (входящие и исходящие дописываются туда сразу после отправки) — не зависит
 * от того, правильно ли DOM классифицировал "своё"/"чужое". Отдельно: некоторые скринер-боты
 * переспрашивают БУКВАЛЬНО тот же вопрос заново (ждут кнопку, не текст) — сравниваем новое
 * сообщение работодателя (без приклеенного времени в конце, оно меняется) со всей историей
 * входящих в треде; повтор — не отвечаем, шлём алерт один раз, не на каждый цикл.
 *
 * @typedef {Object} NegotiationStorage
 * @property {(tenantId, negotiationId) => Promise<{messages: Array, vacancyId?: string, loopDetected?: boolean, vacancyTitle?: string, company?: string}|null>} getNegotiation
 * @property {(tenantId, negotiationId, fields: object) => Promise<void>} saveNegotiation
 * @property {(tenantId, vacancyId) => Promise<{resumeProfile: string, title: string, company: string, description: string}|null>} getVacancyByVacancyId
 */

const { fetchActiveThreads, fetchThreadMessages, sendReply, fetchInterviewCount } = require('./hh/negotiations');
const {
  classifyEmployerMessage, extractLinks, detectInterviewInvite, isScreenerBotThread, looksLikeAiSuspicion,
  looksLikeScheduling, rejectedInTail, employerTail, looksLikeClosedQuestion, messageBody,
} = require('./employerMessage');
const { runExternalStage } = require('./external/externalStage');
const { fetchResumeText } = require('./hh/resume');
const { loadExclusions } = require('./exclusions');
const { generateReply, deliverClarificationAnswer } = require('./replyAgent');
const { assessVacancyFit } = require('./vacancyMatch');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function normalizeForDedup(text) {
  return String(text || '').replace(/\s*\d{1,2}:\d{2}\s*$/, '').trim();
}

// Текст-ошибка AI-провайдера, по ошибке отправленный в чат под нагрузкой: «Что-то пошло
// не так. Искусственному интеллекту не удалось создать ответ.». Такое НЕ считаем нашим
// ответом — вычищаем из истории, чтобы система вернулась и ответила по-человечески.
const { isAiErrorText } = require('./llm/aiErrorText');

// Выбор резюме для чата, вакансию которого не удалось точно сопоставить (несколько
// резюме, а vacancyId нет в локальной БД). Раньше такие чаты просто молчали — и копились
// непрочитанными. Берём резюме с наибольшим пересечением слов названия вакансии и
// названия резюме; если пересечений нет — первое. Ответить хоть от какого-то резюме
// важнее, чем оставить работодателя без ответа.
function pickBestResumeKey(vacancyTitle, resumeProfiles) {
  const list = Array.isArray(resumeProfiles) ? resumeProfiles.filter((r) => r && r.key) : [];
  if (!list.length) return null;
  const tokens = (s) => new Set(String(s || '').toLowerCase().match(/[a-zа-яё0-9+#.]{3,}/gi) || []);
  const want = tokens(vacancyTitle);
  let best = list[0].key;
  let bestScore = -1;
  for (const rp of list) {
    const have = tokens(rp.label);
    let score = 0;
    for (const t of want) if (have.has(t)) score += 1;
    if (score > bestScore) { bestScore = score; best = rp.key; }
  }
  return best;
}

/**
 * @param {{
 *   tenantId: string, browserCtx: object, storage: NegotiationStorage, llmClient: object,
 *   profile: import('./coverLetter').TenantProfile, notifier: object,
 *   resumeUrlsByProfile: Record<string, string>,
 * }} opts
 */
async function runOnce(opts) {
  const {
    tenantId, browserCtx, storage, llmClient, profile, notifier, resumeUrlsByProfile, resumeProfiles = [],
    // Автопрохождение внешних анкет — по согласию человека. Выключено: ссылки просто
    // уходят ему уведомлением, автопилот в чужие формы не лезет.
    externalStageEnabled = false,
    // Технический журнал («Технические подробности» в лаунчере): сюда сыплем ВСЕ
    // сигналы — попытки, успехи, фейлы. Без этого «отвечено 0» немо, а фейлы отправки
    // видел только stdout, которого в собранном лаунчере никто не видит.
    log = () => {},
    // Проверяется между тредами (см. цикл ниже) — как и в applyJob.js: кнопка
    // «Остановить» раньше гасила только таймер следующего круга, а уже идущий обход
    // всех чатов доигрывал до конца (реальные ответы продолжали уходить работодателям).
    // Уже начатый ответ на текущий тред не прерываем — только не берём следующий.
    shouldStop = () => false,
  } = opts;

  let threads;
  try {
    threads = await fetchActiveThreads(browserCtx);
  } catch (e) {
    if (e.message === 'LOGGED_OUT') {
      await notifier.notifyAlert('Сессия hh.ru слетела (чаты). Нужен повторный вход.');
      return { checked: 0, replied: 0, failedToList: true };
    }
    console.warn(`⚠️ negotiationsWatcher(${tenantId}): не удалось получить список чатов:`, e.message);
    return { checked: 0, replied: 0, failedToList: true };
  }

  let replied = 0;
  // Считаем причины пропуска: без этого «отвечено 0» неотличимо от «наблюдатель
  // сломался», и понять, что чинить, можно только вслепую.
  const skipped = {
    noNewMessages: 0,   // последнее слово за нами — отвечать не на что
    alreadyReplied: 0,  // на это сообщение уже отвечали
    rejection: 0,       // отказ
    hhUnavailable: 0,   // системное сообщение hh.ru — работодатель заблокирован/на проверке
    ack: 0,             // вежливая отписка без вопроса
    loop: 0,            // скринер повторяет один и тот же вопрос
    noMatch: 0,         // не нашли, каким резюме отвечать
    failed: 0,          // ошибка чтения/отправки (ретраибельная — попробуем ещё)
    handedOff: 0,       // сдались после N попыток и передали человеку (больше не долбим)
    // Раньше шёл в failed ("ретраибельная ошибка") — а это финальное, не ретраибельное
    // состояние (архивная вакансия/работодатель отключил переписку), просто другой
    // повод, чем rejection/hhUnavailable. Смешение с failed мешало приоритетной фазе
    // сходиться (см. scheduler.js: chat.failed===0 — условие схождения) на аккаунте, где
    // такие чаты держатся месяцами.
    vacancyClosed: 0,
    excluded: 0,        // в «Исключениях»: переписку ведёт человек, мы не пишем ничего
  };
  // Сколько раз пытаемся ОТПРАВИТЬ ответ по одному и тому же сообщению, прежде чем
  // сдаться и передать человеку. Без предела чат без поля ввода (REPLY_FIELD_NOT_FOUND)
  // ретраился каждый круг вечно и на каждом круге спамил лог и уведомления.
  const MAX_SEND_ATTEMPTS = 3;

  // Сколько раз ОТВЕЧАЕМ на один и тот же повторяющийся текст работодателя, прежде чем
  // признать, что скринер-бот зациклился (ждёт нажатия кнопки в интерфейсе, а не текст),
  // и передать человеку. До этого предела отвечаем — последнее слово всегда за нами.
  const MAX_SAME_REPLIES = 3;

  // Большинство тредов (отказ, "последнее слово за нами", уже решённый "чужой стек")
  // обрабатываются МОЛЧА — без единой строки в лог, см. log() ниже по функции. На
  // живом аккаунте с сотнями чатов это давало 15-20 минут полной тишины в «Технических
  // подробностях», хотя система вовсю работала — выглядело неотличимо от зависания
  // (жалоба: "прошло 20 минут, ничего не происходит"). Раз в минуту — короткий сигнал
  // "я жив, вот сколько прошёл", а не только реальные события.
  const HEARTBEAT_MS = 60 * 1000;
  let lastHeartbeatAt = Date.now();
  let checkedCount = 0;

  for (const thread of threads) {
    checkedCount += 1;
    if (Date.now() - lastHeartbeatAt > HEARTBEAT_MS) {
      lastHeartbeatAt = Date.now();
      log(`📡 Разбираю чаты дальше — ${checkedCount} из ${threads.length}, ответил ${replied}` +
        ` (тихо, потому что пока без новых сообщений/отказы/уже решённые — это не зависание).`);
    }
    if (shouldStop()) {
      log('⏹ Остановлено пользователем — прекращаю после уже начатого, новые чаты не беру.');
      // return, а не break — checked считается по факту (indexOf), а не threads.length
      // после цикла, как в остальных ранних выходах этого цикла (см. LOGGED_OUT ниже).
      return { checked: threads.indexOf(thread), replied, skipped };
    }

    let doc = await storage.getNegotiation(tenantId, thread.negotiationId);
    if (!doc) doc = { messages: [], vacancyTitle: thread.label, company: thread.company };

    // «Исключения»: переписку ведёт сам человек. Тред даже не открываем — иначе hh снимет у
    // него пометку «непрочитано», — и ничего не пишем (см. exclusions.js).
    let isExcluded = await loadExclusions(storage, tenantId);
    if (isExcluded({ negotiationId: thread.negotiationId, vacancyId: doc.vacancyId, company: thread.company || doc.company })) {
      skipped.excluded += 1;
      continue;
    }

    // hh сам говорит "непрочитанных нет" прямо в списке чатов (см. hasUnread в
    // hh/negotiations.js — data-qa="chatik-info-badges", реальный счётчик hh, а не наша
    // догадка). Если мы уже хоть раз успешно читали этот тред (doc.messages непустой —
    // НЕ doc.lastRepliedTo: у большинства откликов работодатель вообще не отвечал, и
    // такие треды это поле никогда не получают, хотя мы их уже проверяли) и не ждём
    // хвостов ЗА СОБОЙ (не застряли на отправке, не ждём ответа человека на уточнение) —
    // верим hh на слово и не тратим реальную навигацию: живой тест показал ~3-4с на
    // тред, а тредов может быть 500+, из-за чего приоритетная фаза душила поиск новых
    // вакансий часами. Бейдж гасится самим ЖЕ открытием чата, поэтому это НЕ проверка
    // "надо ли отвечать" (это по-прежнему решает код ниже, по факту сообщения) — только
    // "стоит ли вообще идти смотреть". Новым тредам (doc ещё нет) это не грозит.
    // readAt — то же «уже читали» для тредов, где читаемых сообщений нет вовсе (отклик без
    // письма: в чате только служебные строки, их мы с 1.0.17 не считаем сообщениями).
    if ((doc.messages?.length > 0 || doc.readAt) && !thread.hasUnread && !doc.replyFailFor && !doc.pendingClarificationFor) {
      skipped.noNewMessages += 1;
      continue;
    }

    let fetched;
    try {
      fetched = await fetchThreadMessages(browserCtx, thread.href);
    } catch (e) {
      if (e.message === 'LOGGED_OUT') {
        await notifier.notifyAlert('Сессия hh.ru слетела (чтение чата). Нужен повторный вход.');
        return { checked: threads.indexOf(thread), replied };
      }
      console.warn(`⚠️ negotiationsWatcher(${tenantId}): не удалось прочитать тред ${thread.href}:`, e.message);
      skipped.failed += 1;
      continue;
    }

    const vacancyId = fetched.vacancyId || doc.vacancyId;
    // Вакансию из чата узнаём только после чтения: исключение могли добавить ссылкой на неё.
    if (isExcluded({ vacancyId })) {
      skipped.excluded += 1;
      continue;
    }
    // hh показывал непрочитанное, а сообщений работодателя мы не нашли — парсер их потерял.
    // Отвечать вслепую нечего (и не будем), но в журнале это должно быть видно.
    if (thread.hasUnread && fetched.layout) {
      log(`⚠️ «${doc.vacancyTitle || thread.label}»: hh показывает новое сообщение, но прочитать его не вышло — `
        + `вслепую не отвечаю (вёрстка hh: ${fetched.layout}): ${thread.href}`);
    }

    // Вычищаем НАШИ прежние ответы-ошибки («Что-то пошло не так…», улетевшие под нагрузкой):
    // не считаем их ответом и не тащим в контекст генерации. После этого последним снова
    // окажется вопрос работодателя — и система вернётся к нему и ответит нормально. Если
    // такой мусор был последним, снимаем и стопор повтора (lastRepliedTo/repliedSameCount),
    // чтобы точно переответить, а не счесть тред «уже отвеченным».
    if ((fetched.messages || []).some((m) => m && m.from !== 'employer' && isAiErrorText(m.text))) {
      const tailWasError = fetched.messages.length
        && fetched.messages[fetched.messages.length - 1].from !== 'employer'
        && isAiErrorText(fetched.messages[fetched.messages.length - 1].text);
      fetched.messages = fetched.messages.filter((m) => !(m && m.from !== 'employer' && isAiErrorText(m.text)));
      if (tailWasError) doc = { ...doc, lastRepliedTo: null, repliedSameCount: 0 };
    }

    const lastMsg = fetched.messages[fetched.messages.length - 1];
    // 📅 Тред «у человека». Разговор о времени созвона (и подозрение «это пишет ИИ») ИИ
    // не ведёт вообще: пока человек не ответил, весь тред его — новые сообщения работодателя
    // тоже уходят ему, автопилот здесь не пишет ни слова. Поэтому любое сообщение со
    // стороны кандидата ПОСЛЕ переданного — заведомо ответ самого человека (прямо в hh):
    // закрываем его вопросы в «Нужен ваш ответ» — здесь и на сайте, — иначе они висели
    // бы вечно, а ответ, введённый туда позже, ушёл бы работодателю устаревшим дублем.
    // Отдельная метка не нужна: удержание выводится из текста переданного сообщения.
    const heldFor = doc.pendingClarificationFor
      && (looksLikeScheduling(doc.pendingClarificationFor) || looksLikeAiSuspicion(doc.pendingClarificationFor))
      ? doc.pendingClarificationFor : null;
    let held = Boolean(heldFor);
    if (held) {
      const msgs = fetched.messages;
      let idx = -1;
      for (let i = msgs.length - 1; i >= 0; i -= 1) {
        if (msgs[i] && msgs[i].from === 'employer' && normalizeForDedup(msgs[i].text) === heldFor) { idx = i; break; }
      }
      // Переданного сообщения в загруженной истории уже нет — переписка ушла далеко
      // вперёд, человек её явно вёл сам. Тоже отпускаем.
      const humanReply = idx === -1
        ? { text: '' }
        : msgs.slice(idx + 1).find((m) => m && m.from !== 'employer');
      if (humanReply) {
        held = false;
        doc = { ...doc, pendingClarificationFor: null };
        await storage.saveNegotiation(tenantId, thread.negotiationId, { pendingClarificationFor: null });
        const closed = (await storage.closeClarificationsAnsweredInChat?.(tenantId, thread.negotiationId, humanReply.text)) || [];
        for (const c of closed) {
          await notifier.notifyClarificationDelivered?.({
            negotiationId: thread.negotiationId, question: c.question, sentText: humanReply.text,
          });
        }
        if (closed.length) log(`✅ «${doc.vacancyTitle}»: вы ответили работодателю сами — убрал вопрос из «Нужен ваш ответ».`);
      }
    }

    if (!lastMsg || lastMsg.from !== 'employer') {
      skipped.noNewMessages += 1;
      await storage.saveNegotiation(tenantId, thread.negotiationId, {
        messages: fetched.messages, vacancyId, vacancyTitle: doc.vacancyTitle, company: doc.company,
      });
      continue;
    }

    const lastNormalized = normalizeForDedup(lastMsg.text);

    // Отвечать решаем ПО ПОСЛЕДНЕМУ сообщению: если последним написал работодатель
    // (проверено выше) — значит, слово за нами, отвечаем. Дедупа «уже отвечали на этот
    // текст → молчим» здесь БОЛЬШЕ НЕТ: из-за неё, когда скринер-бот повторял тот же
    // вопрос, мы замолкали и оставляли сообщение без ответа. От повторной отправки
    // одного и того же в один круг сторожит проверка «последним писал не работодатель»
    // выше (наш ответ уже в треде, sendReply это подтверждает), а от бесконечного спама
    // на зациклившегося бота — счётчик repliedSameCount ниже.
    // Сколько раз мы уже ответили ИМЕННО на этот повторяющийся текст.
    const sameReplies = doc.lastRepliedTo === lastNormalized ? (doc.repliedSameCount || 0) : 0;

    // По этому сообщению мы уже сдались (за MAX_SEND_ATTEMPTS так и не нашли поле ввода
    // и т.п.) и передали человеку — молча пропускаем, не долбим и не спамим алертами.
    // Как только работодатель напишет НОВОЕ сообщение, lastNormalized сменится и мы
    // снова попробуем: gave_up относится строго к конкретному тексту.
    if (doc.replyGaveUpFor === lastNormalized) {
      skipped.handedOff += 1;
      await storage.saveNegotiation(tenantId, thread.negotiationId, {
        messages: fetched.messages, vacancyId, vacancyTitle: doc.vacancyTitle, company: doc.company,
      });
      continue;
    }

    // По этому сообщению уже спросили человека (см. needsHuman ниже) и ждём его ответа —
    // не долбим AI-провайдер запросом заново каждый круг и не шлём holding-фразу повторно.
    // Как только работодатель напишет НОВОЕ сообщение, lastNormalized сменится сам.
    if (doc.pendingClarificationFor === lastNormalized) {
      skipped.handedOff += 1;
      await storage.saveNegotiation(tenantId, thread.negotiationId, {
        messages: fetched.messages, vacancyId, vacancyTitle: doc.vacancyTitle, company: doc.company,
      });
      continue;
    }

    // Уже решили «чужой стек» ИЛИ «чат закрыт» ИМЕННО по этому сообщению — вердикт не
    // изменится, пока работодатель не напишет новое сообщение (а если чат правда закрыт,
    // он физически не может). Живой тест: 494 треда, автопилот 10 минут подряд
    // ПЕРЕОЦЕНИВАЛ уже известные исходы по кругу (для stack_mismatch — навигация за
    // резюме + вызов LLM на КАЖДЫЙ; для vacancy_closed — тот же ПОЛНЫЙ путь, потому что
    // сохранение раньше не обновляло messages, и локальная копия навсегда думала, что
    // сообщение работодателя новое) и ни разу не дошёл ни до настоящего ответа, ни до
    // новых вакансий. Короткое замыкание — тот же лёгкий путь, что и у rejection выше.
    if (
      (doc.outcome === 'stack_mismatch' || doc.outcome === 'vacancy_closed')
      && doc.lastRepliedTo === lastNormalized
    ) {
      skipped.noMatch += 1;
      await storage.saveNegotiation(tenantId, thread.negotiationId, {
        messages: fetched.messages, vacancyId, vacancyTitle: doc.vacancyTitle, company: doc.company,
      });
      continue;
    }

    // Отказ ищем во всех сообщениях работодателя после нашего последнего, а не только в
    // самом свежем: живой случай 06.10.2026 — письмо с отказом и следом метка hh «Отказ»,
    // а ИИ ответил «буду ждать результатов рассмотрения».
    let kind = classifyEmployerMessage(lastMsg.text);
    if (kind.kind !== 'rejection' && kind.kind !== 'hh_unavailable' && rejectedInTail(fetched.messages)) {
      kind = { ...kind, kind: 'rejection', why: 'отказ среди новых сообщений работодателя' };
    }

    // Ссылки на анкеты ищем во ВСЕХ сообщениях работодателя, а не только в последнем.
    // Раньше форму замечали, лишь если ссылка была в самом свежем сообщении; но её
    // часто присылают раньше, а последним приходит системное «Собеседование» без
    // ссылки — и анкета так и оставалась незаполненной (в проде — 0 заполнений).
    //
    // Состояние анкет ведём РАЗДЕЛЬНО, чтобы система точно знала, что заполнено, а что
    // нет: filled — реально отправленные нами (это и есть правда «форма заполнена»),
    // escalated — те, что мы не смогли пройти и отдали человеку (не повторяем, но и
    // «заполненными» не считаем). Старое поле externalStageUrls валило всё в кучу —
    // проваленная анкета помечалась «сделано» и не отличалась от отправленной.
    const filledUrls = new Set([...(doc.externalStageFilled || []), ...(doc.externalStageUrls || [])]);
    const escalatedUrls = new Set(doc.externalStageEscalated || []);
    const doneUrls = new Set([...filledUrls, ...escalatedUrls]);
    const allEmployerLinks = fetched.messages
      .filter((m) => m && m.from === 'employer')
      .flatMap((m) => extractLinks(m.text));
    const freshLinks = [...new Set(allEmployerLinks)].filter((u) => !doneUrls.has(u));

    // ЕДИНСТВЕННАЯ причина замолчать по воле работодателя — явный ОТКАЗ: спорить с
    // отказом нельзя и незачем. На всё остальное — вопросы, вежливое «спасибо,
    // рассмотрим» (ack), повторы — мы ОТВЕЧАЕМ: последнее слово всегда за нами, ни
    // одного сообщения работодателя без ответа (пока отвечать в принципе можно).
    if (kind.kind === 'rejection') {
      skipped.rejection += 1;
      // Самоочистка: если по этому треду раньше ошибочно зажглось «приглашение на созвон»
      // (детектор до фикса путал «НЕ можем пригласить…» с приглашением), гасим его — отказ
      // не может быть победой. Так ложная плашка уходит из лаунчера сама на следующем круге.
      const clearInvite = doc.interviewInviteAt ? { interviewInviteAt: null } : {};
      // Отказ со ссылкой («если считаете, что это ошибка, заполните анкету») — второй шанс.
      // Отвечать на отказ не будем, но и хоронить его молча нельзя: решает человек.
      const tailLinks = [...new Set(employerTail(fetched.messages).flatMap((m) => extractLinks(m.text)))]
        .filter((u) => !doneUrls.has(u));
      if (tailLinks.length) {
        const question = `Работодатель отказал, но оставил ссылку: ${tailLinks[0]}. Решите сами, стоит ли по ней что-то делать.`;
        if (!(await storage.hasOpenClarification?.(tenantId, thread.negotiationId, question))) {
          log(`🔗 «${doc.vacancyTitle}»: отказ со ссылкой — не отвечаю, решать вам: ${thread.href}`);
          await storage.createClarification?.(tenantId, {
            negotiationId: thread.negotiationId, vacancyTitle: doc.vacancyTitle, company: doc.company,
            url: thread.href, question, history: fetched.messages,
          });
          await notifier.notifyClarificationNeeded?.({
            tenantId, negotiationId: thread.negotiationId, vacancyTitle: doc.vacancyTitle,
            company: doc.company, question, url: thread.href,
          });
        }
      }
      await storage.saveNegotiation(tenantId, thread.negotiationId, {
        messages: fetched.messages, vacancyId, vacancyTitle: doc.vacancyTitle, company: doc.company,
        lastRepliedTo: lastNormalized, outcome: 'rejection', ...clearInvite,
      });
      continue;
    }

    // Системное сообщение hh.ru («работодатель проходит проверку/заблокирован, переписка
    // недоступна») — это ограничение самой площадки, а не вопрос от человека. Отвечать
    // нечего и незачем: молча пропускаем, не заводим needsHuman и не трогаем interviewInviteAt
    // (в отличие от отказа, это не отменяет ранее подтверждённую победу по этому треду).
    if (kind.kind === 'hh_unavailable') {
      skipped.hhUnavailable += 1;
      await storage.saveNegotiation(tenantId, thread.negotiationId, {
        messages: fetched.messages, vacancyId, vacancyTitle: doc.vacancyTitle, company: doc.company,
        lastRepliedTo: lastNormalized,
      });
      continue;
    }

    // 🎉 ПОБЕДА ПЕРВИЧНОГО ЭТАПА: в чате подтвердилось приглашение на созвон/собеседование.
    // Фиксируем это ОДИН раз (interviewInviteAt) — блок «Приглашения» в лаунчере и на сайте
    // берёт отсюда, и он переживает перезапуск лаунчера (локальная БД + отчёт на сервер).
    // Отвечать на само приглашение ИИ не будет — это разговор о времени, см. ниже.
    // Отдельный флаг, чтобы не слать «победу» повторно на каждый круг.
    const isNewInterviewInvite = !doc.interviewInviteAt && detectInterviewInvite(lastMsg.text);
    if (isNewInterviewInvite) {
      const inviteVacancy = (vacancyId ? await storage.getVacancyByVacancyId(tenantId, vacancyId) : null);
      const inviteTitle = inviteVacancy?.title || doc.vacancyTitle || thread.label;
      const inviteCompany = inviteVacancy?.company || doc.company || thread.company || '';
      await storage.saveNegotiation(tenantId, thread.negotiationId, {
        vacancyId, vacancyTitle: inviteTitle, company: inviteCompany,
        interviewInviteAt: new Date(), outcome: 'interview',
      });
      doc.interviewInviteAt = Date.now();
      log(`🎉 «${inviteTitle}»${inviteCompany ? ` (${inviteCompany})` : ''}: приглашают на созвон/собеседование! Слово за вами: ${thread.href}`);
      await notifier.notifyInterviewInvite?.({
        tenantId, vacancyTitle: inviteTitle, company: inviteCompany,
        url: thread.href, incomingText: lastMsg.text,
      });
    }

    // 📅 Разговор о времени созвона — ИИ не отвечает ВООБЩЕ, даже не вызываем модель.
    // Сюда же — подозрение «это пишет ИИ» и любое новое сообщение в удерживаемом треде.
    // Время выбирает только сам кандидат: живой случай — автопилот согласился за него на
    // «сегодня в 19:00» и придумал «в будни после 15:00». Вопрос уходит в «Нужен ваш ответ»
    // (лаунчер + сайт): человек отвечает там или прямо в hh — во втором случае вопрос
    // закроется сам (см. ветку «последнее слово за кандидатом» выше). Стоит ДО фильтра
    // чужого стека: раз работодатель назначает время, решать это человеку, а не фильтру.
    const aboutTime = looksLikeScheduling(lastMsg.text);
    const aiSuspected = !aboutTime && looksLikeAiSuspicion(lastMsg.text);
    if (held || aboutTime || aiSuspected) {
      const quote = `«${messageBody(lastMsg).slice(0, 200)}»`;
      // Подозрение «это ИИ» — сюда же: любой автоматический ответ только подтвердит его
      // (живой случай — модель выдумала «технический сбой с шаблонами автоответов»).
      // Без приписки «Ответьте сами — здесь или прямо в чате hh»: что отвечать нужно самому,
      // и так ясно из раздела «Нужен ваш ответ» (просьба владельца 06.10.2026).
      const question = aboutTime ? `Работодатель о времени созвона: ${quote}.`
        : aiSuspected ? `Работодатель подозревает, что ему отвечает ИИ: ${quote}. Лучше ответить самому — автоматический ответ здесь только навредит.`
          : `Работодатель дописал, пока тред ждёт вашего ответа: ${quote}.`;
      if (typeof storage.hasOpenClarification === 'function'
        && await storage.hasOpenClarification(tenantId, thread.negotiationId, question)) {
        skipped.handedOff += 1;
      } else {
        log(`📅 «${doc.vacancyTitle}»: ${aboutTime ? 'работодатель о времени созвона' : aiSuspected
          ? 'работодатель подозревает, что пишет ИИ' : 'новое сообщение в треде, который ждёт вас'} — `
          + `за вас не отвечаю, вопрос в «Нужен ваш ответ»: ${thread.href}`);
        await storage.createClarification?.(tenantId, {
          negotiationId: thread.negotiationId, vacancyTitle: doc.vacancyTitle, company: doc.company,
          url: thread.href, question, history: fetched.messages,
        });
        await notifier.notifyClarificationNeeded?.({
          tenantId, negotiationId: thread.negotiationId, vacancyTitle: doc.vacancyTitle,
          company: doc.company, question, url: thread.href,
        });
        skipped.handedOff += 1;
      }
      await storage.saveNegotiation(tenantId, thread.negotiationId, {
        messages: fetched.messages, vacancyId, vacancyTitle: doc.vacancyTitle, company: doc.company,
        pendingClarificationFor: held ? heldFor : lastNormalized,
      });
      continue;
    }

    // Защита ТОЛЬКО от бесконечного спама: скринер-бот шлёт один и тот же вопрос и не
    // реагирует на текст (обычно ждёт нажатия кнопки в интерфейсе hh). Мы отвечаем на
    // него до MAX_SAME_REPLIES раз (последнее слово за нами), но не бесконечно — иначе
    // засыпали бы работодателя одинаковым текстом и рисковали пометкой «спам». После
    // предела — один раз зовём человека нажать кнопку вручную и больше не долбим.
    if (sameReplies >= MAX_SAME_REPLIES) {
      skipped.loop += 1;
      console.warn(`⚠️ negotiationsWatcher(${tenantId}): тред "${doc.vacancyTitle}" зациклился (${sameReplies} одинаковых ответов) — пауза авто-ответа.`);
      await storage.saveNegotiation(tenantId, thread.negotiationId, {
        messages: fetched.messages, vacancyId, vacancyTitle: doc.vacancyTitle, company: doc.company,
      });
      if (!doc.loopDetected) {
        await storage.saveNegotiation(tenantId, thread.negotiationId, { loopDetected: true });
        await notifier.notifyAlert(`Чат "${doc.vacancyTitle}"${doc.company ? ` (${doc.company})` : ''}: скринер повторяет один и тот же вопрос и не реагирует на текст (похоже, ждёт кнопку в интерфейсе). Ответил ${sameReplies} раза — дальше нужно нажать вручную: ${thread.href}`);
      }
      continue;
    }

    let match = vacancyId ? await storage.getVacancyByVacancyId(tenantId, vacancyId) : null;
    // Точное сопоставление = вакансия из чата есть в локальной БД (мы откликались через
    // лаунчер и знаем, каким резюме). Только тогда доверяем фильтру «чужой стек» ниже.
    const confidentMatch = !!match;

    // Нет точного сопоставления (откликнулись до лаунчера, с телефона, hh не отдал id, или
    // локальную БД сбросили). РАНЬШЕ при нескольких резюме такие чаты молчали и копились
    // непрочитанными — ровно то, на что жалоба. ТЕПЕРЬ всегда отвечаем: берём самое
    // подходящее резюме по названию вакансии (иначе первое). Ответить важнее, чем молчать.
    const profiles = Object.keys(resumeUrlsByProfile || {});
    if (!match) {
      const key = pickBestResumeKey(doc.vacancyTitle || thread.label, resumeProfiles) || profiles[0];
      if (key) {
        match = {
          resumeProfile: key,
          title: doc.vacancyTitle || thread.label,
          company: doc.company || thread.company || '',
          description: '',
        };
      }
    }

    // Совсем без резюме отвечать нечем — только тогда зовём человека.
    if (!match) {
      skipped.noMatch += 1;
      console.warn(`⚠️ negotiationsWatcher(${tenantId}): у арендатора нет резюме — не отвечаю "${doc.vacancyTitle}".`);
      await notifier.notifyAlert(
        `Нужен ваш ответ в чате по вакансии «${doc.vacancyTitle || 'без названия'}»`
        + `${doc.company ? ` (${doc.company})` : ''}: в профиле не задано ни одного резюме. Открыть: ${thread.href}`,
      );
      await storage.saveNegotiation(tenantId, thread.negotiationId, {
        messages: fetched.messages, vacancyId, vacancyTitle: doc.vacancyTitle, company: doc.company,
      });
      continue;
    }

    const vacancyTitle = match.title || doc.vacancyTitle;
    const company = match.company || doc.company;

    const similarVacanciesUrl = resumeUrlsByProfile[match.resumeProfile];
    let resumeText;
    try {
      resumeText = await fetchResumeText(browserCtx, similarVacanciesUrl);
    } catch (e) {
      console.warn(`⚠️ negotiationsWatcher(${tenantId}): не удалось прочитать резюме (${match.resumeProfile}):`, e.message);
      continue;
    }

    // Чужой стек — не продолжаем переписку и не заполняем формы. applyJob фильтрует это
    // на отклике, но чаты по PHP/1С и т.п. могли появиться ДО фильтра (или на другом
    // устройстве). Ловим только явно чужой основной язык (coreStackForeign), чтобы не
    // резать пограничные случаи. lastRepliedTo проставляем, чтобы не гонять ИИ по этому
    // же сообщению каждый круг — повторно оценим только на НОВОЕ сообщение.
    // Фильтр «чужой стек» применяем ТОЛЬКО при точном сопоставлении резюме. Если резюме
    // угадано (несколько резюме, вакансии нет в БД), assessVacancyFit против неверного
    // резюме легко выдаст ложный coreStackForeign — и мы бы снова замолчали. Лучше
    // ответить, чем ошибочно пропустить: на отклике чужой стек уже отфильтрован (applyJob).
    if (confidentMatch) {
      const fit = await assessVacancyFit({
        resumeText, vacancyTitle, company, vacancyDescription: match.description || '',
        strongStack: profile.strongStack || [], llmClient,
      });
      if (!fit.apply && fit.coreStackForeign) {
        log(`🧠 «${vacancyTitle}»: чужой стек — переписку не продолжаю (${fit.reason}).`);
        skipped.noMatch += 1;
        await storage.saveNegotiation(tenantId, thread.negotiationId, {
          messages: fetched.messages, vacancyId, vacancyTitle, company,
          lastRepliedTo: lastNormalized, outcome: 'stack_mismatch',
        });
        continue;
      }
    }

    // Внешний этап: анкету по ссылке автопилот заполняет сам — это тот же скрининг,
    // просто в чужом окне. Что заполнить не может (проверка знаний, вход в аккаунт,
    // файл, незнакомый конструктор) — уходит человеку отдельным уведомлением.
    //
    // externalStageNote раньше выставлялся ТОЛЬКО когда форму реально заполнили — из-за
    // этого генератор ответа (ниже) не знал, что по ссылке в этом же сообщении УЖЕ было
    // принято решение (передано человеку напрямую алертом или автозаполнение выключено),
    // и разбирал её ВТОРОЙ раз сам, по своему усмотрению — как отдельный «важный факт» и
    // мог полезть с needsHuman («готов ли кандидат заполнить анкету») поверх уже
    // отправленного алерта с прямой ссылкой. Два разных уведомления об одном и том же —
    // именно так и жаловались. Теперь заметку ставим при ЛЮБОМ исходе работы со ссылкой,
    // и явно просим модель (см. replyAgent.js) не поднимать её как отдельный вопрос.
    let externalStageNote = null;
    // Анкета — тоже «писать работодателю»: перед ней проверяем исключения заново.
    isExcluded = await loadExclusions(storage, tenantId);
    if (isExcluded({ negotiationId: thread.negotiationId, vacancyId, company: thread.company || company })) {
      log(`🚫 «${vacancyTitle}»: в исключениях или чёрном списке — ничего не делаю.`);
      skipped.excluded += 1;
      continue;
    }
    if (freshLinks.length && !externalStageEnabled) {
      log(`⏭ «${vacancyTitle}»: пришла ссылка на анкету (${freshLinks.length}), но автозаполнение выключено — отдаю вам.`);
      for (const url of freshLinks) {
        await notifier.notifyAlert(
          `По вакансии «${vacancyTitle}» работодатель прислал ссылку — пройдите её сами`
          + ` (автозаполнение анкет выключено в настройках): ${url}`,
        );
      }
      externalStageNote = 'по ссылке на анкету/форму в сообщении работодателя решение уже'
        + ' принято и передано кандидату напрямую (автозаполнение выключено в настройках) —'
        + ' не поднимай эту ссылку как отдельный вопрос';
      // Не помечаем filled — мы её не заполняли; в escalated, чтобы не слать повторно.
      await storage.saveNegotiation(tenantId, thread.negotiationId, {
        externalStageEscalated: [...escalatedUrls, ...freshLinks],
        externalStageNotified: true,
      });
    } else if (freshLinks.length) {
      log(`📝 «${vacancyTitle}»: заполняю анкету по ссылке (${freshLinks.length} шт)…`);
      const stage = await runExternalStage({
        links: freshLinks, browserCtx, llmClient, profile, resumeText,
        vacancyTitle, company,
      }).catch((e) => {
        log(`⛔ «${vacancyTitle}»: движок анкет упал — ${e.message}`);
        return { passed: [], escalated: freshLinks.map((url) => ({ url, why: e.message })) };
      });

      const stageNoteParts = [];
      if (stage.passed.length) {
        stageNoteParts.push(`анкета по ссылке заполнена и отправлена (${stage.passed.map((p) => p.title || p.url).join('; ')})`);
        // Не просто «заполнил», а что именно ответили: человек должен видеть каждый
        // вопрос и ответ, который ушёл работодателю от его имени.
        for (const form of stage.passed) {
          log(`✅ «${vacancyTitle}»: анкета заполнена и отправлена (${(form.fields || []).length} ответов).`);
          await notifier.notifyFormFilled?.({
            vacancyTitle,
            company,
            formTitle: form.title,
            url: form.url,
            fields: form.fields || [],
          });
        }
      }
      for (const item of stage.escalated) {
        log(`⛔ «${vacancyTitle}»: анкету передал вам — ${item.why}.`);
        await notifier.notifyAlert(
          `По вакансии «${vacancyTitle}» работодатель прислал ссылку, и её нужно пройти вам — ${item.why}: ${item.url}`,
        );
      }
      if (stage.escalated.length) {
        // Та же цель, что и в ветке «автозаполнение выключено» выше: не дать генератору
        // ответа поднять эту же ссылку ещё раз как отдельный вопрос через needsHuman.
        stageNoteParts.push('часть ссылок на анкеты передана кандидату напрямую отдельным'
          + ' уведомлением — не поднимай их как отдельный вопрос');
      }
      if (stageNoteParts.length) externalStageNote = stageNoteParts.join('; ');

      // Раздельно: реально отправленные — в filled (это и есть «форма заполнена»),
      // не осиленные — в escalated (не повторяем, но и заполненными не считаем).
      await storage.saveNegotiation(tenantId, thread.negotiationId, {
        externalStageFilled: [...filledUrls, ...stage.passed.map((p) => p.url)],
        externalStageEscalated: [...escalatedUrls, ...stage.escalated.map((e) => e.url)],
        externalStageNotified: true,
      });
    }

    // Скриптовому скрининг-боту (см. employerMessage.js) отвечаем ТОЛЬКО фактом: живой тест
    // показал, что дисклеймер и довесок про созвон он не разбирает и перезапускает опрос
    // заново. С живым человеком ведём себя как обычно. На закрытый вопрос или вопрос с
    // кнопками бот принимает только вариант ответа — тогда отвечаем ровно им. Кнопки берём
    // только у бота: у живого рекрутера кнопки-подсказки не обязательны к выбору.
    const isScreenerBot = isScreenerBotThread(fetched.messages);
    let quickReplies = [];
    if (isScreenerBot) {
      if (fetched.quickReplies && fetched.quickReplies.length) quickReplies = fetched.quickReplies;
      else if (looksLikeClosedQuestion(lastMsg.text)) quickReplies = ['Да', 'Нет'];
    }

    let generated;
    try {
      generated = await generateReply(
        {
          resumeText, vacancyTitle, company, vacancyDescription: match.description,
          messages: fetched.messages, externalStageNote, isScreenerBot, quickReplies,
        },
        profile,
        llmClient,
      );
    } catch (e) {
      console.warn(`⚠️ negotiationsWatcher(${tenantId}): генерация ответа не удалась (${vacancyTitle}):`, e.message);
      // Честно в ленту: НЕ пишем работодателю вслепую и не делаем вид, что ответили.
      // Вернёмся к этому чату следующим кругом, когда AI-провайдер отпустит.
      log(`⚠️ «${vacancyTitle}»: AI не сгенерировал ответ — не пишу вслепую, вернусь позже.`);
      skipped.failed += 1;
      if (/Siberi|LLM|generate|пуст|AI/i.test(e.message)) await sleep(30000);
      continue;
    }

    // 🙋 ИИ честно не может ответить сам (важный факт, которого не может быть в резюме).
    // По требованию владельца работодателю в этот момент НИЧЕГО не пишем — молчим и ждём
    // самого кандидата. Раньше здесь уходила «фраза-мостик» («передаю человеку…»): по ней
    // работодатели с AI-рекрутёрами вычисляли автоматизацию и авто-отклоняли. Теперь вопрос
    // с полным контекстом просто ждёт человека в «Нужен ваш ответ», а в чат не уходит ничего,
    // пока кандидат сам не впишет ответ. generated.holding ещё генерируется моделью (по нему
    // и распознаётся needsHuman), но больше НЕ отправляется и не сохраняется.
    if (generated.needsHuman) {
      if (typeof storage.hasOpenClarification === 'function'
        && await storage.hasOpenClarification(tenantId, thread.negotiationId, generated.question)) {
        // Уже спрашивали — не плодим дубли, просто ждём человека молча.
        await storage.saveNegotiation(tenantId, thread.negotiationId, {
          messages: fetched.messages, vacancyId, vacancyTitle, company,
        });
        skipped.handedOff += 1;
        continue;
      }
      log(`🙋 «${vacancyTitle}»: нужен ваш ответ — жду вас, работодателю пока не пишу (${generated.question}).`);
      // Работодателю молчим, но помечаем это сообщение обработанным (pendingClarificationFor),
      // иначе тот же вопрос заново уходил бы к ИИ каждый круг.
      await storage.saveNegotiation(tenantId, thread.negotiationId, {
        messages: fetched.messages, vacancyId, vacancyTitle, company,
        pendingClarificationFor: lastNormalized,
      });
      if (typeof storage.createClarification === 'function') {
        await storage.createClarification(tenantId, {
          negotiationId: thread.negotiationId, vacancyTitle, company, url: thread.href,
          question: generated.question, history: fetched.messages,
        });
      }
      await notifier.notifyClarificationNeeded?.({
        tenantId, negotiationId: thread.negotiationId, vacancyTitle, company,
        question: generated.question, url: thread.href,
      });
      skipped.handedOff += 1;
      continue;
    }

    const outgoingText = generated.text;
    if (generated.addresseeChecked === false) {
      log(`⚠️ «${vacancyTitle}»: проверка адресата не ответила — ответ прошёл только конверт и шаблоны.`);
    }
    if (generated.trimmedLeak) {
      log(`🧹 «${vacancyTitle}»: модель дописала в ответ обращение не к работодателю — вырезал, `
        + `ушла только часть для работодателя. Срезано: «${generated.trimmedLeak.slice(0, 140)}»`);
    }

    if (generated.quickReply) {
      log(`🔘 «${vacancyTitle}»: бот ждёт вариант (${quickReplies.join(' / ')}) — отвечаю «${outgoingText}».`);
    }
    // Генерация идёт минутами — человек мог добавить исключение прямо сейчас.
    isExcluded = await loadExclusions(storage, tenantId);
    if (isExcluded({ negotiationId: thread.negotiationId, vacancyId, company: thread.company || company })) {
      log(`🚫 «${vacancyTitle}»: в исключениях или чёрном списке — ответ не отправляю.`);
      skipped.excluded += 1;
      continue;
    }
    log(`💬 «${vacancyTitle}»: отвечаю в чате…`);
    const result = await sendReply(browserCtx, thread.href, outgoingText);
    if (!result.success) {
      if (result.reason === 'LOGGED_OUT') {
        await notifier.notifyAlert('Сессия hh.ru слетела (отправка ответа). Нужен повторный вход.');
        return { checked: threads.indexOf(thread), replied };
      }
      if (result.reason === 'VACANCY_CLOSED' || result.reason === 'CHAT_READONLY') {
        // Не поломка и не то, что человек может исправить руками — чат закрыт для
        // переписки (архивная вакансия ИЛИ работодатель отключил переписку явно, см.
        // hh/negotiations.js), отвечать некуда. Помечаем сообщение обработанным
        // (lastRepliedTo + outcome), иначе это ретраилось бы каждый круг навсегда с
        // ложной тревогой «проверьте вручную» — ДА ЕЩЁ И через полный дорогой путь
        // (генерация ответа реальным LLM-вызовом на каждый круг): живой тест поймал
        // именно такой тред, который переоценивался заново из раза в раз, потому что
        // здесь, в отличие от всех остальных веток, не сохранялись messages — локальная
        // копия навсегда застревала на СТАРОМ сообщении работодателя, и следующий круг
        // читал его как "новое" снова и снова.
        log(`⏭️ «${vacancyTitle}»: ${result.detail || 'переписка закрыта'} — ответ не требуется.`);
        await storage.saveNegotiation(tenantId, thread.negotiationId, {
          messages: fetched.messages, vacancyId, vacancyTitle, company,
          lastRepliedTo: lastNormalized,
          // «Только чтение» — не закрытая вакансия: у Т-Банка это вообще приглашение
          // пройти следующий шаг на их сайте, исход треда не трогаем.
          ...(result.reason === 'VACANCY_CLOSED' ? { outcome: 'vacancy_closed' } : {}),
        });
        skipped.vacancyClosed += 1;
        continue;
      }
      // Фейл отправки. Раньше мы ретраили один и тот же чат каждый круг вечно и на
      // каждом круге писали в лог + слали алерт — из-за пары «мёртвых» чатов (без поля
      // ввода) лента и уведомления были в сплошных ошибках. Теперь считаем попытки по
      // КОНКРЕТНОМУ сообщению: несколько раз пробуем молча (вдруг вёрстка догрузится),
      // а после MAX_SEND_ATTEMPTS — сдаёмся, ОДИН раз зовём человека и больше не долбим.
      const why = result.detail ? `${result.reason} — ${result.detail}` : result.reason;
      const failCount = (doc.replyFailFor === lastNormalized ? (doc.replyFailCount || 0) : 0) + 1;

      if (failCount >= MAX_SEND_ATTEMPTS) {
        log(`⛔ «${vacancyTitle}»: не смог ответить за ${MAX_SEND_ATTEMPTS} попытки (${why}). `
          + `Передаю вам — ответьте, пожалуйста, вручную: ${thread.href}`);
        await storage.saveNegotiation(tenantId, thread.negotiationId, {
          vacancyId, vacancyTitle, company,
          replyGaveUpFor: lastNormalized, replyFailCount: 0, replyFailFor: null,
        });
        await notifier.notifyAlert(
          `Не удалось отправить ответ в чате по «${vacancyTitle}»${company ? ` (${company})` : ''} — ${why}. `
          + `Пробовал ${MAX_SEND_ATTEMPTS} раза, hh не подтвердил доставку. Ответьте, пожалуйста, вручную: ${thread.href}`,
        );
        skipped.handedOff += 1;
        continue;
      }

      log(`⚠️ «${vacancyTitle}»: ответ пока не ушёл (${why}) — попытка ${failCount} из ${MAX_SEND_ATTEMPTS}, повторю на следующем круге.`);
      await storage.saveNegotiation(tenantId, thread.negotiationId, {
        vacancyId, vacancyTitle, company,
        replyFailCount: failCount, replyFailFor: lastNormalized,
      });
      skipped.failed += 1;
      continue;
    }

    log(`✅ «${vacancyTitle}»: ответ отправлен и подтверждён в переписке.`);
    const incomingText = lastMsg.text;
    const newMessages = [...fetched.messages, { from: 'ai', text: outgoingText, at: new Date() }];
    await storage.saveNegotiation(tenantId, thread.negotiationId, {
      messages: newMessages, vacancyId, vacancyTitle, company,
      lastRepliedAt: new Date(), lastRepliedTo: lastNormalized,
      // Считаем ответы на один и тот же повторяющийся текст: повтор того же вопроса
      // получит +1, новый вопрос сбросит счётчик (sameReplies выше = 0). Так на повторы
      // мы отвечаем (последнее слово за нами), но не бесконечно (см. MAX_SAME_REPLIES).
      repliedSameCount: sameReplies + 1,
      // Ответ ушёл — обнуляем счётчик прошлых неудач ОТПРАВКИ по этому треду.
      replyFailCount: 0, replyFailFor: null,
    });

    replied += 1;
    await notifier.notifyReply({
      tenantId, negotiationId: thread.negotiationId, vacancyTitle, company, incomingText, replyText: outgoingText,
      // Раньше вела на саму вакансию — по прямому запросу в прошлой правке. Но архивная
      // вакансия (частый случай: работодатель закрывает вакансию уже ПОСЛЕ переписки)
      // делает такую ссылку мёртвой, хотя сам чат и его история живут отдельно, на другом
      // поддомене, и archивирование вакансии их не трогает. Переключили обратно на чат.
      url: thread.href,
    });
  }

  // Точное число приглашений на собеседование — со страницы откликов hh (её вкладка
  // «Собеседование»), а не из нашего чат-классификатора, который часть пропускает.
  const interviewCount = await fetchInterviewCount(browserCtx);

  return { checked: threads.length, replied, skipped, interviewCount };
}

/**
 * Доставляет работодателю ответы на уточняющие вопросы (см. needsHuman выше), которые
 * человек уже дал — в лаунчере или в кабинете на сайте (см. scheduler.js: ответы с сайта
 * заливаются в локальную БД ДО вызова этой функции, поэтому здесь всегда один источник
 * правды). Доставка требует реального браузера с живой сессией hh.ru — поэтому это
 * отдельный шаг круга чатов, а не что-то, что могло бы жить в самом IPC-обработчике.
 * @param {{ tenantId: string, browserCtx: object, storage: NegotiationStorage, llmClient: object,
 *   profile: import('./coverLetter').TenantProfile, notifier?: object, log?: Function }} opts
 */
async function deliverPendingClarifications({
  tenantId, browserCtx, storage, llmClient, profile, notifier = {}, log = () => {},
  shouldStop = () => false,
}) {
  const answered = (await storage.getAnsweredClarifications?.(tenantId)) || [];
  let delivered = 0;
  for (const c of answered) {
    if (shouldStop()) break;
    // Исключения сильнее всего: даже ответ, вписанный человеком раньше, не доставляем.
    const isExcluded = await loadExclusions(storage, tenantId);
    const negDoc = await storage.getNegotiation(tenantId, c.negotiationId);
    if (isExcluded({ negotiationId: c.negotiationId, vacancyId: negDoc?.vacancyId, company: c.company || negDoc?.company })) {
      log(`🚫 «${c.vacancyTitle}»: в исключениях или чёрном списке — ваш ответ из «Нужен ваш ответ» не отправляю.`);
      continue;
    }
    let sentText;
    try {
      sentText = await deliverClarificationAnswer(
        {
          vacancyTitle: c.vacancyTitle, company: c.company, messages: c.history,
          question: c.question, answerText: c.answerText, aiImprove: c.aiImprove,
        },
        profile,
        llmClient,
      );
    } catch (e) {
      log(`⚠️ «${c.vacancyTitle}»: не удалось подготовить ответ на уточнение — ${e.message}, попробую следующим кругом.`);
      continue;
    }

    const result = await sendReply(browserCtx, c.url, sentText).catch((e) => ({ success: false, reason: e.message }));
    if (!result.success) {
      log(`⚠️ «${c.vacancyTitle}»: не смог доставить ваш ответ на уточнение (${result.reason || 'ошибка'}) — попробую следующим кругом.`);
      continue;
    }

    await storage.markClarificationDelivered(tenantId, c.id, sentText);
    const doc = await storage.getNegotiation(tenantId, c.negotiationId);
    if (doc) {
      await storage.saveNegotiation(tenantId, c.negotiationId, {
        messages: [...doc.messages, { from: 'ai', text: sentText, at: new Date() }],
        pendingClarificationFor: null,
      });
    }
    await notifier.notifyClarificationDelivered?.({ negotiationId: c.negotiationId, question: c.question, sentText });
    log(`✅ «${c.vacancyTitle}»: ваш ответ на «${c.question}» доставлен работодателю.`);
    delivered += 1;
  }
  return { delivered };
}

module.exports = { runOnce, deliverPendingClarifications };
