const mongoose = require('mongoose');

// Один арендатор = один клиент Откликс (не путать с внутренними admin-аккаунтами сайта —
// те живут в SQLite marketing-site, это разные системы: Tenant — платящий пользователь
// продукта, admin — сотрудник, управляющий самим сайтом).
const resumeProfileSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // напр. 'default', 'fullstack', 'ai_llm'
    label: { type: String, required: true },
    similarVacanciesUrl: { type: String, required: true },
  },
  { _id: false },
);

const paymentSchema = new mongoose.Schema(
  {
    paymentId: { type: String, required: true },
    provider: { type: String, default: 'yoomoney' },
    plan: String,
    amount: Number,
    paidAt: Date,
  },
  { _id: false },
);

const deviceSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true },
    label: { type: String, default: 'Локальный агент' },
    tokenHash: { type: String, required: true },
    pairedAt: { type: Date, default: Date.now },
    lastSeenAt: Date,
  },
  { _id: false },
);

const tenantSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    fullName: { type: String, default: '' },
    // Письма-подсказки «что осталось до запуска» (lib/activationEmails.js).
    // tips=false — человек отписался; служебные письма (чеки, пароль, окончание
    // оплаченного периода) это не выключает. *At — когда какое письмо ушло (каждое
    // отправляется один раз).
    emailPrefs: {
      tips: { type: Boolean, default: true },
    },
    activationMail: {
      stepsAt: { type: Date, default: null },
      stepsAgainAt: { type: Date, default: null },
      firstRunAt: { type: Date, default: null },
    },
    // Согласие на обработку ПД (152-ФЗ): когда, откуда и какой редакции. Доказательство
    // на случай проверки — поэтому ставится один раз при регистрации и не меняется.
    consent: {
      at: { type: Date, default: null },
      source: { type: String, default: '' },   // site | launcher | oauth
      version: { type: String, default: '' },  // редакция документа /consent
    },

    // Вход через Яндекс и VK. Храним id пользователя у провайдера — по нему аккаунт
    // находится при следующем входе, даже если человек сменил почту на той стороне.
    //
    // БЕЗ `default: null` и БЕЗ `sparse` — и то и другое здесь ловушка, проверено
    // на живой базе: sparse пропускает только документы, где поля НЕТ ВОВСЕ, а
    // `default: null` заставляет Mongoose записать null каждому арендатору. В
    // итоге уникальный индекс считал все обычные аккаунты дубликатами друг друга,
    // и регистрация второго же человека падала с E11000 по ключу { vkId: null }.
    // Уникальность навешена ниже частичным индексом — он смотрит только на строки.
    yandexId: { type: String },
    vkId: { type: String },

    // Восстановление пароля. В базе лежит ТОЛЬКО хеш токена — сам токен существует
    // единственный раз, в ссылке из письма. Утечка базы при таком хранении не даёт
    // войти в чужой аккаунт (ровно та же причина, по которой не хранится пароль).
    // usedAt гасит ссылку после первой же смены пароля: письмо остаётся в почте
    // навсегда, и повторно сработать оно не должно.
    passwordReset: {
      tokenHash: String,
      expiresAt: Date,
      usedAt: Date,
      requestedAt: Date,
    },

    // Активированный промокод. Один на аккаунт навсегда — подарки не складываются.
    promo: {
      code: String,
      redeemedAt: Date,
      discountPercent: { type: Number, default: 0 },
      discountExpiresAt: Date,
      // Скидка — на ПЕРВУЮ оплату; после неё помечается использованной.
      discountUsedAt: Date,
    },

    // Партнёр, который привёл человека. Ставится ОДИН раз при регистрации и
    // больше не меняется — человек закреплён за партнёром навсегда, и 30% с каждой
    // его оплаты идут этому партнёру.
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Affiliate', default: null, index: true },
    referredAt: Date,

    // Откуда пришёл (первое касание): utm-метки и внешний источник. Для отчёта
    // в админке «регистрации и выручка по источникам», в том числе по соцсетям.
    acquisition: {
      source: String,
      medium: String,
      campaign: String,
      content: String,
      referrerHost: String,
      landingPath: String,
      firstSeenAt: Date,
    },

    // Почта, которую человек указал, но ещё не подтвердил. Сразу в `email` её
    // писать нельзя: при опечатке наши письма (и ссылка сброса пароля!) ушли бы
    // постороннему — а это прямой путь к захвату аккаунта. Становится основной
    // только после перехода по ссылке из письма. В базе — лишь хеш токена.
    pendingEmail: {
      address: String,
      tokenHash: String,
      expiresAt: Date,
      requestedAt: Date,
    },

    // TenantProfile для automation-core/coverLetter.js — см. packages/automation-core.
    profile: {
      strongStack: { type: [String], default: [] },
      honestGaps: { type: [String], default: [] },
      portfolioLink: {
        domain: String,
        canonical: String,
      },
      // Минимальная плата: ниже неё вакансии с указанной вилкой не откликаем. amount=0
      // — не задано руками, тогда автопилот берёт «от какой ЗП» прямо из резюме hh.ru
      // (см. applyJob.js/salary.js). Валюта нужна, потому что вилки бывают в $/€, и всё
      // сравнивается в рублях по курсу ЦБ.
      // Telegram для связи с работодателями — ЕДИНСТВЕННЫЙ контакт, который ИИ может назвать
      // (см. automation-core replyAgent.js contactRule). Пусто — контактов не называет вовсе.
      contactTelegram: { type: String, default: '' },
      minSalary: {
        amount: { type: Number, default: 0 },
        currency: { type: String, enum: ['RUB', 'USD', 'EUR'], default: 'RUB' },
      },
    },

    resumeProfiles: { type: [resumeProfileSchema], default: [] },

    subscription: {
      status: {
        type: String,
        enum: ['none', 'trialing', 'active', 'canceled', 'expired'],
        default: 'none',
      },
      plan: { type: String, enum: ['weekly', 'monthly'], default: 'monthly' },
      priceRub: { type: Number, default: 199 },
      startedAt: Date,
      currentPeriodEnd: Date,
      // Сброс в null при каждом продлении (см. payment.js/subscription.js) — иначе
      // напоминание об окончании подписки уйдёт повторно на каждый тик планировщика.
      reminderSentAt: Date,
    },

    paymentHistory: { type: [paymentSchema], default: [] },

    devices: { type: [deviceSchema], default: [] },

    // Сколько откликов в сутки на ПЛАТНОМ тарифе. 40 стояло с первых дней «чтобы не
    // спалиться», но упирались в него редко — раньше кончалась выдача. Теперь пул
    // собирается из подборки под резюме и обычного поиска, и потолок стал реальным
    // ограничителем. Бесплатный тариф использует отдельную константу FREE_DAILY_CAP
    // в routes/agent.js — 10, всегда одинаково для всех, тут её нарочно не храним.
    dailyCap: { type: Number, default: 200 },

    // Счётчик откликов за ТЕКУЩИЕ сутки по МСК — считается сервером (см.
    // tryConsumeDailyResponse ниже), не компьютером пользователя: раньше дневной лимит
    // проверял только сам лаунчер по своей локальной SQLite и часовому поясу компьютера —
    // это легко обойти, просто подкрутив время на машине. date хранится как 'YYYY-MM-DD'
    // по МСК; при первом запросе нового дня счётчик молча обнуляется (см. mskDateKey).
    dailyUsage: {
      date: { type: String, default: '' },
      count: { type: Number, default: 0 },
    },

    // true — этому tenant совсем недоступен бесплатный тариф (платный по-прежнему
    // работает как обычно). Ставится в routes/profile.js, когда он подключает резюме
    // hh.ru, которое уже подключено на ДРУГОМ аккаунте без активной подписки — иначе
    // один и тот же человек плодил бы новые бесплатные аккаунты под одно и то же
    // резюме и получал 10 откликов в день с каждого, а не 10 суммарно.
    freeTierBlocked: { type: Boolean, default: false },

    // Задания бесплатного тарифа (lib/freeTasks.js): с какого момента считаются дни,
    // когда человек открыл ссылку задания и когда нажал «Готово». verifiedAt — под
    // настоящую проверку подписки (бот Telegram), пока не используется.
    freeTasks: {
      startedAt: Date,
      opened: { type: Map, of: Date, default: undefined },
      done: { type: Map, of: Date, default: undefined },
      verifiedAt: { type: Map, of: Date, default: undefined },
    },

    // Точное число приглашений на собеседование, снятое лаунчером прямо со страницы
    // откликов hh (вкладка «Собеседование»). Наш чат-классификатор часть пропускал,
    // поэтому цифра в кабинете расходилась с hh — теперь берём hh как истину.
    hhInterviews: { type: Number, default: null },
  },
  { timestamps: true },
);

