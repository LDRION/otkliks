'use server';

import { cookies, headers } from 'next/headers';
import { coreApiFetch } from '@/lib/coreApi';
import { getCustomerSession } from '@/lib/customerAuthSession';
import { SRC_COOKIE } from '@/lib/attribution';
import { checkRateLimit } from '@/lib/rateLimit';

export type WaitlistState = { ok?: boolean; already?: boolean; error?: string } | undefined;

type Me = { tenant: { email: string; emailIsPlaceholder?: boolean } };

/** Настоящая почта вошедшего пользователя — или null (не вошёл / аккаунт из VK без почты).
 *  Берём из core-api, а не из cookie сессии: почту могли подтвердить после входа. */
async function accountEmail(): Promise<{ email: string; tenantId: string } | null> {
  const session = await getCustomerSession().catch(() => null);
  if (!session) return null;
  const me = await coreApiFetch<Me>('/api/auth/me', { token: session.coreApiToken }).catch(() => null);
  const email = me?.tenant?.email || '';
  if (!email || me?.tenant?.emailIsPlaceholder || /@oauth\.otkliks\.local$/i.test(email)) return null;
  return { email, tenantId: session.tenantId };
}

const mask = (e: string) => { const [u, d] = e.split('@'); return `${u.slice(0, 2)}${u.length > 2 ? '***' : ''}@${d}`; };

/** Что показать в карточке: форму с полем почты или кнопку «на почту аккаунта». */
export async function cloudWaitlistIdentity(): Promise<{ email: string | null; joined: boolean }> {
  const acc = await accountEmail();
  if (!acc) return { email: null, joined: false };
  const st = await coreApiFetch<{ joined: boolean }>('/api/waitlist/cloud/status', {
    method: 'POST', body: { email: acc.email },
  }).catch(() => ({ joined: false }));
  return { email: mask(acc.email), joined: st.joined };
}

// Запись в лист ожидания облачного тарифа. core-api снаружи недоступен — зовём его
// отсюда. Лимит по IP: форма публичная, без него её можно забить мусорными адресами
// и испортить главную цифру (сколько людей реально ждут облако).
export async function joinCloudWaitlist(_prev: WaitlistState, fd: FormData): Promise<WaitlistState> {
  // X-Real-IP выставляет наш nginx (перезаписывает присланный клиентом), ему можно верить.
  const ip = (await headers()).get('x-real-ip') || 'unknown';
  if (!checkRateLimit(`cloud-waitlist:${ip}`, 5, 10 * 60 * 1000)) {
    return { error: 'Слишком много попыток — попробуйте через несколько минут' };
  }
  // Ловушка для ботов: скрытое поле, человек его не видит и не заполняет.
  if (String(fd.get('website') || '')) return { ok: true };

  // Вошёл с настоящей почтой — пишем её, поле формы не нужно (и не доверяем ему).
  const acc = await accountEmail();
  const session = acc ? null : await getCustomerSession().catch(() => null);
  const email = acc ? acc.email : String(fd.get('email') || '').trim().slice(0, 254);
  const source = String(fd.get('source') || '');
  try {
    const r = await coreApiFetch<{ ok: boolean; already: boolean }>('/api/waitlist/cloud', {
      method: 'POST',
      body: {
        email, source,
        tenantId: acc?.tenantId || session?.tenantId,
        src: (await cookies()).get(SRC_COOKIE)?.value,
      },
    });
    return { ok: true, already: r.already };
  } catch (e) {
    return { error: e instanceof Error && /почт/i.test(e.message) ? 'Проверьте адрес почты' : 'Не получилось — попробуйте ещё раз' };
  }
}

// Открыл размытую карточку облака на главной — сигнал интереса. visitor — случайный
// id из localStorage браузера (не персональные данные). Лимит по IP — чтобы цифру
// нельзя было накрутить скриптом.
export async function trackCloudReveal(visitor: string): Promise<void> {
  const ip = (await headers()).get('x-real-ip') || 'unknown';
  if (!checkRateLimit(`cloud-reveal:${ip}`, 10, 10 * 60 * 1000)) return;
  if (!/^[a-f0-9-]{16,64}$/i.test(String(visitor || ''))) return;
  const session = await getCustomerSession().catch(() => null);
  await coreApiFetch('/api/waitlist/reveal', {
    method: 'POST',
    body: { visitor, tenantId: session?.tenantId, src: (await cookies()).get(SRC_COOKIE)?.value },
  }).catch(() => null);
}
