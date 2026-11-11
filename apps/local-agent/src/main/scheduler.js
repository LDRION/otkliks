/**
 * scheduler.js — фоновый цикл лаунчера: то же самое, что hhorosho/src/webServer.js
 * (syncAllResumes/syncNegotiations по интервалам, health-check LLM перед циклом), но
 * через automation-core (DI) вместо singleton-импортов, и с подпиской вместо "всегда включено".
 */

const {
  createBrowserContext,
  hh,
  llm,
  applyJob,
  negotiationsWatcher,
  classifyOutcome,
  cleanProfileList,
} = require('@hhpilot/automation-core');

// Профиль для ИИ без заглушек. В полях стека пишут «Собери сам», «Никаких», прочерк —
// это не стек, а просьба взять его из резюме: пустой список промпты так и понимают
// («всё, что есть в резюме»), а поисковые запросы тогда составляются по резюме
// (см. resumeProfile.js). Раньше заглушка уходила дословно и в поиск hh, и в промпты.
function workingProfile(tenant) {
  return {
    ...tenant.profile,
    strongStack: cleanProfileList(tenant.profile?.strongStack),
    honestGaps: cleanProfileList(tenant.profile?.honestGaps),
    fullName: tenant.fullName,
    email: tenant.email,
  };
}

// Пауза между кругами, когда работы НЕТ: выдача разобрана и остаётся ждать, пока
// hh опубликует новое.
const SYNC_INTERVAL_MS = 10 * 60 * 1000;

// Пауза между кругами, когда работа ЕСТЬ. Раньше интервал был один на оба случая,
// и автопилот честно стоял десять минут даже с невыбранным дневным лимитом — в ленте
// это выглядело как получасовые провалы между откликами. Полторы минуты — не «сразу»
// намеренно: между самими откликами внутри круга уже стоит пауза 20-90 секунд, и
// частить сверх этого на hh.ru не стоит.
const SYNC_BUSY_INTERVAL_MS = 90 * 1000;

// Пауза, когда лежит AI-провайдер. Короткая: его провалы длятся минуты, а отклик без
// сопроводительного письма мы всё равно не отправим.
const SYNC_LLM_DOWN_INTERVAL_MS = 3 * 60 * 1000;

// Как долго верим прошлой успешной проверке провайдера.
const HEALTH_TTL_MS = 10 * 60 * 1000;

// Пока сессия hh.ru не восстановлена, ходить туда бессмысленно: каждый круг вернёт
// то же самое. Проверяем раз в десять минут и молчим — сообщение человек уже получил.
const SYNC_LOGGED_OUT_INTERVAL_MS = 10 * 60 * 1000;

// Об одной и той же серии неудач напоминаем не чаще раза в полчаса.
const FAILURE_ALERT_TTL_MS = 30 * 60 * 1000;

// Приоритетная фаза «сначала все непрочитанные чаты, потом вакансии»: короткий шаг между
// проходами чатов и предел проходов (страховка от бесконечного цикла активной переписки).
const CHAT_PRIME_GAP_MS = 5 * 1000;
const MAX_PRIME_PASSES = 8;
// Живой случай: на аккаунте с ~530 чатами один проход занимает ~25 минут (сеть + LLM на
// каждый тред), а сходимость "ноль ответов И ноль ошибок за весь проход" почти никогда не
// случается на активном аккаунте — почти каждый круг ГДЕ-ТО да ответили или споткнулись.
// MAX_PRIME_PASSES=8 страховал от бесконечности только НА БУМАГЕ: 8 × ~25 мин = больше 3
// часов, прежде чем автопилот вообще попробует новую вакансию — и это на КАЖДЫЙ запуск
// лаунчера, а не один раз. Отсюда жалоба "должны делать 200 в день, а не можем ничего":
// приоритет чатам оказался не мягким предпочтением, а фактической блокировкой вакансий на
// часы. Второй, более надёжный предел — по времени, не зависит от размера аккаунта.
const MAX_PRIME_TIME_MS = 15 * 60 * 1000;

