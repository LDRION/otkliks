import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/session-token';
import { CUSTOMER_SESSION_COOKIE, verifyCustomerSession } from '@/lib/customer-session';
import {
  REF_COOKIE, SRC_COOKIE, REF_MAX_AGE, SRC_MAX_AGE, attributionCookieOptions, normalizeCode, firstTouch, isDirectTouch,
} from '@/lib/attribution';

// Абсолютный URL для редиректа по ВНЕШНЕМУ хосту, а не по адресу, на котором слушает
// standalone-сервер. Иначе за nginx редирект уводил на http://localhost:3100/... —
// адрес, которого у пользователя в браузере нет. Берём хост/протокол из forwarded-
// заголовков (их проставляет nginx), с откатом на nextUrl.
function externalUrl(request: NextRequest, pathname: string, params?: Record<string, string>): URL {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || request.nextUrl.host;
  const proto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol.replace(':', '') || 'https';
  const url = new URL(`${proto}://${host}${pathname}`);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

// Единый список вместо цепочки ===: забыть добавить сюда новый публичный маршрут
// куда труднее, чем не заметить недостающее условие в if.
const PUBLIC_APP_ROUTES = new Set([
  '/app/login',
  '/app/register',
  '/app/forgot',
  '/app/reset',
  // Возврат от Яндекса и VK: сессии ещё нет — её как раз на этой странице и ставят.
  '/app/oauth',
]);

/**
 * Метки перехода на публичных страницах: партнёрский ?ref=КОД (последнее касание —
 * засчитывается партнёру, по чьей ссылке человек пришёл последним) и utm/реферер
 * (первое касание — откуда человек узнал о сервисе вообще).
 */
function withAttribution(request: NextRequest, response: NextResponse): NextResponse {
  const url = request.nextUrl;
  const ref = normalizeCode(url.searchParams.get('ref'));
  if (ref) response.cookies.set(REF_COOKIE, ref, attributionCookieOptions(REF_MAX_AGE));

  // Первое касание пишем один раз. Исключение — запись прямого захода: её уточняет
  // первый же заход по метке или с другого сайта (иначе «зашёл напрямую, а потом по
  // ссылке из Telegram» навсегда остался бы прямым).
  const existing = request.cookies.get(SRC_COOKIE)?.value;
  if (!existing || isDirectTouch(existing)) {
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host;
    const touch = firstTouch(url, request.headers.get('referer'), host.split(':')[0]);
    if (touch && (!existing || !isDirectTouch(touch))) response.cookies.set(SRC_COOKIE, touch, attributionCookieOptions(SRC_MAX_AGE));
  }
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/admin')) {
    if (pathname === '/admin/login') return NextResponse.next();

    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const session = token ? await verifySession(token) : null;
    if (!session) {
      return NextResponse.redirect(externalUrl(request, '/admin/login', { next: pathname }));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith('/app')) {
    // Страницы, куда попадают БЕЗ сессии — иначе middleware уводит на логин именно
    // тех, кому эти страницы и нужны: забывший пароль по определению не вошёл.
    if (PUBLIC_APP_ROUTES.has(pathname)) return withAttribution(request, NextResponse.next());

    const token = request.cookies.get(CUSTOMER_SESSION_COOKIE)?.value;
    const session = token ? await verifyCustomerSession(token) : null;
    if (!session) {
      return NextResponse.redirect(externalUrl(request, '/app/login', { next: pathname }));
    }
    return NextResponse.next();
  }

  return withAttribution(request, NextResponse.next());
}

export const config = {
  // Все страницы, кроме статики и служебного: метки перехода могут прийти на
  // любую публичную страницу (партнёр вправе дать ссылку на статью блога).
  matcher: ['/((?!_next/|api/|brand/|images/|download/|favicon|icon|opengraph-image|robots.txt|sitemap.xml|manifest).*)'],
};
