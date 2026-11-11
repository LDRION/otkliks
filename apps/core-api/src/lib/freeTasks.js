// Задания бесплатного тарифа. Бесплатный тариф — полный (100 откликов в день, письма,
// переписка, анкеты), а платит за него человек одним маленьким действием в первые
// четыре дня: подписаться на наши соцсети и оставить отзыв. Пока задание дня не
// выполнено, бесплатный автопилот стоит на паузе (routes/agent.js); после четвёртого —
// заданий больше нет. Платных (и пробный период) это не касается.
//
// Проверка пока «по факту перехода»: «Готово» засчитывается, только если человек
// открыл ссылку задания и прошло несколько секунд. Настоящую проверку подписки на
// Telegram (getChatMember) подключим, когда появится бот — поле verifiedAt под неё.

const DAY_MS = 24 * 60 * 60 * 1000;

const TASKS = [
  {
    id: 'tg', day: 1, minOpenSec: 8,
    title: 'Подпишитесь на наш Telegram',
    text: 'Новости сервиса, советы по поиску работы и разборы откликов — коротко, без спама.',
    url: 'https://t.me/otkliksru', action: 'Открыть Telegram',
  },
  {
    id: 'vk', day: 2, minOpenSec: 8,
    title: 'Подпишитесь на нас во ВКонтакте',
    text: 'Там же — ответы на вопросы и новые функции автопилота.',
    url: 'https://vk.ru/otkliks', action: 'Открыть ВКонтакте',
  },
  {
    id: 'yt', day: 3, minOpenSec: 8,
    title: 'Подпишитесь на наш YouTube',
    text: 'Короткие видео: как устроен отбор на hh.ru и как проходить его быстрее.',
    url: 'https://www.youtube.com/@otkliks', action: 'Открыть YouTube',
  },
  {
    id: 'review', day: 4, minOpenSec: 20,
    title: 'Оставьте отзыв в нашем Telegram',
    text: 'Пара честных слов под любым постом канала: что понравилось, чего не хватает. Последнее задание — дальше бесплатный тариф работает без них.',
    url: 'https://t.me/otkliksru', action: 'Написать отзыв',
  },
];

const byId = new Map(TASKS.map((t) => [t.id, t]));

const mapGet = (m, k) => (m ? (typeof m.get === 'function' ? m.get(k) : m[k]) : undefined);

// День считаем окнами по 24 часа от первого знакомства с заданиями, а не календарём:
// иначе зарегистрированный в 23:50 получил бы второе задание через десять минут.
function currentDay(startedAt, now = new Date()) {
  const start = startedAt ? new Date(startedAt).getTime() : now.getTime();
  return Math.max(1, Math.floor((now.getTime() - start) / DAY_MS) + 1);
}

/** Состояние заданий для интерфейса. null — заданий нет (платный или пробный период). */
function tasksState(tenant, now = new Date()) {
  if (tenant.isSubscriptionActive()) return null;
  const ft = tenant.freeTasks || {};
  const day = currentDay(ft.startedAt, now);
  const items = TASKS.map((t) => {
    const doneAt = mapGet(ft.done, t.id) || null;
    const openedAt = mapGet(ft.opened, t.id) || null;
    return {
      id: t.id, day: t.day, title: t.title, text: t.text, url: t.url, action: t.action,
      minOpenSec: t.minOpenSec, done: !!doneAt, doneAt, openedAt, available: t.day <= day,
    };
  });
  const pending = items.find((i) => i.available && !i.done) || null;
  const next = items.find((i) => !i.available && !i.done) || null;
  const doneCount = items.filter((i) => i.done).length;
  // Когда откроется следующее задание — чтобы честно сказать «завтра», а не «когда-то».
  const nextAt = next && ft.startedAt ? new Date(new Date(ft.startedAt).getTime() + (next.day - 1) * DAY_MS) : null;
  return { day, total: TASKS.length, doneCount, allDone: doneCount === TASKS.length, pending, next, nextAt, items };
}

/** Первое знакомство с заданиями — отсюда считаются дни. Атомарно и один раз. */
async function ensureStarted(tenant) {
  if (tenant.isSubscriptionActive() || tenant.freeTasks?.startedAt) return;
  const Tenant = tenant.constructor;
  const now = new Date();
  await Tenant.updateOne({ _id: tenant._id, 'freeTasks.startedAt': { $exists: false } }, { $set: { 'freeTasks.startedAt': now } });
  if (!tenant.freeTasks) tenant.freeTasks = {};
  tenant.freeTasks.startedAt = tenant.freeTasks.startedAt || now;
}

async function markOpened(tenant, id) {
  const t = byId.get(id);
  if (!t) return { error: 'Нет такого задания', status: 404 };
  await tenant.constructor.updateOne({ _id: tenant._id }, { $set: { [`freeTasks.opened.${id}`]: new Date() } });
  return { ok: true };
}

async function markDone(tenant, id, now = new Date()) {
  const t = byId.get(id);
  if (!t) return { error: 'Нет такого задания', status: 404 };
  const state = tasksState(tenant, now);
  const item = state?.items.find((i) => i.id === id);
  if (!item) return { error: 'На платном тарифе заданий нет', status: 409 };
  if (item.done) return { ok: true };
  if (!item.available) return { error: 'Это задание откроется позже', status: 409 };
  if (!item.openedAt) return { error: `Сначала нажмите «${t.action}» и выполните задание`, status: 409 };
  const waited = (now.getTime() - new Date(item.openedAt).getTime()) / 1000;
  if (waited < t.minOpenSec) {
    return { error: `Выполните задание и нажмите «Готово» ещё раз — через ${Math.ceil(t.minOpenSec - waited)} с`, status: 409 };
  }
  await tenant.constructor.updateOne({ _id: tenant._id }, { $set: { [`freeTasks.done.${id}`]: now } });
  return { ok: true };
}

module.exports = { TASKS, tasksState, ensureStarted, markOpened, markDone, currentDay };
