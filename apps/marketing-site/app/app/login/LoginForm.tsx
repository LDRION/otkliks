'use client';

import { useActionState } from 'react';
import { loginCustomer } from './actions';

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginCustomer, undefined);

  return (
    <form action={formAction} className="admin-login-form">
      <div className="field">
        <label>Email</label>
        <input name="email" type="email" required autoComplete="username" />
      </div>
      <div className="field">
        <label>Пароль</label>
        <input name="password" type="password" required autoComplete="current-password" />
      </div>
      {state?.error && <p className="admin-login-error">{state.error}</p>}
      <button type="submit" className="btn btn--primary" disabled={pending} style={{ width: '100%' }}>
        {pending ? 'Входим…' : 'Войти'}
      </button>
      <p className="muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>
        Нет аккаунта? <a href="/app/register" style={{ color: 'var(--accent)' }}>Создать</a>
        {' · '}
        <a href="/app/forgot" style={{ color: 'var(--accent)' }}>Забыли пароль?</a>
      </p>
    </form>
  );
}
