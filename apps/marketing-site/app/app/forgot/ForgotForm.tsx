'use client';

import { useActionState } from 'react';
import { requestPasswordReset } from './actions';

export function ForgotForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, undefined);

  if (state?.sent) {
    return (
      <div>
        <p style={{ fontSize: '0.95rem', lineHeight: 1.6 }}>
          Если аккаунт с таким адресом существует, мы отправили на него письмо со ссылкой
          для смены пароля. Ссылка действует час.
        </p>
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: 14, lineHeight: 1.6 }}>
          Письма нет через пару минут? Загляните в «Спам» и проверьте, верно ли набран
          адрес. Если аккаунт заводили на другую почту — попробуйте её.
        </p>
        <a href="/app/login" className="btn btn--ghost" style={{ width: '100%', marginTop: 20 }}>
          Вернуться ко входу
        </a>
      </div>
    );
  }

  return (
    <form action={formAction} className="admin-login-form">
      <p className="muted" style={{ fontSize: '0.9rem', marginBottom: 18, lineHeight: 1.6 }}>
        Укажите адрес, на который зарегистрирован аккаунт — пришлём ссылку для смены пароля.
      </p>
      <div className="field">
        <label>Email</label>
        <input name="email" type="email" required autoComplete="username" autoFocus />
      </div>
      {state?.error && <p className="admin-login-error">{state.error}</p>}
      <button type="submit" className="btn btn--primary" disabled={pending} style={{ width: '100%' }}>
        {pending ? 'Отправляем…' : 'Прислать ссылку'}
      </button>
      <p className="muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>
        Вспомнили пароль? <a href="/app/login" style={{ color: 'var(--accent)' }}>Войти</a>
      </p>
    </form>
  );
}
