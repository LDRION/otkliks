import { NextRequest, NextResponse } from 'next/server';
import { askSiberiStream } from '@/lib/siberiClient';
import { CONSULTANT_SYSTEM_PROMPT } from '@/lib/consultantPrompt';
import { checkRateLimit } from '@/lib/rateLimit';

// Стриминг из внешнего AI API — держим Node-рантайм (нужны fetch-стримы и генератор).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

const MAX_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 2000;

// Этот виджет ходит в тот же AI API (Siberi), что и платящий автопилот — у Siberi лимит
// 120 запросов/мин НА IP НАШЕГО СЕРВЕРА (см. lib/siberiClient.ts), а не на посетителя
// сайта: и автопилот (через core-api), и этот виджет для Siberi выглядят одним и тем же
// адресом. Без своего лимита один настойчивый (или скриптованный) посетитель мог бы
// забрать этот общий бюджет у платящих клиентов — двойной лимит ниже: по IP посетителя
// (не долбит один человек) и по всему сайту сразу (не выедается общий бюджет).
const PER_IP_LIMIT = 6;
const GLOBAL_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown'
  );
}

function buildUserPrompt(messages: ChatMessage[]): string {
  const recent = messages.slice(-MAX_MESSAGES);
  const history = recent
    .slice(0, -1)
    .map((m) => `${m.role === 'user' ? 'Пользователь' : 'Консультант'}: ${m.content}`)
    .join('\n');
  const last = recent[recent.length - 1];

  return history ? `${history}\n\nПользователь: ${last.content}` : last.content;
}

export async function POST(request: NextRequest) {
  let body: { messages?: ChatMessage[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = messages[messages.length - 1];

  if (!last || last.role !== 'user' || typeof last.content !== 'string' || !last.content.trim()) {
    return NextResponse.json({ error: 'Пустое сообщение' }, { status: 400 });
  }

  if (last.content.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: 'Сообщение слишком длинное' }, { status: 400 });
  }

  const ip = clientIp(request);
  if (!checkRateLimit(`consultant:ip:${ip}`, PER_IP_LIMIT, RATE_WINDOW_MS)) {
    return NextResponse.json(
      { error: 'Слишком много сообщений подряд — подождите минуту.' },
      { status: 429 },
    );
  }
  if (!checkRateLimit('consultant:global', GLOBAL_LIMIT, RATE_WINDOW_MS)) {
    return NextResponse.json(
      { error: 'Консультант сейчас загружен — попробуйте через минуту.' },
      { status: 429 },
    );
  }

  if (!process.env.SIBERI_API_KEY) {
    return NextResponse.json(
      { error: 'Консультант временно недоступен — не настроен ключ AI-провайдера.' },
      { status: 503 }
    );
  }

  // Ответ отдаём ПОТОКОМ (NDJSON): {"delta":"…"} по мере генерации, в конце {"done":true}.
  // Так первые буквы появляются за ~2с (partialResult), а не после всего ответа за ~6с —
  // как быстрый виджет на siberi.online. Ошибки до начала потока — обычным JSON выше.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      try {
        for await (const delta of askSiberiStream(CONSULTANT_SYSTEM_PROMPT, buildUserPrompt(messages), { timeoutMs: 45000 })) {
          if (delta) send({ delta });
        }
        send({ done: true });
      } catch (error) {
        console.error('consultant error:', error);
        send({ error: 'Не получилось получить ответ. Попробуйте ещё раз чуть позже.' });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no', // nginx: не буферизовать поток
    },
  });
}
