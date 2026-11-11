// Общее для списка и карточки пользователя: типы ответа /api/admin/users и подписи.

export type Acquisition = {
  source?: string; medium?: string; campaign?: string; content?: string;
  referrerHost?: string; landingPath?: string; firstSeenAt?: string;
} | null;

export type UserRow = {
  id: string; email: string; noEmail: boolean; fullName: string; createdAt: string;
  signup: { via: string; where: string };
  source: string; acquisition: Acquisition;
  partner: { code: string; email: string } | null; promo: string | null;
  devices: number; resumes: number; subscription: string; paid: number;
  applied: number; applied7: number; lastAppliedAt: string | null;
  invites: number; events: number; lastEventAt: string | null; lastActivityAt: string | null;
  stage: Stage; test: boolean; internal: boolean; note: string;
};

export type Stage = 'registered' | 'resume' | 'launcher' | 'applying' | 'invited' | 'paid';

// Этапы по порядку — докуда человек дошёл.
export const STAGES: { key: Stage; label: string }[] = [
  { key: 'registered', label: 'Только зарегистрировался' },
  { key: 'resume', label: 'Добавил резюме' },
  { key: 'launcher', label: 'Подключил лаунчер' },
  { key: 'applying', label: 'Откликается' },
  { key: 'invited', label: 'Есть приглашения' },
  { key: 'paid', label: 'Оплатил' },
];
export const stageLabel = (s: Stage) => STAGES.find((x) => x.key === s)?.label || s;
export const stageIndex = (s: Stage) => STAGES.findIndex((x) => x.key === s);

// Свои аккаунты: почта совпадает с почтой администратора сайта — команда, не клиент.
export const isTeam = (u: UserRow, adminEmails: Set<string>) => adminEmails.has(u.email.toLowerCase());
export const isReal = (u: UserRow, adminEmails: Set<string> = new Set()) => !u.test && !u.internal && !isTeam(u, adminEmails);

// «Похоже, ваш»: то же имя (с транслитерацией: «Тимофей Коньшин» = «Timofey Konshin») или та
// же часть почты до @, что у администратора или его аккаунта. Только подсказка — решает
// человек отметкой «Это наш аккаунт» в карточке.
const TR: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const nameKey = (n: string) => n.toLowerCase().split('').map((c) => TR[c] ?? c).join('').replace(/[^a-z]/g, '').replace(/ey/g, 'ei');
export function lookalikes(users: UserRow[], adminEmails: Set<string>): Set<string> {
  const team = users.filter((u) => isTeam(u, adminEmails));
  const locals = new Set([...adminEmails].map((e) => e.split('@')[0]));
  const names = new Set(team.map((u) => nameKey(u.fullName)).filter((k) => k.length >= 6));
  return new Set(users.filter((u) => !isTeam(u, adminEmails) && !u.internal && !u.test
    && (locals.has(u.email.toLowerCase().split('@')[0]) || names.has(nameKey(u.fullName)))).map((u) => u.id));
}

export function fmtDate(v: string | null | undefined, withTime = false): string {
  if (!v) return '—';
  const d = new Date(v);
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}), timeZone: 'Europe/Moscow' });
}

// «сегодня», «вчера», «5 дн. назад» — для колонки активности.
export function ago(v: string | null | undefined): string {
  if (!v) return 'не было';
  const days = Math.floor((Date.now() - new Date(v).getTime()) / 864e5);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 30) return `${days} дн. назад`;
  return fmtDate(v);
}

// «Как зарегистрировался»: способ + где. «Где» пишется с 28.09.2026.
export const signupText = (u: UserRow) => `${u.signup.via}${u.signup.where ? ` ${u.signup.where}` : ''}`;
export const VIA_SHORT: Record<string, string> = { 'Почта и пароль': 'Почта', 'Яндекс ID': 'Яндекс ID', 'VK ID': 'VK ID' };

// По какой ссылке пришёл: utm-кампания, сайт-источник, страница первого захода.
export function landingText(a: Acquisition): string {
  if (!a) return '';
  return [a.campaign && `кампания «${a.campaign}»`, a.referrerHost && `с ${a.referrerHost}`, a.landingPath && `вход: ${a.landingPath}`]
    .filter(Boolean).join(' · ');
}
