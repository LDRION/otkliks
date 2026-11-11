'use client';

import { useState, useRef, useEffect, type FormEvent } from 'react';
import { usePathname } from 'next/navigation';
import { SupportIcon } from './SupportIcon';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

const GREETING: ChatMessage = {
  role: 'assistant',
  content: 'Привет! Я AI-консультант Откликс. Спросите что угодно про сервис, тарифы или как это работает.',
};

export function ConsultantWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, pending]);

  if (pathname?.startsWith('/admin')) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const content = input.trim();
    if (!content || pending) return;

    const next = [...messages, { role: 'user' as const, content }];
    setMessages(next);
    setInput('');
    setError(null);
    setPending(true);

    try {
      const res = await fetch('/api/consultant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });

      // Ошибки валидации/недоступности приходят обычным JSON (без потока).
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || 'Ошибка');
      }

      // Поток NDJSON: {"delta":"…"} по мере генерации → показываем текст «печатается»,
      // как на siberi.online. Первое слово появляется за ~2с, а не после всего ответа.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let acc = '';
      let started = false;

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let obj: { delta?: string; done?: boolean; error?: string };
          try { obj = JSON.parse(line); } catch { continue; }
          if (obj.error) throw new Error(obj.error);
          if (obj.delta) {
            acc += obj.delta;
            if (!started) {
              started = true;
              setPending(false);
              setMessages((cur) => [...cur, { role: 'assistant', content: acc }]);
            } else {
              setMessages((cur) => {
                const c = cur.slice();
                c[c.length - 1] = { role: 'assistant', content: acc };
                return c;
              });
            }
          }
        }
      }
      if (!started) throw new Error('Не получилось получить ответ. Попробуйте ещё раз.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не получилось получить ответ');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={`consultant${open ? ' is-open' : ''}`}>
      {/* Панель смонтирована всегда и открывается/закрывается через класс — это даёт
          плавное появление и исчезновение (иначе размонтирование обрывало бы анимацию).
          Позиционирована абсолютно, поэтому в закрытом виде не занимает место и не
          толкает пузырь вверх. */}
      <div className={`consultant-panel card${open ? ' is-open' : ''}`} aria-hidden={!open}>
        <div className="consultant-header">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <SupportIcon size={22} />
            <b>AI-консультант</b>
          </span>
          <button
            type="button"
            className="consultant-close"
            onClick={() => setOpen(false)}
            aria-label="Закрыть чат"
            tabIndex={open ? 0 : -1}
          >
            ✕
          </button>
        </div>

        <div className="consultant-messages" ref={scrollRef}>
          {messages.map((m, i) => (
            <div key={i} className={`consultant-msg consultant-msg--${m.role}`}>
              {m.content}
            </div>
          ))}
          {pending && (
            <div className="consultant-msg consultant-msg--assistant consultant-typing">
              <span />
              <span />
              <span />
            </div>
          )}
          {error && <div className="consultant-error">{error}</div>}
        </div>

        <form className="consultant-input-row" onSubmit={handleSubmit}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Спросите что-нибудь…"
            disabled={pending}
            maxLength={2000}
            tabIndex={open ? 0 : -1}
          />
          <button type="submit" className="btn btn--primary" disabled={pending || !input.trim()} tabIndex={open ? 0 : -1}>
            →
          </button>
        </form>
      </div>

      <div className="consultant-launcher">
        {!open && <span className="consultant-hint">Задайте вопрос — мы онлайн 24/7</span>}
        <button
          type="button"
          className={`consultant-bubble${open ? ' is-open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Закрыть консультанта' : 'Открыть консультанта'}
        >
          {/* Обе «грани» всегда в DOM — иконка и крестик плавно перетекают друг в друга
              (поворот + прозрачность), а не подменяются мгновенно. */}
          <span className="consultant-face consultant-face--icon">
            <SupportIcon size={56} />
          </span>
          <span className="consultant-face consultant-face--x" aria-hidden="true">✕</span>
        </button>
      </div>
    </div>
  );
}
