'use client';

import { useActionState, useState } from 'react';
import { requestPartnerPayout } from './actions';

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="partner-link">
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Ваша партнёрская ссылка" />
      <button
        type="button"
        className="btn btn--primary"
        onClick={async () => {
          try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* браузер запретил — поле выделяется само */ }
        }}
      >
        {copied ? 'Скопировано' : 'Скопировать'}
      </button>
    </div>
  );
}

export function PayoutForm({ balance, min, noEmail = false }: { balance: number; min: number; noEmail?: boolean }) {
  const [state, action, pending] = useActionState(requestPartnerPayout, undefined);
  const can = balance >= min;
  return (
    <form action={action} className="partner-payout">
      <div className="partner-payout__row">
        <label>
          Сумма, ₽
          <input name="amount" type="number" min={min} max={Math.floor(balance)} step={1} defaultValue={Math.floor(balance) || ''} required disabled={!can} />
        </label>
        <label style={{ flex: 2 }}>
          Куда перевести
          <input
            name="details" required maxLength={300} disabled={!can}
            placeholder={noEmail ? 'Карта или телефон для СБП, банк и как с вами связаться' : 'Номер карты или телефон для СБП и банк'}
          />
        </label>
      </div>
      {noEmail && (
        <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 12px' }}>
          В аккаунте нет почты — если по выплате возникнет вопрос, мы свяжемся по контакту
          из этого поля (телефон или Telegram). Можно и просто указать почту в настройках.
        </p>
      )}
      <button type="submit" className="btn btn--primary" disabled={!can || pending}>
        {pending ? 'Отправляем…' : 'Запросить вывод'}
      </button>
      {!can && <p className="muted" style={{ fontSize: '0.88rem', marginTop: 8 }}>Вывод доступен от {min.toLocaleString('ru-RU')} ₽ на балансе.</p>}
      {state?.error && <p className="admin-login-error" style={{ marginTop: 10 }}>{state.error}</p>}
      {state?.ok && <p className="email-flash email-flash--ok" style={{ marginTop: 10 }}>{state.ok}</p>}
    </form>
  );
}
