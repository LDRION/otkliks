import { NextRequest, NextResponse } from 'next/server';
import { coreApiFetch } from '@/lib/coreApi';
import { customerSessionCookieOptions, CUSTOMER_SESSION_COOKIE } from '@/lib/customer-session';
import { SITE_URL } from '@/lib/site';

// Последний шаг входа через Яндекс или VK.
//
// Это Route Handler, а не обычная страница (page.tsx) — сознательно, не по
// вкусу. Next 15 запрещает ставить cookie из серверного компонента страницы:
// "Cookies can only be modified in a Server Action or Route Handler" — первая
// же живая попытка входа через VK падала с ровно этой ошибкой прямо на проде.
// Здесь тот же самый экземпляр NextResponse, в который пишется cookie, —
// и есть ответ с редиректом, поэтому ограничение не применяется.
//
// Провайдер вернул человека в core-api, тот создал (или нашёл) аккаунт и
// отправил сюда с ОДНОРАЗОВЫМ кодом. Здесь код меняется на токен сессии
// server-to-server. Сам токен через адресную строку не гоняем: он осел бы в
// истории браузера, в логах nginx и в заголовке Referer у любой внешней
// картинки на следующей странице.
export async function GET(request: NextRequest) {
  // НЕ origin из request.url: standalone-сервер стоит за nginx на 127.0.0.1:3100,
  // и Next видит именно этот внутренний адрес, а не публичный домен — редирект
  // уводил на localhost:3100 вместо otkliks.ru. Обнаружено на первой же живой
  // попытке входа через VK. SITE_URL — фиксированная константа, не переменная
  // окружения, поэтому в отличие от заголовков подделать её нечем.
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next');
  const oauthError = searchParams.get('oauthError');

  const toLogin = (message: string) =>
    NextResponse.redirect(`${SITE_URL}/app/login?oauthError=${encodeURIComponent(message)}`);

  if (oauthError) return toLogin(oauthError);
  if (!code) return toLogin('Вход не завершён, попробуйте ещё раз');

  let token: string;
  try {
    const res = await coreApiFetch<{ token: string }>('/api/auth/oauth/exchange', {
      method: 'POST',
      body: { code },
    });
    token = res.token;
  } catch {
    return toLogin('Ссылка входа устарела, попробуйте ещё раз');
  }

  // next приходит от core-api уже проверенным, но проверяем и здесь: страница
  // публичная, и открыть её с произвольным параметром может кто угодно.
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';
  const response = NextResponse.redirect(`${SITE_URL}${target}`);
  response.cookies.set(CUSTOMER_SESSION_COOKIE, token, customerSessionCookieOptions);
  return response;
}
