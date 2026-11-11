// Откуда пришёл человек: партнёрская ссылка, промо-ссылка, utm-метки и внешний
// источник. Всё запоминается в cookie и уезжает в core-api вместе с регистрацией
// (почтой — через форму, через Яндекс/VK — core-api читает cookie сам).
//
// Cookie httpOnly: странице они не нужны, а скрипту на странице (включая чужие —
// счётчики аналитики) читать их незачем. Значения всё равно считаются
// недоверенными: core-api проверяет каждый код по базе и чистит метки.

export const REF_COOKIE = 'otkliks_ref';
export const PROMO_COOKIE = 'otkliks_promo';
export const SRC_COOKIE = 'otkliks_src';

const DAY = 60 * 60 * 24;
export const REF_MAX_AGE = 60 * DAY; // партнёру засчитывается регистрация в течение 60 дней
export const PROMO_MAX_AGE = 30 * DAY;
export const SRC_MAX_AGE = 30 * DAY;

export const attributionCookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge,
});

const CODE_RE = /^[A-Z0-9]{4,32}$/;
export function normalizeCode(v: string | null | undefined): string | null {
  const c = String(v || '').trim().toUpperCase();
  return CODE_RE.test(c) ? c : null;
}

const cut = (v: string | null, max = 80) => (v ? v.slice(0, max) : undefined);

/**
 * Первое касание: utm-метки, внешний реферер и страница входа. Возвращает JSON для
 * cookie или null для внутреннего перехода. Прямой заход тоже запоминается (только
 * страница и время) — с 10.10.2026, чтобы в админке было видно, на какую страницу
 * человек пришёл; если потом он придёт по метке или ссылке, запись уточнится
 * (см. middleware: isDirectTouch).
 */
export function firstTouch(url: URL, referer: string | null, ownHost: string): string | null {
  const q = url.searchParams;
  let refHost: string | undefined;
  try {
    const h = referer ? new URL(referer).hostname : '';
    if (h && h !== ownHost && !h.endsWith(`.${ownHost}`)) refHost = h;
  } catch { /* битый Referer — игнорируем */ }

  const data = {
    s: cut(q.get('utm_source')),
    m: cut(q.get('utm_medium')),
    c: cut(q.get('utm_campaign')),
    ct: cut(q.get('utm_content')),
    r: cut(refHost ?? null, 120),
    l: cut(url.pathname, 200),
    t: Date.now(),
  };
  // Переход внутри сайта (Referer — наш же домен) — не новое касание.
  if (!data.s && !data.r && referer && !refHost) return null;
  return JSON.stringify(data);
}

/** Запись первого касания без метки и внешнего сайта — её можно уточнить следующим заходом. */
export function isDirectTouch(raw: string | undefined): boolean {
  if (!raw) return true;
  try {
    const o = JSON.parse(raw);
    return !o?.s && !o?.r;
  } catch {
    return true;
  }
}