tenantSchema.index({ 'devices.deviceId': 1 }, { unique: true, sparse: true });

// Уникальность id провайдеров — частичным индексом, а не sparse: индекс вообще
// не видит документы, где поле не строка, поэтому обычные аккаунты (а их
// большинство) в него не попадают и между собой не конфликтуют.
tenantSchema.index({ yandexId: 1 }, { unique: true, partialFilterExpression: { yandexId: { $type: 'string' } } });
tenantSchema.index({ vkId: 1 }, { unique: true, partialFilterExpression: { vkId: { $type: 'string' } } });

tenantSchema.methods.isSubscriptionActive = function isSubscriptionActive() {
  const { status, currentPeriodEnd } = this.subscription || {};
  if (status !== 'trialing' && status !== 'active') return false;
  if (currentPeriodEnd && currentPeriodEnd.getTime() < Date.now()) return false;
  return true;
};

// МСК = UTC+3 круглый год (без перехода на летнее/зимнее) — считаем от текущего
// момента СЕРВЕРА (тот в UTC), не от часового пояса/часов клиента.
function mskDateKey(d = new Date()) {
  return new Date(d.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
tenantSchema.statics.mskDateKey = mskDateKey;

// Атомарно расходует один отклик из дневного лимита — используется и платным (cap=
// dailyCap, обычно 200), и бесплатным (cap=FREE_DAILY_CAP=10) тарифом одинаково,
// см. routes/agent.js. Копится строго на сервере: не суммируется за пропущенные
// дни (счётчик сам обнуляется первым запросом нового дня по МСК, не «плюс 10 за
// каждый несыгранный день»), и не может быть подкручен переводом часов на машине
// пользователя — день считает этот сервер, не лаунчер.
//
// Два шага гарантируют атомарность при параллельных запросах: (1) сброс на новый
// день — условие 'date не равно сегодня' делает повторный сброс от гонки безопасным
// (второй запрос просто не найдёт документ для сброса, раз первый его уже сегодняшним
// сделал); (2) сам инкремент — findOneAndUpdate с условием count<cap ЖЕ В ЗАПРОСЕ:
// MongoDB применяет её атомарно на уровне документа, так что даже два запроса «впритык
// к лимиту» не смогут оба проскочить мимо cap.
tenantSchema.statics.tryConsumeDailyResponse = async function tryConsumeDailyResponse(tenantId, cap) {
  const Tenant = this;
  const today = mskDateKey();
  await Tenant.updateOne(
    { _id: tenantId, 'dailyUsage.date': { $ne: today } },
    { $set: { 'dailyUsage.date': today, 'dailyUsage.count': 0 } },
  );
  const updated = await Tenant.findOneAndUpdate(
    { _id: tenantId, 'dailyUsage.date': today, 'dailyUsage.count': { $lt: cap } },
    { $inc: { 'dailyUsage.count': 1 } },
    { new: true },
  );
  return { ok: !!updated, usedToday: updated ? updated.dailyUsage.count : cap };
};

module.exports = mongoose.model('Tenant', tenantSchema);
