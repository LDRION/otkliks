import { NextRequest, NextResponse } from 'next/server';
import { SITE_URL } from '@/lib/site';
import { coreApiFetch } from '@/lib/coreApi';
import { REF_COOKIE, REF_MAX_AGE, attributionCookieOptions, normalizeCode } from '@/lib/attribution';

// Партнёрская ссылка: otkliks.ru/p/КОД. Запоминаем партнёра и ведём на главную —
// человек сначала читает, что это за сервис, а регистрируется уже сам.
// Код здесь не проверяется по базе нарочно: проверка — при регистрации в core-api.
//
// Переход засчитывается в статистику партнёра один раз на браузер (если кука с
// этим кодом уже стоит — повтор) и не для ботов: превью ссылок в Telegram/VK и
// поисковые роботы иначе накручивали бы «переходы» на каждом репосте.
// На деньги счётчик не влияет.
const BOT_UA = /bot|crawl|spider|preview|telegram|vkshare|facebookexternalhit|whatsapp|slack|discord|curl|wget|python|headless/i;

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ref = normalizeCode(code);

  // utm-метки — чтобы партнёрский трафик был виден и в Метрике/Google Analytics,
  // а не сливался с прямыми заходами. SITE_URL, а не адрес запроса: за nginx
  // Next видит 127.0.0.1:3100.
  const target = ref
    ? `${SITE_URL}/?utm_source=partner&utm_medium=referral&utm_campaign=${ref}`
    : `${SITE_URL}/`;
  const res = NextResponse.redirect(target);
  if (!ref) return res;

  const repeat = req.cookies.get(REF_COOKIE)?.value === ref;
  if (!repeat && !BOT_UA.test(req.headers.get('user-agent') || '')) {
    // Статистика не должна задерживать человека: ждём не дольше секунды.
    await Promise.race([
      coreApiFetch('/api/affiliate/click', { method: 'POST', body: { code: ref } }).catch(() => null),
      new Promise((r) => setTimeout(r, 1000)),
    ]);
  }
  res.cookies.set(REF_COOKIE, ref, attributionCookieOptions(REF_MAX_AGE));
  return res;
}
