// Единое место для констант бесплатного/платного тарифа — используется и гейтом
// генерации (routes/agent.js), и publicTenant() в routes/auth.js (чтобы лаунчер и
// кабинет показывали ТОТ ЖЕ лимит, который реально применяется на сервере).

// Бесплатный тариф с 29.09.2026 — ПОЛНЫЙ: 100 откликов в сутки, письмо под каждую
// вакансию, переписка с работодателями, анкеты. Цена — четыре задания в первые дни
// (lib/freeTasks.js). Платный отличается приоритетом в очереди генерации
// (lib/aiQueue.js), лимитом Tenant.dailyCap (обычно 200) и отсутствием заданий.
// Оба лимита расходуются одной атомарной функцией, см. Tenant.tryConsumeDailyResponse.
const FREE_DAILY_CAP = 100;

// Раньше здесь был список того, что можно бесплатно (без переписки и анкет). Теперь
// можно всё; константа осталась для совместимости с тем, кто её импортирует.
const FREE_ALLOWED_KINDS = null;

// Служебные вызовы, которые НЕ останавливаются заданием дня: проверка живости
// провайдера, проверка адресата исходящего сообщения и классификация ответа
// работодателя — это не работа автопилота, а его обвязка.
const TASK_EXEMPT_KINDS = new Set(['health_check', 'leak_check', 'outcome_classify']);

// Только эти kind расходуют дневной лимит откликов — один отклик = одно сопроводительное
// письмо. Подбор вакансии и классификация исхода лимит не тратят.
const QUOTA_METERED_KINDS = new Set(['cover_letter']);

function effectiveDailyCap(tenant) {
  return tenant.isSubscriptionActive() ? (tenant.dailyCap || 200) : FREE_DAILY_CAP;
}

module.exports = { FREE_DAILY_CAP, FREE_ALLOWED_KINDS, TASK_EXEMPT_KINDS, QUOTA_METERED_KINDS, effectiveDailyCap };
