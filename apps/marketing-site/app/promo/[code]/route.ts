import { NextRequest, NextResponse } from 'next/server';
import { SITE_URL } from '@/lib/site';
import { coreApiFetch } from '@/lib/coreApi';
import { getCustomerSession } from '@/lib/customerAuthSession';
import { PROMO_COOKIE, PROMO_MAX_AGE, attributionCookieOptions, normalizeCode } from '@/lib/attribution';

// Персональная промо-ссылка: otkliks.ru/promo/КОД.
//   — вошёл в кабинет → активируем прямо на его аккаунт и ведём в кабинет;
//   — не вошёл → запоминаем код и ведём на регистрацию с баннером предложения.
// Код проверяется по базе сразу: если ссылка уже использована, человек должен
// узнать это до регистрации, а не после.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = normalizeCode(raw);
  if (!code) return NextResponse.redirect(`${SITE_URL}/app/register?promo=unavailable`);

  const session = await getCustomerSession();
  if (session) {
    try {
      await coreApiFetch('/api/promo/redeem', { method: 'POST', token: session.coreApiToken, body: { code } });
      return NextResponse.redirect(`${SITE_URL}/app?promo=activated`);
    } catch {
      return NextResponse.redirect(`${SITE_URL}/app?promo=unavailable`);
    }
  }

  try {
    await coreApiFetch(`/api/promo/${code}`);
  } catch {
    return NextResponse.redirect(`${SITE_URL}/app/register?promo=unavailable`);
  }
  const res = NextResponse.redirect(`${SITE_URL}/app/register`);
  res.cookies.set(PROMO_COOKIE, code, attributionCookieOptions(PROMO_MAX_AGE));
  return res;
}
