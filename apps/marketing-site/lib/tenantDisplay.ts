// Имя, которым обращаемся к человеку в интерфейсе. Раньше везде подставлялся
// email напрямую — для обычной регистрации это нормально, но у входа через VK
// email часто отсутствует вовсе: подставляется техническая заглушка вида
// vk_123456789@oauth.otkliks.local (провайдер её не даёт, а аккаунт всё равно
// нужно на что-то завести). Показывать такое в шапке кабинета нельзя — читается
// как утечка внутреннего идентификатора, а не как обращение к человеку.
//
// Возвращает null, если показать нечего (имени нет, а почта — заглушка) —
// вызывающий код сам решает, как обойтись без имени («С возвращением!» вместо
// «С возвращением, вы.», которое звучит нелепо).
const SYNTHETIC_EMAIL_RE = /@oauth\.otkliks\.local$/i;

/** Технический адрес, подставленный при входе через провайдера без email — не настоящий контакт. */
export function isSyntheticOAuthEmail(email: string): boolean {
  return SYNTHETIC_EMAIL_RE.test(email);
}

export function tenantDisplayName(tenant: { email: string; fullName?: string | null }): string | null {
  const fullName = tenant.fullName?.trim();
  if (fullName) return fullName;

  if (isSyntheticOAuthEmail(tenant.email)) return null;

  return tenant.email;
}