// Сколько круг может МОЛЧАТЬ (ни отклика, ни строки в ленте), прежде чем считать его
// зависшим. Здоровый круг подаёт признаки жизни минимум раз в ~5 минут (LLM ≤ 3 мин +
// навигация + пауза 20-90 c между откликами), поэтому 8 минут тишины — это уже затык,
// а не работа. Тогда добиваем «полудохлый» Edge, и следующий круг поднимает свежий.
const STUCK_SILENCE_MS = 8 * 60 * 1000;
// Как часто сторож проверяет тишину.
const WATCHDOG_INTERVAL_MS = 60 * 1000;

// Жёсткий предел на круг. Сторож выше бьёт по тишине и надеется, что убитый браузер
// разморозит зависший await — но если тот не отвалился (оборванный CDP умеет не
// резолвить close()), круг висит молча, а СЛЕДУЮЩИЙ НЕ ПЛАНИРУЕТСЯ НИКОГДА: планировщик
// стоит на том же await. Живой случай — полтора часа тишины после «загружаю страницу».
// Поэтому круг ещё и ограничен по времени: не уложился — идём дальше без него.
// Значения с запасом над нормальным кругом (полсотни вакансий по ~25 секунд).
const APPLY_ROUND_DEADLINE_MS = 25 * 60 * 1000;
const CHAT_ROUND_DEADLINE_MS = 20 * 60 * 1000;

/**
 * Ждёт промис не дольше ms. По истечении возвращает { timedOut: true } и НЕ отменяет
 * исходный промис (отменить его нельзя) — вызывающий гасит браузер, чтобы тот упал сам.
 */
