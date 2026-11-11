'use client';

import { useActionState } from 'react';
import { requestEmailAction } from './emailActions';

// Плашка для аккаунтов из VK без почты. Без адреса человек не получит ни чек
// об оплате, ни ссылку восстановления доступа — поэтому стоит высоко в кабинете,
// а не прячется в настройках, куда заходят редко.
export function EmailPrompt({ pendingEmail }: { pendingEmail: string | null }) {
  const [state, formAction, pending] = useActionState(requestEmailAction, undefined);
  const sentTo = state?.sentTo || pendingEmail;

  return (
    <div className="card email-prompt" style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: '1.15rem' }}>Укажите почту</h2>
      {sentTo ? (
        <p className="muted" style={{ marginTop: 8, lineHeight: 1.6 }}>
          Письмо для подтверждения отправлено на <b style={{ color: 'var(--text)' }}>{sentTo}</b>.
          Откройте его и нажмите «Подтвердить почту». Письма нет — загляните в «Спам»
          или укажите адрес ещё раз ниже.
        </p>
      ) : (
        <p className="muted" style={{ marginTop: 8, lineHeight: 1.6 }}>
          Вы вошли через VK, и он не передал нам адрес почты. Без неё мы не сможем
          прислать чек об оплате, напоминание об окончании подписки и ссылку для
          восстановления доступа.
        </p>
      )}
      <form action={formAction} className="email-prompt__form">
        <input
          name="email"
          type="email"
          required
          placeholder="you@example.ru"
          autoComplete="email"
          aria-label="Адрес почты"
        />
        <button type="submit" className="btn btn--primary" disabled={pending}>
          {pending ? 'Отправляем…' : sentTo ? 'Отправить ещё раз' : 'Подтвердить'}
        </button>
      </form>
      {state?.error && <p className="admin-login-error" style={{ marginTop: 10 }}>{state.error}</p>}
    </div>
  );
}
