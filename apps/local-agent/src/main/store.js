/**
 * store.js — локальное SQLite-хранилище local-agent, реализует те же интерфейсы
 * (AutomationStorage, NegotiationStorage), что и Mongoose-версия в core-api — см.
 * JSDoc-типы в packages/automation-core/src/applyJob.js и negotiationsWatcher.js.
 * Один tenantId на установку (локальный лаунчер = один залогиненный пользователь),
 * но интерфейс всё равно tenant-scoped — тот же код, что и в cloud-варианте.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { isChatChrome } = require('@hhpilot/automation-core/src/hh/negotiations');

function createStore(userDataDir) {
  const dataDir = path.join(userDataDir, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'otkliks-agent.sqlite3'));

  db.exec(`
    CREATE TABLE IF NOT EXISTS vacancies (
      tenant_id TEXT NOT NULL,
      vacancy_id TEXT NOT NULL,
      resume_profile TEXT NOT NULL,
      title TEXT, company TEXT, company_key TEXT, url TEXT, description TEXT,
      status TEXT NOT NULL DEFAULT 'seen',
      skip_reason TEXT, cover_letter_text TEXT, applied_at INTEGER,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, vacancy_id, resume_profile)
    );
    CREATE INDEX IF NOT EXISTS idx_vacancies_company ON vacancies (tenant_id, company_key, status);

    CREATE TABLE IF NOT EXISTS negotiations (
      tenant_id TEXT NOT NULL,
      negotiation_id TEXT NOT NULL,
      vacancy_id TEXT, resume_profile TEXT, vacancy_title TEXT, company TEXT,
      messages_json TEXT NOT NULL DEFAULT '[]',
      disclosure_sent INTEGER NOT NULL DEFAULT 0,
      last_replied_at INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      loop_detected INTEGER NOT NULL DEFAULT 0,
      outcome TEXT NOT NULL DEFAULT 'pending',
      -- На какое именно сообщение работодателя уже ответили. Раньше повтор ловился по
      -- «сообщений стало больше», и первый вопрос треда молча терялся (см.
      -- negotiationsWatcher.js) — теперь решение принимается по последнему сообщению,
      -- а от повторного ответа сторожит эта колонка.
      last_replied_to TEXT,
      external_stage_notified INTEGER NOT NULL DEFAULT 0,
      -- Ссылки внешних этапов (анкеты и прочее), которые по треду уже отработаны:
      -- чтобы не заполнять одну и ту же форму на каждом круге наблюдателя.
      external_stage_urls TEXT NOT NULL DEFAULT '[]',
      -- Раздельный учёт анкет, чтобы система ТОЧНО знала, что заполнено, а что нет:
      -- filled — реально отправленные нами формы (правда «форма заполнена»),
      -- escalated — те, что не смогли пройти и отдали человеку (не повторяем).
      external_stage_filled TEXT NOT NULL DEFAULT '[]',
      external_stage_escalated TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (tenant_id, negotiation_id)
    );

    -- Маленькое key-value: сюда, например, кладём точное число приглашений на
    -- собеседование, снятое прямо со страницы откликов hh (её вкладка «Собеседование»).
    CREATE TABLE IF NOT EXISTS meta (
      tenant_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (tenant_id, key)
    );
  `);

  // База у пользователя уже создана прошлой версией, а CREATE TABLE IF NOT EXISTS
  // существующую таблицу не трогает — недостающие колонки добавляем руками.
  const negotiationColumns = db.prepare(`PRAGMA table_info(negotiations)`).all().map((c) => c.name);
  if (!negotiationColumns.includes('last_replied_to')) {
    db.exec(`ALTER TABLE negotiations ADD COLUMN last_replied_to TEXT`);
  }
  if (!negotiationColumns.includes('external_stage_notified')) {
    db.exec(`ALTER TABLE negotiations ADD COLUMN external_stage_notified INTEGER NOT NULL DEFAULT 0`);
  }
  if (!negotiationColumns.includes('external_stage_urls')) {
    db.exec(`ALTER TABLE negotiations ADD COLUMN external_stage_urls TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!negotiationColumns.includes('external_stage_filled')) {
    db.exec(`ALTER TABLE negotiations ADD COLUMN external_stage_filled TEXT NOT NULL DEFAULT '[]'`);
  }
  if (!negotiationColumns.includes('external_stage_escalated')) {
    db.exec(`ALTER TABLE negotiations ADD COLUMN external_stage_escalated TEXT NOT NULL DEFAULT '[]'`);
  }
  // Счётчик неудачных попыток ОТПРАВИТЬ ответ по одному и тому же сообщению и сообщение,
  // по которому мы окончательно сдались. Без них чат без поля ввода (REPLY_FIELD_NOT_FOUND)
  // ретраился каждый круг вечно и на каждом круге писал в лог/слал алерт — см.
  // negotiationsWatcher.js. Теперь после N попыток передаём человеку и больше не долбим.
  if (!negotiationColumns.includes('reply_fail_count')) {
    db.exec(`ALTER TABLE negotiations ADD COLUMN reply_fail_count INTEGER NOT NULL DEFAULT 0`);
  }
  if (!negotiationColumns.includes('reply_fail_for')) {
    db.exec(`ALTER TABLE negotiations ADD COLUMN reply_fail_for TEXT`);
  }
  if (!negotiationColumns.includes('reply_gave_up_for')) {
    db.exec(`ALTER TABLE negotiations ADD COLUMN reply_gave_up_for TEXT`);
  }
  // Сколько раз мы УЖЕ ответили на один и тот же текст работодателя (по last_replied_to).
  // Нужно, чтобы отвечать на повторный вопрос (последнее слово всегда за нами), но не
  // спамить один и тот же текст бесконечно, если скринер-бот зациклился на кнопке.
  if (!negotiationColumns.includes('replied_same_count')) {
    db.exec(`ALTER TABLE negotiations ADD COLUMN replied_same_count INTEGER NOT NULL DEFAULT 0`);
  }
  // Момент, когда в ЧАТЕ подтвердилось приглашение на созвон/собеседование (а не просто
  // статус вкладки hh). Это «победа» — показываем её отдельно и не теряем при рестарте.
  if (!negotiationColumns.includes('interview_invite_at')) {
    db.exec(`ALTER TABLE negotiations ADD COLUMN interview_invite_at INTEGER`);
  }
  // Работодатель задал вопрос, на который ИИ честно не может ответить сам — уже спросили
  // человека (см. clarifications) и ждём его ответа. Хранит last_replied_to ИМЕННО этого
  // сообщения, чтобы не запрашивать AI-провайдер и не слать holding-фразу заново каждый круг.
  if (!negotiationColumns.includes('pending_clarification_for')) {
    db.exec(`ALTER TABLE negotiations ADD COLUMN pending_clarification_for TEXT`);
  }
  // Когда тред последний раз прочитали. «Уже читали» раньше выводилось из непустого
  // messages_json, но с 1.0.17 служебные строки chatik не считаются сообщениями, и тред с
  // одним откликом без письма сохраняется пустым — без метки его перечитывали бы каждый круг.
  if (!negotiationColumns.includes('read_at')) {
    db.exec(`ALTER TABLE negotiations ADD COLUMN read_at INTEGER`);
  }
  // Приглашение убрали из блока «Приглашения» корзиной. interview_invite_at не трогаем:
  // по нему наблюдатель понимает, что приглашение уже зафиксировано, и не заводит его заново.
  if (!negotiationColumns.includes('invite_hidden')) {
    db.exec(`ALTER TABLE negotiations ADD COLUMN invite_hidden INTEGER NOT NULL DEFAULT 0`);
  }

  // Вопрос работодателя, на который ИИ не может честно ответить сам (важный факт, которого
  // нет и не может быть в резюме — не стек, а что-то ситуативное вроде "готовы прилетать в
  // офис раз в месяц?"). Держим ОТДЕЛЬНОЙ таблицей, а не полем в negotiations: у одного
  // треда таких вопросов за время переписки может быть несколько, и у каждого свой
  // жизненный цикл (задан → ответил человек → доставлено работодателю).
  db.exec(`
    CREATE TABLE IF NOT EXISTS clarifications (
      tenant_id TEXT NOT NULL,
      id TEXT NOT NULL,
      negotiation_id TEXT NOT NULL,
      vacancy_title TEXT, company TEXT, url TEXT,
      question TEXT NOT NULL,
      holding_text TEXT,
      history_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      ai_improve INTEGER NOT NULL DEFAULT 1,
      answer_text TEXT,
      sent_text TEXT,
      created_at INTEGER NOT NULL,
      answered_at INTEGER,
      delivered_at INTEGER,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_clarifications_status ON clarifications (tenant_id, status);
  `);

  // «Исключения»: переписки и вакансии, которые человек ведёт сам. Автопилот этому
  // работодателю не пишет ничего (см. automation-core/src/exclusions.js).
  db.exec(`
    CREATE TABLE IF NOT EXISTS exclusions (
      tenant_id TEXT NOT NULL,
      id TEXT NOT NULL,
      negotiation_id TEXT, vacancy_id TEXT,
      title TEXT, company TEXT, url TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE IF NOT EXISTS blacklist (
      tenant_id TEXT NOT NULL,
      id TEXT NOT NULL,
      company TEXT NOT NULL, word TEXT, broad INTEGER NOT NULL DEFAULT 0, url TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );
  `);

  // --- AutomationStorage ---

  function countAppliedToday(tenantId, resumeProfile) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const row = db
      .prepare(
        `SELECT COUNT(*) as c FROM vacancies
         WHERE tenant_id = ? AND resume_profile = ? AND status = 'applied' AND applied_at >= ?`,
      )
      .get(tenantId, resumeProfile, startOfDay.getTime());
    return row.c;
  }

  // 'error' — специально retryable (см. applyJob.js: временный сбой не должен хоронить
  // вакансию навсегда), НО без потолка это било в другую сторону: если сбой на самом деле
  // структурный (hh.ru поменял вёрстку — APPLY_BUTTON_NOT_FOUND и т.п.), одна и та же
  // вакансия ретраится КАЖДЫЙ круг вечно, и автопилот вместо новых вакансий бесконечно
  // долбится в заведомо мёртвые (живой случай: 33 вакансии сутками висели в error и
  // пережёвывались на каждом цикле — субъективно выглядело как «автопилот завис»,
  // хотя браузер честно ходил по страницам). saveVacancy НЕ обновляет created_at по
  // ON CONFLICT — значит это надёжная метка «когда впервые увидели», и её достаточно,
  // чтобы дать вакансии разумное окно на переретрай (сетевые/LLM сбои обычно проходят за
  // минуты), а не бесконечность.
  const ERROR_RETRY_WINDOW_MS = 6 * 60 * 60 * 1000;

  // resumeProfile принимается для совместимости с вызовами, но НЕ участвует в
  // запросе — см. комментарий внутри.
  function findSeenVacancyIds(tenantId, _resumeProfile, vacancyIds) {
    if (!vacancyIds.length) return new Set();
    const placeholders = vacancyIds.map(() => '?').join(',');
    const retryCutoff = Date.now() - ERROR_RETRY_WINDOW_MS;
    const rows = db
      .prepare(
        // ВНИМАНИЕ: намеренно БЕЗ resume_profile. Раньше память о вакансии была
        // привязана к резюме, и при двух резюме одна и та же вакансия проходила
        // полный круг дважды — с чтением описания и генерацией письма, — хотя
        // откликнуться на неё второй раз hh.ru всё равно не даст. Терминальный
        // исход (откликнулись / пропустили) — свойство вакансии, а не резюме.
        `SELECT vacancy_id FROM vacancies
         WHERE tenant_id = ? AND vacancy_id IN (${placeholders})
           AND (status != 'error' OR created_at <= ?)`,
      )
      .all(tenantId, ...vacancyIds, retryCutoff);
    return new Set(rows.map((r) => r.vacancy_id));
  }

  function hasAppliedToCompany(tenantId, companyKey) {
    const row = db
      .prepare(
        `SELECT 1 FROM vacancies WHERE tenant_id = ? AND company_key = ? AND status = 'applied' LIMIT 1`,
      )
      .get(tenantId, companyKey);
    return !!row;
  }

  // Компании, с которыми уже идёт (или была) переписка на hh.ru — по таблице
  // negotiations, а не vacancies. Нужна ОТДЕЛЬНО от hasAppliedToCompany: таблица
  // vacancies знает только про отклики, отправленные ЭТИМ лаунчером, а negotiations
  // наполняется из РЕАЛЬНОГО списка чатов hh.ru (см. negotiationsWatcher.js) — туда
  // попадают и переписки, начавшиеся раньше, чем на этом компьютере вообще появился
  // лаунчер (например, ручной отклик или более старая версия автопилота). Без этой
  // проверки hasAppliedToCompany о такой компании ничего не знает, и система спокойно
  // откликается туда ещё раз — ровно так всплыла древняя переписка от 14 августа.
  // Возвращает СЫРЫЕ названия компаний (нормализация — на стороне вызывающего,
  // той же функцией normalizeCompanyName, что и для vacancies.company_key).
  function listNegotiationCompanies(tenantId) {
    const rows = db
      .prepare(`SELECT DISTINCT company FROM negotiations WHERE tenant_id = ? AND company IS NOT NULL AND company != ''`)
      .all(tenantId);
    return rows.map((r) => r.company);
  }

  function saveVacancy(tenantId, vacancyId, resumeProfile, fields) {
    const now = Date.now();
    db.prepare(
      `INSERT INTO vacancies (tenant_id, vacancy_id, resume_profile, title, company, company_key, url,
         description, status, skip_reason, cover_letter_text, applied_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, vacancy_id, resume_profile) DO UPDATE SET
         title = excluded.title, company = excluded.company, company_key = excluded.company_key,
         url = excluded.url, description = excluded.description, status = excluded.status,
         skip_reason = excluded.skip_reason, cover_letter_text = excluded.cover_letter_text,
         applied_at = excluded.applied_at`,
    ).run(
      tenantId,
      vacancyId,
      resumeProfile,
      fields.title || null,
      fields.company || null,
      fields.companyKey || null,
      fields.url || null,
      fields.description || null,
      fields.status || 'seen',
      fields.skipReason || null,
      fields.coverLetterText || null,
      fields.appliedAt ? new Date(fields.appliedAt).getTime() : null,
      now,
    );
  }

  // --- NegotiationStorage ---

  function getNegotiation(tenantId, negotiationId) {
    const row = db
      .prepare(`SELECT * FROM negotiations WHERE tenant_id = ? AND negotiation_id = ?`)
      .get(tenantId, negotiationId);
    if (!row) return null;
    return {
      messages: JSON.parse(row.messages_json),
      vacancyId: row.vacancy_id,
      vacancyTitle: row.vacancy_title,
      company: row.company,
      disclosureSent: !!row.disclosure_sent,
      loopDetected: !!row.loop_detected,
      outcome: row.outcome,
      lastRepliedTo: row.last_replied_to || null,
      externalStageNotified: !!row.external_stage_notified,
      externalStageUrls: JSON.parse(row.external_stage_urls || '[]'),
      externalStageFilled: JSON.parse(row.external_stage_filled || '[]'),
      externalStageEscalated: JSON.parse(row.external_stage_escalated || '[]'),
      replyFailCount: row.reply_fail_count || 0,
      replyFailFor: row.reply_fail_for || null,
      replyGaveUpFor: row.reply_gave_up_for || null,
      repliedSameCount: row.replied_same_count || 0,
      interviewInviteAt: row.interview_invite_at || null,
      pendingClarificationFor: row.pending_clarification_for || null,
      readAt: row.read_at || null,
    };
  }

  function saveNegotiation(tenantId, negotiationId, fields) {
    const existing = db
      .prepare(`SELECT * FROM negotiations WHERE tenant_id = ? AND negotiation_id = ?`)
      .get(tenantId, negotiationId);

    const merged = {
      vacancy_id: fields.vacancyId ?? existing?.vacancy_id ?? null,
      resume_profile: fields.resumeProfile ?? existing?.resume_profile ?? null,
      vacancy_title: fields.vacancyTitle ?? existing?.vacancy_title ?? null,
      company: fields.company ?? existing?.company ?? null,
      messages_json: fields.messages ? JSON.stringify(fields.messages) : existing?.messages_json ?? '[]',
      disclosure_sent:
        typeof fields.disclosureSent === 'boolean' ? (fields.disclosureSent ? 1 : 0) : existing?.disclosure_sent ?? 0,
      last_replied_at: fields.lastRepliedAt
        ? new Date(fields.lastRepliedAt).getTime()
        : existing?.last_replied_at ?? null,
      status: fields.status ?? existing?.status ?? 'active',
      loop_detected:
        typeof fields.loopDetected === 'boolean' ? (fields.loopDetected ? 1 : 0) : existing?.loop_detected ?? 0,
      outcome: fields.outcome ?? existing?.outcome ?? 'pending',
      last_replied_to: fields.lastRepliedTo ?? existing?.last_replied_to ?? null,
      external_stage_notified:
        typeof fields.externalStageNotified === 'boolean'
          ? (fields.externalStageNotified ? 1 : 0)
          : existing?.external_stage_notified ?? 0,
      external_stage_urls: fields.externalStageUrls
        ? JSON.stringify(fields.externalStageUrls)
        : existing?.external_stage_urls ?? '[]',
      external_stage_filled: fields.externalStageFilled
        ? JSON.stringify(fields.externalStageFilled)
        : existing?.external_stage_filled ?? '[]',
      external_stage_escalated: fields.externalStageEscalated
        ? JSON.stringify(fields.externalStageEscalated)
        : existing?.external_stage_escalated ?? '[]',
      // Явные проверки (typeof / 'in'), а не ??: нам нужно уметь СБРАСЫВАТЬ счётчик в 0
      // и метку в null после успешной отправки — иначе ?? принял бы их за «не задано».
      reply_fail_count:
        typeof fields.replyFailCount === 'number' ? fields.replyFailCount : existing?.reply_fail_count ?? 0,
      reply_fail_for: 'replyFailFor' in fields ? fields.replyFailFor : existing?.reply_fail_for ?? null,
      reply_gave_up_for: 'replyGaveUpFor' in fields ? fields.replyGaveUpFor : existing?.reply_gave_up_for ?? null,
      replied_same_count:
        typeof fields.repliedSameCount === 'number' ? fields.repliedSameCount : existing?.replied_same_count ?? 0,
      // 'in' + null-ветка, а не ??: нужно уметь ЯВНО сбросить ложное приглашение
      // (передаём interviewInviteAt:null, когда тред оказался отказом), а не только ставить.
      interview_invite_at: 'interviewInviteAt' in fields
        ? (fields.interviewInviteAt ? new Date(fields.interviewInviteAt).getTime() : null)
        : existing?.interview_invite_at ?? null,
      pending_clarification_for: 'pendingClarificationFor' in fields
        ? fields.pendingClarificationFor
        : existing?.pending_clarification_for ?? null,
      read_at: fields.messages ? Date.now() : existing?.read_at ?? null,
    };

    db.prepare(
      `INSERT INTO negotiations (tenant_id, negotiation_id, vacancy_id, resume_profile, vacancy_title, company,
         messages_json, disclosure_sent, last_replied_at, status, loop_detected, outcome,
         last_replied_to, external_stage_notified, external_stage_urls,
         external_stage_filled, external_stage_escalated,
         reply_fail_count, reply_fail_for, reply_gave_up_for, replied_same_count,
         interview_invite_at, pending_clarification_for, read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, negotiation_id) DO UPDATE SET
         vacancy_id = excluded.vacancy_id, resume_profile = excluded.resume_profile,
         vacancy_title = excluded.vacancy_title, company = excluded.company,
         messages_json = excluded.messages_json, disclosure_sent = excluded.disclosure_sent,
         last_replied_at = excluded.last_replied_at, status = excluded.status,
         loop_detected = excluded.loop_detected, outcome = excluded.outcome,
         last_replied_to = excluded.last_replied_to,
         external_stage_notified = excluded.external_stage_notified,
         external_stage_urls = excluded.external_stage_urls,
         external_stage_filled = excluded.external_stage_filled,
         external_stage_escalated = excluded.external_stage_escalated,
         reply_fail_count = excluded.reply_fail_count,
         reply_fail_for = excluded.reply_fail_for,
         reply_gave_up_for = excluded.reply_gave_up_for,
         replied_same_count = excluded.replied_same_count,
         interview_invite_at = excluded.interview_invite_at,
         pending_clarification_for = excluded.pending_clarification_for,
         read_at = excluded.read_at`,
    ).run(
      tenantId,
      negotiationId,
      merged.vacancy_id,
      merged.resume_profile,
      merged.vacancy_title,
      merged.company,
      merged.messages_json,
      merged.disclosure_sent,
      merged.last_replied_at,
      merged.status,
      merged.loop_detected,
      merged.outcome,
      merged.last_replied_to,
      merged.external_stage_notified,
      merged.external_stage_urls,
      merged.external_stage_filled,
      merged.external_stage_escalated,
      merged.reply_fail_count,
      merged.reply_fail_for,
      merged.reply_gave_up_for,
      merged.replied_same_count,
      merged.interview_invite_at,
      merged.pending_clarification_for,
      merged.read_at,
    );
  }

  // Приглашения на созвон/собеседование, подтверждённые в чате — для «победного» блока
  // в лаунчере. Живут в локальной БД, поэтому не пропадают при перезапуске лаунчера.
  function getInterviewInvites(tenantId) {
    return db
      .prepare(
        `SELECT negotiation_id, vacancy_title, company, interview_invite_at
         FROM negotiations
         WHERE tenant_id = ? AND interview_invite_at IS NOT NULL AND invite_hidden = 0
         ORDER BY interview_invite_at DESC`,
      )
      .all(tenantId)
      .map((r) => ({
        negotiationId: r.negotiation_id,
        vacancyTitle: r.vacancy_title,
        company: r.company,
        at: r.interview_invite_at,
      }));
  }

  // --- Clarifications: вопросы, на которые ИИ честно не может ответить сам ---

  function rowToClarification(r) {
    return {
      id: r.id,
      negotiationId: r.negotiation_id,
      vacancyTitle: r.vacancy_title,
      company: r.company,
      url: r.url,
      question: r.question,
      holdingText: r.holding_text,
      // Даты и «Непрочитанные сообщения» из chatik до 1.0.17 попадали в историю как
      // реплики — в карточке «Нужен ваш ответ» они выглядели сообщениями сторон.
      history: JSON.parse(r.history_json || '[]').filter((m) => m && !isChatChrome(m.text)),
      status: r.status,
      aiImprove: !!r.ai_improve,
      answerText: r.answer_text,
      sentText: r.sent_text,
      createdAt: r.created_at,
      answeredAt: r.answered_at,
      deliveredAt: r.delivered_at,
    };
  }

  // Уже спрашивали человека ИМЕННО про этот вопрос в этом треде? Без проверки один и тот
  // же скрининговый вопрос (бот/рекрутер могут повторяться) плодил бы дубли в списке
  // «нужен ваш ответ» на каждый круг автопилота.
  // До 06.10.2026 к вопросам о времени созвона дописывалось «Ответьте сами — здесь или
  // прямо в чате hh.» — уже открытые такие вопросы тоже считаем тем же вопросом, иначе
  // после обновления в списке появился бы дубль без приписки.
  const LEGACY_SUFFIX = ' Ответьте сами — здесь или прямо в чате hh.';
  function hasOpenClarification(tenantId, negotiationId, question) {
    const row = db
      .prepare(
        `SELECT 1 FROM clarifications
         WHERE tenant_id = ? AND negotiation_id = ? AND question IN (?, ?) AND status != 'delivered'
         LIMIT 1`,
      )
      .get(tenantId, negotiationId, question, `${question}${LEGACY_SUFFIX}`);
    return !!row;
  }

  // Найти локальную запись по естественному ключу (тред + вопрос) — нужен, когда человек
  // ответил НЕ в лаунчере, а в кабинете на сайте: там своя БД с чужими id, сверяемся по
  // тому, что одинаково в обоих местах.
  function findClarificationByQuestion(tenantId, negotiationId, question) {
    const row = db
      .prepare(
        `SELECT * FROM clarifications WHERE tenant_id = ? AND negotiation_id = ? AND question = ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(tenantId, negotiationId, question);
    return row ? rowToClarification(row) : null;
  }

  function createClarification(tenantId, fields) {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO clarifications (tenant_id, id, negotiation_id, vacancy_title, company, url,
         question, holding_text, history_json, status, ai_improve, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?)`,
    ).run(
      tenantId, id, fields.negotiationId, fields.vacancyTitle || null, fields.company || null,
      fields.url || null, fields.question, fields.holdingText || null,
      JSON.stringify(fields.history || []), Date.now(),
    );
    return id;
  }

  // Открытые (ждут ответа человека) — для блока «Нужен ваш ответ» в лаунчере.
  function getOpenClarifications(tenantId) {
    return db
      .prepare(
        `SELECT * FROM clarifications WHERE tenant_id = ? AND status = 'pending' ORDER BY created_at DESC`,
      )
      .all(tenantId)
      .map(rowToClarification);
  }

  // До 1.0.17 парсер чата принимал даты и «Непрочитанные сообщения» за реплики, и автопилот
  // заводил вопросы там, где работодатель ничего не писал (живой случай 06.10.2026:
  // «работодатель еще ничего не написал после отклика»). Закрываем такие вопросы: в
  // истории были служебные строки, а без них последней репликой работодателя не
  // заканчивается. Ответ человека тут не нужен — статус delivered без текста. Возвращаем
  // закрытые, чтобы снять их и на сайте.
  function closeChatChromeClarifications(tenantId) {
    const rows = db
      .prepare(`SELECT id, negotiation_id, question, history_json FROM clarifications WHERE tenant_id = ? AND status = 'pending'`)
      .all(tenantId);
    const closed = [];
    for (const r of rows) {
      let history;
      try { history = JSON.parse(r.history_json || '[]'); } catch { continue; }
      if (!history.some((m) => m && isChatChrome(m.text))) continue;
      const real = history.filter((m) => m && !isChatChrome(m.text));
      if (real.length && real[real.length - 1].from === 'employer') continue;
      db.prepare(`UPDATE clarifications SET status = 'delivered', delivered_at = ? WHERE tenant_id = ? AND id = ?`)
        .run(Date.now(), tenantId, r.id);
      closed.push({ negotiationId: r.negotiation_id, question: r.question });
    }
    // Тред больше не ждёт человека, если по нему не осталось открытых вопросов.
    for (const negotiationId of new Set(closed.map((c) => c.negotiationId))) {
      const open = db.prepare(`SELECT 1 FROM clarifications WHERE tenant_id = ? AND negotiation_id = ? AND status = 'pending' LIMIT 1`)
        .get(tenantId, negotiationId);
      if (!open) {
        db.prepare(`UPDATE negotiations SET pending_clarification_for = NULL WHERE tenant_id = ? AND negotiation_id = ?`)
          .run(tenantId, negotiationId);
      }
    }
    return closed;
  }

  function getExclusions(tenantId) {
    return db.prepare(`SELECT * FROM exclusions WHERE tenant_id = ? ORDER BY created_at DESC`).all(tenantId)
      .map((r) => ({
        id: r.id, negotiationId: r.negotiation_id || null, vacancyId: r.vacancy_id || null,
        title: r.title || '', company: r.company || '', url: r.url || '', createdAt: r.created_at,
      }));
  }

  // Исключение по переписке и/или вакансии. Недостающее подтягиваем из своей базы: по
  // переписке — вакансию и компанию, по вакансии — переписку и компанию. Компания важна:
  // по ней исключается работодатель целиком, в том числе его другие вакансии.
  function addExclusion(tenantId, { negotiationId = null, vacancyId = null, url = '' }) {
    let neg = negotiationId
      ? db.prepare(`SELECT * FROM negotiations WHERE tenant_id = ? AND negotiation_id = ?`).get(tenantId, String(negotiationId))
      : null;
    if (!neg && vacancyId) {
      neg = db.prepare(`SELECT * FROM negotiations WHERE tenant_id = ? AND vacancy_id = ? LIMIT 1`).get(tenantId, String(vacancyId));
    }
    const vid = vacancyId || neg?.vacancy_id || null;
    const vac = vid ? db.prepare(`SELECT title, company FROM vacancies WHERE tenant_id = ? AND vacancy_id = ? LIMIT 1`).get(tenantId, String(vid)) : null;
    const nid = negotiationId || neg?.negotiation_id || null;
    const existing = db.prepare(
      `SELECT id FROM exclusions WHERE tenant_id = ? AND ((negotiation_id IS NOT NULL AND negotiation_id = ?) OR (vacancy_id IS NOT NULL AND vacancy_id = ?)) LIMIT 1`,
    ).get(tenantId, nid ? String(nid) : '', vid ? String(vid) : '');
    const row = {
      negotiation_id: nid ? String(nid) : null, vacancy_id: vid ? String(vid) : null,
      title: neg?.vacancy_title || vac?.title || '', company: neg?.company || vac?.company || '',
      url: url || (nid ? `https://chatik.hh.ru/chat/${nid}` : vid ? `https://hh.ru/vacancy/${vid}` : ''),
    };
    const id = existing?.id || randomUUID();
    db.prepare(
      `INSERT INTO exclusions (tenant_id, id, negotiation_id, vacancy_id, title, company, url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, id) DO UPDATE SET
         negotiation_id = COALESCE(excluded.negotiation_id, exclusions.negotiation_id),
         vacancy_id = COALESCE(excluded.vacancy_id, exclusions.vacancy_id),
         title = COALESCE(NULLIF(excluded.title, ''), exclusions.title),
         company = COALESCE(NULLIF(excluded.company, ''), exclusions.company)`,
    ).run(tenantId, id, row.negotiation_id, row.vacancy_id, row.title, row.company, row.url, Date.now());
    const closed = row.negotiation_id ? releaseThread(tenantId, row.negotiation_id) : [];
    return { exclusion: getExclusions(tenantId).find((e) => e.id === id), closed };
  }

  // Тред больше не за автопилотом (исключения, чёрный список): его вопросы в «Нужен ваш
  // ответ» и приглашение убираем. Возвращаем снятые вопросы — снять их и на сайте.
  function releaseThread(tenantId, negotiationId) {
    const closed = db.prepare(`SELECT negotiation_id, question FROM clarifications WHERE tenant_id = ? AND negotiation_id = ? AND status IN ('pending', 'answered')`)
      .all(tenantId, String(negotiationId)).map((r) => ({ negotiationId: r.negotiation_id, question: r.question }));
    db.prepare(`UPDATE clarifications SET status = 'dismissed', delivered_at = ? WHERE tenant_id = ? AND negotiation_id = ? AND status IN ('pending', 'answered')`)
      .run(Date.now(), tenantId, String(negotiationId));
    db.prepare(`UPDATE negotiations SET invite_hidden = 1 WHERE tenant_id = ? AND negotiation_id = ?`).run(tenantId, String(negotiationId));
    return closed;
  }

  // Название компании по треду — для «В чёрный список» с карточки.
  function companyOfNegotiation(tenantId, negotiationId) {
    const neg = db.prepare(`SELECT company, vacancy_id FROM negotiations WHERE tenant_id = ? AND negotiation_id = ?`).get(tenantId, String(negotiationId));
    if (neg?.company) return neg.company;
    const vac = neg?.vacancy_id ? db.prepare(`SELECT company FROM vacancies WHERE tenant_id = ? AND vacancy_id = ? LIMIT 1`).get(tenantId, neg.vacancy_id) : null;
    return vac?.company || '';
  }
  function companyOfVacancy(tenantId, vacancyId) {
    return db.prepare(`SELECT company FROM vacancies WHERE tenant_id = ? AND vacancy_id = ? LIMIT 1`).get(tenantId, String(vacancyId))?.company || '';
  }

  // «Чёрный список» — компании, от которых человек ничего не хочет (см. exclusions.js).
  function getBlacklist(tenantId) {
    return db.prepare(`SELECT * FROM blacklist WHERE tenant_id = ? ORDER BY created_at DESC`).all(tenantId)
      .map((r) => ({ id: r.id, company: r.company, word: r.word || '', broad: !!r.broad, url: r.url || '', createdAt: r.created_at }));
  }
  // Та же компания второй раз — обновляем запись (например, включили «всё связанное»).
  function addBlacklist(tenantId, { company, word = '', broad = false, url = '' }) {
    const name = String(company || '').trim();
    const same = getBlacklist(tenantId).find((b) => b.company.toLowerCase() === name.toLowerCase());
    const id = same?.id || randomUUID();
    db.prepare(
      `INSERT INTO blacklist (tenant_id, id, company, word, broad, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, id) DO UPDATE SET word = excluded.word, broad = excluded.broad, url = COALESCE(NULLIF(excluded.url, ''), blacklist.url)`,
    ).run(tenantId, id, name, word, broad ? 1 : 0, url, same?.createdAt || Date.now());
    return getBlacklist(tenantId).find((b) => b.id === id);
  }
  function removeBlacklist(tenantId, id) {
    db.prepare(`DELETE FROM blacklist WHERE tenant_id = ? AND id = ?`).run(tenantId, id);
  }

  function removeExclusion(tenantId, id) {
    db.prepare(`DELETE FROM exclusions WHERE tenant_id = ? AND id = ?`).run(tenantId, id);
  }

  // Корзина в блоке «Приглашения».
  function hideInterviewInvite(tenantId, negotiationId) {
    db.prepare(`UPDATE negotiations SET invite_hidden = 1 WHERE tenant_id = ? AND negotiation_id = ?`)
      .run(tenantId, negotiationId);
  }

  // Корзина в «Нужен ваш ответ». Статус dismissed, а не удаление строки: hasOpenClarification
  // считает его открытым, поэтому тот же вопрос по тому же сообщению не заведётся заново.
  // Возвращаем ключ — снять вопрос и на сайте.
  function dismissClarification(tenantId, id) {
    const row = db.prepare(`SELECT negotiation_id, question FROM clarifications WHERE tenant_id = ? AND id = ? AND status = 'pending'`)
      .get(tenantId, id);
    if (!row) return null;
    db.prepare(`UPDATE clarifications SET status = 'dismissed', delivered_at = ? WHERE tenant_id = ? AND id = ?`)
      .run(Date.now(), tenantId, id);
    return { negotiationId: row.negotiation_id, question: row.question };
  }

  // Отвечено человеком, но ещё не доставлено работодателю — подхватывает следующий круг
  // наблюдателя чатов (см. negotiationsWatcher.deliverPendingClarifications): доставка
  // требует реального браузера с живой сессией hh.ru, которого у IPC-обработчика нет.
  function getAnsweredClarifications(tenantId) {
    return db
      .prepare(`SELECT * FROM clarifications WHERE tenant_id = ? AND status = 'answered'`)
      .all(tenantId)
      .map(rowToClarification);
  }

  function answerClarification(tenantId, id, { answerText, aiImprove }) {
    db.prepare(
      `UPDATE clarifications SET status = 'answered', answer_text = ?, ai_improve = ?, answered_at = ?
       WHERE tenant_id = ? AND id = ?`,
    ).run(answerText, aiImprove ? 1 : 0, Date.now(), tenantId, id);
  }

  function markClarificationDelivered(tenantId, id, sentText) {
    db.prepare(
      `UPDATE clarifications SET status = 'delivered', sent_text = ?, delivered_at = ?
       WHERE tenant_id = ? AND id = ?`,
    ).run(sentText, Date.now(), tenantId, id);
  }

  // Человек ответил работодателю сам, прямо в чате hh, а не через «Нужен ваш ответ».
  // Без этого вопрос висел бы открытым вечно, а ответ, введённый позже в лаунчере, ушёл
  // бы работодателю вдогонку — устаревшим дублем. Закрываем и ещё не доставленные
  // (status 'answered'): ответ в самом чате главнее. Возвращаем закрытые — отметить на сайте.
  function closeClarificationsAnsweredInChat(tenantId, negotiationId, sentText) {
    const rows = db
      .prepare(
        `SELECT * FROM clarifications
         WHERE tenant_id = ? AND negotiation_id = ? AND status IN ('pending', 'answered')`,
      )
      .all(tenantId, negotiationId)
      .map(rowToClarification);
    for (const c of rows) markClarificationDelivered(tenantId, c.id, sentText);
    return rows;
  }

  function getVacancyByVacancyId(tenantId, vacancyId) {
    const row = db
      .prepare(
        `SELECT resume_profile, title, company, description FROM vacancies
         WHERE tenant_id = ? AND vacancy_id = ? LIMIT 1`,
      )
      .get(tenantId, vacancyId);
    if (!row) return null;
    return { resumeProfile: row.resume_profile, title: row.title, company: row.company, description: row.description };
  }

  // --- для дашборда лаунчера (локальная копия статистики, не ждём core-api) ---

  function getLocalStats(tenantId) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const applied = db
      .prepare(`SELECT COUNT(*) as c FROM vacancies WHERE tenant_id = ? AND status = 'applied'`)
      .get(tenantId).c;
    const appliedToday = db
      .prepare(
        `SELECT COUNT(*) as c FROM vacancies WHERE tenant_id = ? AND status = 'applied' AND applied_at >= ?`,
      )
      .get(tenantId, startOfDay.getTime()).c;
    // Приглашения на собеседование: берём максимум из двух источников, чтобы
    // счётчик никогда не «застревал» ниже реальности.
    //  1) точный счётчик hh (вкладка «Собеседование» на странице откликов), снятый
    //     фоновым кругом — но если hh поменяет вёрстку, парсинг вернёт null и meta
    //     замрёт на старом значении;
    //  2) наши собственные подтверждённые в чатах приглашения (interview_invite_at)
    //     плюс классификация outcome='interview'.
    // Берём max: hh-счётчик учитывает формальные приглашения на hh, а наш —
    // приглашения, которые мы распознали в переписке, даже если hh-вкладка отстаёт.
    const hhInterviewsMeta = getMeta(tenantId, 'hhInterviewCount');
    const hhInterviews = hhInterviewsMeta != null && hhInterviewsMeta !== ''
      ? parseInt(hhInterviewsMeta, 10) || 0
      : 0;
    const localInterviews = db
      .prepare(
        `SELECT COUNT(*) as c FROM negotiations
         WHERE tenant_id = ? AND (outcome = 'interview' OR interview_invite_at IS NOT NULL)`,
      )
      .get(tenantId).c;
    const interviews = Math.max(hhInterviews, localInterviews);
    const rejections = db
      .prepare(`SELECT COUNT(*) as c FROM negotiations WHERE tenant_id = ? AND outcome = 'rejection'`)
      .get(tenantId).c;
    const pending = db
      .prepare(
        `SELECT COUNT(*) as c FROM negotiations WHERE tenant_id = ? AND outcome IN ('pending','question') AND status = 'active'`,
      )
      .get(tenantId).c;
    // Сообщения, отправленные нами в чатах СЕГОДНЯ — отдельный дневной счётчик (meta),
    // растёт на число ответов каждого круга (см. bumpChatMessagesToday в scheduler).
    // Отклики за сегодня часто 0 (выдача вакансий разобрана), а в чатах кипит работа —
    // раньше её на дашборде не было видно вовсе.
    const messagesToday = parseInt(getMeta(tenantId, `chatMsgs:${dayKey()}`) || '0', 10) || 0;
    return { applied, appliedToday, interviews, rejections, pending, messagesToday };
  }

  // Отклики по дням за последние N дней (по местному времени компьютера) — для графика
  // на «Обзоре». Дни без откликов тоже в списке, с нулём: иначе на графике дыры.
  function getDailyApplied(tenantId, days = 14) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    const rows = db
      .prepare(`SELECT applied_at FROM vacancies WHERE tenant_id = ? AND status = 'applied' AND applied_at >= ?`)
      .all(tenantId, start.getTime());
    const out = [];
    for (let i = 0; i < days; i += 1) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push({ date: d.getTime(), count: 0 });
    }
    for (const r of rows) {
      const i = Math.floor((r.applied_at - start.getTime()) / 86400000);
      if (i >= 0 && i < days) out[i].count += 1;
    }
    return out;
  }

  // Ключ текущего дня в локальном времени (как и appliedToday) — YYYY-MM-DD.
  function dayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Прибавить к сегодняшнему счётчику сообщений в чатах. Живёт в локальной БД (meta),
  // поэтому переживает перезапуск лаунчера и сам «сбрасывается» на новый день (новый ключ).
  function bumpChatMessagesToday(tenantId, n) {
    const add = Number(n) || 0;
    if (add <= 0) return;
    const key = `chatMsgs:${dayKey()}`;
    const cur = parseInt(getMeta(tenantId, key) || '0', 10) || 0;
    setMeta(tenantId, key, String(cur + add));
  }

  function setMeta(tenantId, key, value) {
    db.prepare(
      `INSERT INTO meta (tenant_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = excluded.value`,
    ).run(tenantId, key, value == null ? null : String(value));
  }

  function getMeta(tenantId, key) {
    const row = db.prepare(`SELECT value FROM meta WHERE tenant_id = ? AND key = ?`).get(tenantId, key);
    return row ? row.value : null;
  }

  return {
    countAppliedToday,
    findSeenVacancyIds,
    hasAppliedToCompany,
    listNegotiationCompanies,
    saveVacancy,
    getNegotiation,
    saveNegotiation,
    getInterviewInvites,
    hasOpenClarification,
    findClarificationByQuestion,
    createClarification,
    getOpenClarifications,
    closeChatChromeClarifications,
    dismissClarification,
    hideInterviewInvite,
    getExclusions,
    addExclusion,
    removeExclusion,
    releaseThread,
    companyOfNegotiation,
    companyOfVacancy,
    getBlacklist,
    addBlacklist,
    removeBlacklist,
    getAnsweredClarifications,
    answerClarification,
    markClarificationDelivered,
    closeClarificationsAnsweredInChat,
    getVacancyByVacancyId,
    getLocalStats,
    getDailyApplied,
    bumpChatMessagesToday,
    setMeta,
    getMeta,
  };
}

module.exports = { createStore };