function withDeadline(promise, ms) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).then((value) => ({ value })),
    new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function createScheduler({
  tenantGetter, refreshTenant, deviceTokenGetter, coreApiBaseUrl, browserDir, cdpPort,
  onEvent: rawOnEvent, log: rawLog,
  // Согласие человека на автозаполнение внешних анкет. Спрашиваем один раз при первом
  // запуске, дальше меняется в «Настройках».
  externalStageEnabledGetter = () => false,
}) {
  // Любой признак жизни круга (строка в ленте, событие наружу) двигает отметку — по ней
  // сторож ниже отличает работающий круг от зависшего. Оборачиваем log/onEvent один раз,
  // чтобы не расставлять touch() вручную по всему файлу.
  let lastActivityAt = Date.now();
  const touch = () => { lastActivityAt = Date.now(); };
  const log = (...a) => { touch(); return rawLog?.(...a); };
  const onEvent = (...a) => { touch(); return rawOnEvent?.(...a); };
  const { wrapStoreWithReporting } = require('./reportingStore');
  const { createStore } = require('./store');
  const { createNotifier } = require('./notifier');

  let timers = [];
  let running = false;
  let browserCtx = null;
  let capReportedOn = null;   // о выбранном дневном лимите сообщаем раз в сутки
  let lastHealthyAt = 0;      // когда AI-провайдер последний раз отвечал
  let loggedOutReported = false;  // о слетевшей сессии говорим один раз, а не каждый круг
  const failureTold = new Map();  // причина серии неудач → когда о ней сказали
  let applyActive = false;    // идёт круг откликов
  let negotiating = false;    // идёт круг чатов (он же — защита от наложения)
  const roundActive = () => applyActive || negotiating;

  function getTenant() {
    const t = tenantGetter();
    if (!t) throw new Error('Нет активного аккаунта');
    return t;
  }

  function buildDeps(userDataDir) {
    const rawStore = createStore(userDataDir);
    const llmClient = llm.createCoreApiProxyClient({
      baseUrl: coreApiBaseUrl,
      deviceToken: deviceTokenGetter(),
    });
    const { createCoreApiClient } = require('./coreApiClient');
    const coreApi = createCoreApiClient({ baseUrl: coreApiBaseUrl });
    const store = wrapStoreWithReporting(rawStore, {
      coreApi,
      getDeviceToken: deviceTokenGetter,
      classifyOutcome,
      llmClient,
    });
    const notifier = createNotifier({ onEvent, coreApi, getDeviceToken: deviceTokenGetter });
    return { store, llmClient, notifier, coreApi };
  }

  // Возвращает true, если после круга работа ещё есть: дневной лимит не выбран и
  // вакансии в выдаче не кончились. По этому ответу планировщик решает, идти ли на
  // следующий круг сразу или выдержать полную паузу.
  async function syncAllResumes(userDataDir) {
    // Перечитываем аккаунт: дневной лимит и профиль могли измениться на сервере, а
    // ждать перезапуска лаунчера ради этого человек не должен.
    await refreshTenant?.().catch(() => {});
    const tenant = getTenant();
    let workLeft = false;
    let sessionLost = false;
    const { store, llmClient, notifier } = buildDeps(userDataDir);

    // Проверка «жив ли AI» — это полноценный запрос к провайдеру, он стоит времени и
    // токенов. Гонять её перед КАЖДЫМ кругом было нормально, пока круги шли раз в
    // двадцать минут; теперь при живой работе они идут раз в полторы минуты, и на
    // проверку уходило бы больше времени, чем на сами отклики. Поэтому успех держим
    // десять минут и всё это время не перепроверяем.
    if (Date.now() - lastHealthyAt > HEALTH_TTL_MS) {
      let healthy = false;
      // Две попытки вместо трёх: у провайдера бывают короткие провалы, но ждать
      // минуту перед каждым кругом — дороже, чем вернуться через три минуты.
      for (const pauseMs of [0, 10000]) {
        if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
        healthy = await llmClient.isHealthy().catch(() => false);
        if (healthy) break;
        if (pauseMs === 0) log('AI-провайдер не ответил — пробую ещё раз через 10 секунд.');
      }

      if (!healthy) {
        // Подписку проверяем отдельно: раньше оба случая шли одним сообщением, и по
        // нему нельзя было понять, платить надо или просто подождать.
        const subActive = tenant.isSubscriptionActive ?? tenant.subscription?.status === 'active';
        log(subActive
          ? '⏸ AI-провайдер сейчас недоступен — вернусь через 3 минуты, делать ничего не нужно.'
          : '⏸ Пауза: подписка неактивна — продлите её на otkliks.ru, и автопилот продолжит сам.');
        // Возвращаемся быстро: провал провайдера длится минуты, а не десятки минут,
        // и раньше из-за него автопилот засыпал до следующего полного интервала.
        return { llmDown: true };
      }

      lastHealthyAt = Date.now();
    }

    for (const rp of tenant.resumeProfiles) {
      try {
        const result = await applyJob.runForResume({
          tenantId: tenant.id,
          resumeProfile: rp.key,
          // Название резюме — для сообщений человеку: ключ вида «vrvxk7vz» в них
          // выглядел как сбой, а не как «AI / LLM инженер».
          resumeLabel: rp.label,
          similarVacanciesUrl: rp.similarVacanciesUrl,
          browserCtx,
          storage: store,
          llmClient,
          // fullName и email лежат на верхнем уровне арендатора, а не внутри profile:
          // без этой склейки генератор письма подставлял в подпись undefined.
          profile: workingProfile(tenant),
          notifier,
          log,
          dailyCap: tenant.dailyCap || 40,
          externalStageEnabled: externalStageEnabledGetter(),
          // Чем искать помимо подборки под резюме: название профиля («AI / LLM
          // инженер») и весь сильный стек. Ограничение в два пункта оставляло пул
          // узким — при дневной цели в полторы сотни откликов источников нужно больше.
          searchQueries: [rp.label, ...cleanProfileList(tenant.profile?.strongStack)]
            .map((q) => String(q || '').trim())
            .filter(Boolean)
            .slice(0, 8),
          // Раньше «Остановить» гасил только таймер СЛЕДУЮЩЕГО круга — уже идущий обход
          // вакансий доигрывал до конца (реальные отклики уходили, пока UI уже показывал
          // «выключен»). shouldStop проверяется между вакансиями внутри runForResume.
          shouldStop: () => !running,
        });
        // Сессия hh.ru отвалилась: продолжать круг нечем. Сообщаем ОДИН раз и ждём,
        // пока человек войдёт заново — раньше одно и то же уведомление приходило
        // каждые три минуты, пока автопилот молотил вхолостую.
        if (result.loggedOut) {
          sessionLost = true;
          if (!loggedOutReported) {
            loggedOutReported = true;
            const state = await hhSessionState();
            log(state === 'captcha'
              ? '🛑 hh.ru просит подтвердить, что вы не робот. Откройте «Настройки» → «Войти в hh.ru», пройдите проверку — и автопилот продолжит сам.'
              : '🛑 Сессия hh.ru закончилась. Откройте «Настройки» → «Войти в hh.ru» и войдите заново — автопилот продолжит сам.');
            onEvent?.({ type: 'alert', at: Date.now(), message: state === 'captcha'
              ? 'hh.ru просит пройти проверку «я не робот» — зайдите в «Настройки» и войдите в hh.ru.'
              : 'Сессия hh.ru закончилась — зайдите в «Настройки» и войдите в hh.ru заново.' });
          }
          break;
        }

        // Сессия снова живая после провала — скажем, что продолжаем.
        if (loggedOutReported) {
          loggedOutReported = false;
          log('✅ Сессия hh.ru восстановлена — продолжаю работу.');
        }

        // Серия неудач подряд. Раньше об этом кричал applyJob — раз за прогон, а круги
        // идут раз в полторы минуты, и владелец получал одинаковое уведомление каждые
        // несколько минут. Теперь: одна причина — одно сообщение в полчаса.
        if (result.failureStreak >= 5 && result.lastFailure) {
          const reason = result.lastFailure.reason || 'неизвестно';
          const now = Date.now();
          const told = failureTold.get(reason) || 0;
          if (now - told > FAILURE_ALERT_TTL_MS) {
            failureTold.set(reason, now);
            log(`⚠️ ${rp.label}: ${result.failureStreak} вакансий подряд не удалось обработать`
              + ` (${reason}). Последняя — «${result.lastFailure.title}».`);
            onEvent?.({
              type: 'alert',
              at: now,
              message: `Несколько вакансий подряд не удалось обработать: ${reason}.`
                + ' Если так продолжится — напишите нам, мы посмотрим.',
            });
          }
        }

        if (result.hasMore) workLeft = true;

        // Достигнутый лимит — не поломка, но человек должен видеть, почему стало тихо.
        // Говорим один раз за сутки, а не на каждом круге.
        const cap = tenant.dailyCap || 40;
        if ((result.appliedToday ?? 0) >= cap) {
          const today = new Date().toDateString();
          if (capReportedOn !== today) {
            capReportedOn = today;
            log(`🎯 ${rp.label}: дневной лимит ${cap} откликов выбран — продолжу завтра`);
          }
        }
        if (!result.processed) {
          log(
            `🔍 ${rp.label}: в этом круге новых нет`
            + ` (просмотрено ${result.poolSize ?? 0}, все уже обработаны; за сегодня ${result.appliedToday ?? 0}`
            + ` из ${tenant.dailyCap || 40})`
            + (result.deepPending ? ' — продолжаю вглубь выдачи следующим кругом' : ' — выдача пройдена, следующая проверка через 10 минут'),
          );
        }
        if (result.processed) {
          // Раньше здесь печаталось «откликов N», где N — счётчик за весь день: при
          // нуле отправленных строка выглядела так, будто отклики всё-таки были.
          const sent = result.applied
            ? `отправлено ${result.applied}`
            : 'новых откликов нет';
          log(
            `📨 ${rp.label}: просмотрено ${result.processed}, ${sent}, пропущено ${result.skipped}`
            + ` (за сегодня ${result.appliedToday ?? 0} из ${tenant.dailyCap || 40}, круг ${result.tookSec ?? '?'} с)`,
          );
        }
      } catch (e) {
        log(`⚠️ Ошибка автопилота (${rp.label}): ${e.message}`);
      }
    }

    return { workLeft, sessionLost };
  }

  /** Что именно не так с сессией hh.ru — чтобы сказать человеку точное действие. */
  async function hhSessionState() {
    if (!browserCtx?.sessionState) return 'logged_out';
    try {
      const { browser, page } = await browserCtx.getPage();
      try {
        await page.goto('https://hh.ru/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        return await browserCtx.sessionState(page);
      } finally {
        await page.close().catch(() => {});
        await browser.close().catch(() => {});
      }
    } catch {
      return 'logged_out';
    }
  }

  async function syncNegotiations(userDataDir) {
    const tenant = getTenant();
    const { store, llmClient, notifier, coreApi } = buildDeps(userDataDir);

    const resumeUrlsByProfile = Object.fromEntries(
      tenant.resumeProfiles.map((rp) => [rp.key, rp.similarVacanciesUrl]),
    );
    const profile = workingProfile(tenant);

    // Человек мог ответить на уточняющий вопрос в кабинете на сайте, а не в лаунчере —
    // забираем такие ответы и заливаем в локальную БД ДО доставки, чтобы дальше был один
    // источник правды (см. negotiationsWatcher.deliverPendingClarifications).
    const deviceToken = deviceTokenGetter?.();
    if (deviceToken && coreApi?.getPendingClarificationAnswers) {
      const webAnswers = await coreApi.getPendingClarificationAnswers(deviceToken);
      for (const a of webAnswers) {
        const local = store.findClarificationByQuestion(tenant.id, a.negotiationId, a.question);
        if (local && local.status === 'pending') {
          store.answerClarification(tenant.id, local.id, { answerText: a.answerText, aiImprove: a.aiImprove });
        }
      }
    }
    await negotiationsWatcher.deliverPendingClarifications({
      tenantId: tenant.id, browserCtx, storage: store, llmClient, profile, notifier, log,
      shouldStop: () => !running,
    }).catch((e) => log(`⚠️ Не удалось доставить ответы на уточнения: ${e.message}`));

    try {
      const result = await negotiationsWatcher.runOnce({
        tenantId: tenant.id,
        browserCtx,
        storage: store,
        llmClient,
        profile,
        notifier,
        log,
        resumeUrlsByProfile,
        // С названиями резюме: при нескольких резюме и чате без точного сопоставления
        // выбираем наиболее подходящее по названию вакансии, а не молчим (см. watcher).
        resumeProfiles: tenant.resumeProfiles.map((rp) => ({ key: rp.key, label: rp.label })),
        externalStageEnabled: externalStageEnabledGetter(),
        // См. комментарий у applyJob.runForResume выше — та же гонка, тот же фикс:
        // проверяется между чатами внутри runOnce.
        shouldStop: () => !running,
      });
      // Пишем в ленту ВСЕГДА, а не только когда ответили. Раньше при «отвечено 0»
      // строки не было вовсе — и владелец видел ровно ту картину, на которую жаловался:
      // чаты вроде есть, а система будто не работает. Теперь видно и сколько чатов
      // прочитано, и почему по каждому промолчали.
      // Точное число приглашений на собеседование со страницы откликов hh — в
      // локальную статистику (окно «Приглашений на собеседование») и на сервер
      // (для веб-кабинета), чтобы обе цифры сходились с самим hh.
      if (typeof result.interviewCount === 'number') {
        store.setMeta(tenant.id, 'hhInterviewCount', result.interviewCount);
        const token = deviceTokenGetter?.();
        if (token) coreApi.reportStats?.(token, { interviews: result.interviewCount });
      }

      if (result.failedToList) {
        log('⚠️ Не смог прочитать список чатов на hh.ru — проверьте вход в «Настройках».');
      } else {
        const s = result.skipped || {};
        const reasons = [
          s.noNewMessages ? `без новых сообщений ${s.noNewMessages}` : '',
          s.alreadyReplied ? `уже отвечено ${s.alreadyReplied}` : '',
          s.rejection ? `отказов ${s.rejection}` : '',
          s.ack ? `отписок ${s.ack}` : '',
          s.loop ? `зациклилось ${s.loop}` : '',
          s.noMatch ? `без резюме ${s.noMatch}` : '',
          s.failed ? `ошибок ${s.failed}` : '',
          s.handedOff ? `передано вам ${s.handedOff}` : '',
          s.vacancyClosed ? `чат закрыт ${s.vacancyClosed}` : '',
        ].filter(Boolean).join(', ');

        log(`💬 Чаты: прочитано ${result.checked}, отвечено ${result.replied}`
          + (reasons ? ` (${reasons})` : ''));
      }
      // Дневной счётчик отправленных нами сообщений в чатах — для карточки «Сегодня».
      store.bumpChatMessagesToday?.(tenant.id, result.replied || 0);
      return { replied: result.replied || 0, checked: result.checked || 0, failed: (result.skipped || {}).failed || 0 };
    } catch (e) {
      log(`⚠️ Ошибка обработки чатов: ${e.message}`);
      // failed:1 — чтобы приоритетная фаза не сочла это «разобрано» и повторила круг.
      return { replied: 0, checked: 0, failed: 1 };
    }
  }

  let pausedForTask = null;

  function start(userDataDir) {
    if (running) return;
    running = true;
    pausedForTask = null;

    // Приоритетная фаза «сначала все непрочитанные чаты, потом вакансии» — на каждый
    // запуск заново: пока не сошлось, вакансии не трогаем (см. круг ниже).
    let chatsPrimed = false;
    let primePasses = 0;
    const primePhaseStartedAt = Date.now();

    browserCtx = createBrowserContext({ cdpPort, profileDir: browserDir, headless: true });

    // Отклики планируем не фиксированным интервалом, а следующим шагом после каждого
    // круга: пока лимит не выбран и вакансии есть — идём почти вплотную, когда выдача
    // разобрана — ждём десять минут. Иначе автопилот стоял ровно столько же и с
    // полным лимитом, и с пустой выдачей.
    const scheduleSync = (delay) => {
      if (!running) return;
      // Пауза между кругами ничем себя не проявляла, и со стороны штатное ожидание
      // выглядело ровно как зависание: «сделал отклик и пять минут ничего». Сторож
      // ниже ловит настоящие затыки, но человеку нужно видеть, что автопилот жив и
      // когда он вернётся.
      if (delay >= 60 * 1000) {
        const back = new Date(Date.now() + delay)
          .toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        log(`⏳ Пауза ${Math.round(delay / 60000)} мин — следующая проверка в ${back}.`);
      }
      const timer = setTimeout(async () => {
        // Бесплатный тариф: пока не выполнено задание дня, сервер всё равно не даст
        // генерировать (402) — не гоняем браузер вхолостую, а ждём, перепроверяя раз
        // в минуту. Выполнили задание — продолжаем сами, без перезапуска.
        await refreshTenant?.().catch(() => {});
        const task = tenantGetter()?.freeTasks?.pending;
        if (task) {
          if (pausedForTask !== task.id) {
            pausedForTask = task.id;
            log(`⏸ Бесплатный автопилот на паузе: задание дня — «${task.title}». `
              + 'Выполните его на панели лаунчера — это пара секунд, дальше работа продолжится сама.');
          }
          touch();
          scheduleSync(55 * 1000);
          return;
        }
        if (pausedForTask) {
          pausedForTask = null;
          log('▶️ Задание выполнено — автопилот продолжает работу.');
        }

        // ПРИОРИТЕТ — непрочитанные чаты. Сначала читаем все диалоги и отвечаем везде,
        // где можно (последнее слово за нами), и ТОЛЬКО ПОТОМ идём искать новые вакансии.
        // Иначе, как и было в жалобе, система «мониторит вакансии», а непрочитанные копятся.
        let chat = { replied: 0, failed: 0 };
        if (!negotiating) {
          negotiating = true;
          touch();
          try {
            const round = await withDeadline(syncNegotiations(userDataDir), CHAT_ROUND_DEADLINE_MS);
            if (round.timedOut) {
              log('⏱ Чаты не уложились в 20 минут — перезапускаю браузер и иду к вакансиям.');
              await Promise.resolve(browserCtx?.killBrowser?.()).catch(() => {});
            } else {
              chat = round.value || { replied: 0, failed: 0 };
            }
          } catch (e) {
            log(`⚠️ ${e.message}`);
          } finally {
            negotiating = false;
          }
        }

        // ПРИОРИТЕТНАЯ ФАЗА при запуске: НЕ трогаем поиск новых вакансий, пока не разгребём
        // ВСЕ непрочитанные чаты — ответим везде, где можно. Считаем разобранным, когда
        // очередной проход не дал ни одного нового ответа И ни одной ретраибельной ошибки
        // (осталось только то, что ответить нельзя: отказы, кнопочные боты, закрытые чаты).
        // Пока не сошлось — гоняем чаты ещё раз коротким шагом, вакансии ждут. Два предела —
        // страховка от бесконечности (проходов И времени, см. MAX_PRIME_TIME_MS выше: на
        // активном аккаунте идеальная сходимость может не случиться вообще); после любого из
        // них переходим к вакансиям, но чаты и дальше идут ПЕРВЫМИ в каждом следующем круге.
        if (!chatsPrimed) {
          primePasses += 1;
          const converged = chat.replied === 0 && chat.failed === 0;
          const timeUp = Date.now() - primePhaseStartedAt >= MAX_PRIME_TIME_MS;
          if (!converged && primePasses < MAX_PRIME_PASSES && !timeUp) {
            log('🔴 Приоритет: разбираю непрочитанные чаты — к поиску новых вакансий перейду, только когда отвечу везде, где можно.');
            scheduleSync(CHAT_PRIME_GAP_MS);
            return;
          }
          chatsPrimed = true;
          log(converged
            ? '✅ Все непрочитанные разобраны — ответил везде, где возможно. Перехожу к поиску новых вакансий.'
            : '⏱ Приоритет чатам отдал 15 минут — на активном аккаунте до идеальной сходимости может не дойти'
              + ' никогда. Перехожу к новым вакансиям, к чатам вернусь на следующем круге.');
        }

        let outcome = {};
        applyActive = true;
        touch();            // старт круга — уже признак жизни для сторожа
        try {
          const round = await withDeadline(syncAllResumes(userDataDir), APPLY_ROUND_DEADLINE_MS);
          if (round.timedOut) {
            // Браузер гасим обязательно: зависший круг всё ещё держит его страницы, и
            // без этого следующий пойдёт по тем же мёртвым вкладкам.
            log('⏱ Круг вакансий не уложился в 25 минут — перезапускаю браузер и начинаю заново.');
            await Promise.resolve(browserCtx?.killBrowser?.()).catch(() => {});
          } else {
            outcome = round.value || {};
          }
        } catch (e) {
          log(`⚠️ ${e.message}`);
        } finally {
          applyActive = false;
        }

        // ПЛАНОВЫЙ перезапуск браузера УБРАН намеренно. Раньше каждые 25 минут мы жёстко
        // гасили Edge «для профилактики подвисаний» — и это выкидывало пользователя из hh,
        // Google и Яндекса: жёсткий kill не давал Chromium дописать свежие куки на диск.
        // Зависания теперь ловит только сторож (watchdog) — по факту тишины, а не по
        // таймеру; а нормальный браузер живёт сколько нужно и держит сессии.

        // Пока есть чем заняться — чаты отвечались ИЛИ в выдаче осталась работа — идём
        // почти вплотную; когда и чаты разобраны, и выдача пуста — ждём полный интервал.
        const next = outcome.sessionLost
          ? SYNC_LOGGED_OUT_INTERVAL_MS
          : (outcome.llmDown
            ? SYNC_LLM_DOWN_INTERVAL_MS
            : ((outcome.workLeft || chat.replied > 0) ? SYNC_BUSY_INTERVAL_MS : SYNC_INTERVAL_MS));
        scheduleSync(next);
      }, delay);
      timers.push(timer);
    };

    // Сторож зависаний: если круг идёт, но ничего не происходит дольше STUCK_SILENCE_MS —
    // это не работа, а затык (чаще всего «полудохлый» Edge после сна/обновления). Гасим
    // наш фоновый браузер: текущие операции упадут, круг вернётся, следующий поднимет
    // свежий Edge. Продуктивный круг сюда не попадает — он подаёт признаки жизни (отклики,
    // строки в ленте) минимум раз в несколько минут.
    const watchdog = setInterval(() => {
      if (!running || !roundActive()) return;
      if (Date.now() - lastActivityAt < STUCK_SILENCE_MS) return;
      // Бьём повторно, пока круг молчит: раньше удар был один на всю жизнь круга, и если
      // первый браузер добить не помогло, дальше не происходило ничего. От долбёжки
      // каждую минуту стережёт touch() ниже — он сдвигает отметку тишины на STUCK_SILENCE_MS.
      rawLog?.('⏱ Круг завис без признаков жизни — перезапускаю фоновый браузер и продолжаю.');
      Promise.resolve(browserCtx?.killBrowser?.()).catch(() => {}).finally(() => { touch(); });
    }, WATCHDOG_INTERVAL_MS);
    timers.push(watchdog);

    log('🚀 Автопилот запущен.');
    // Перед первым кругом гасим любой ранее открытый Edge на нашем порту — прежде всего
    // ВИДИМОЕ окно логина. Иначе launchBrowser переиспользовал бы его, и фоновые прогоны
    // шли бы в видимом окне: все вкладки hh (чаты, вакансии, «я не робот») торчали бы в
    // Alt+Tab и пугали пользователя. После того как порт освободится, следующий запуск
    // поднимет Edge в режиме --headless=new — без единого окна. Логин лежит в профиле на
    // диске, поэтому переживает перезапуск.
    // Закрываем видимое окно логина МЯГКО (CDP Browser.close), чтобы Edge успел дописать
    // свежие куки hh/Google/Яндекса на диск — иначе фоновый запуск видел бы «разлогинен».
    // Только если мягко не вышло (браузер завис) — добиваем жёстко, чтобы освободить порт.
    (async () => {
      const closed = await (browserCtx.closeBrowser?.() ?? Promise.resolve(false));
      if (!closed) await browserCtx.killBrowser?.().catch(() => {});
    })().catch(() => {}).finally(() => {
      if (!running) return;
      // Один объединённый круг: чаты (приоритет) → вакансии → пауза → повтор. Отдельного
      // 10-минутного таймера чатов больше нет — иначе непрочитанные ждали бы до 10 минут,
      // пока идёт мониторинг вакансий. Теперь чаты проверяются в начале КАЖДОГО круга.
      scheduleSync(2500);
    });
  }

  function stop() {
    // В списке теперь и setInterval, и setTimeout — в Node это один тип таймера,
    // но гасим обоими способами, чтобы не зависеть от деталей реализации.
    timers.forEach((t) => {
      clearInterval(t);
      clearTimeout(t);
    });
    timers = [];
    running = false;
    log('⏹ Автопилот остановлен.');
  }

  function isRunning() {
    return running;
  }

  function getBrowserCtx() {
    return browserCtx;
  }

  return { start, stop, isRunning, getBrowserCtx, hh };
}

module.exports = { createScheduler };
