'use client';

import { useActionState } from 'react';
import { login } from './actions';

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, undefined);

  return (
    <form action={formAction} className="admin-login-form">
      <div className="field">
        <label>Email</label>
        <input name="email" type="email" required autoComplete="username" placeholder="you@otkliks.ru" />
      </div>
      <div className="field">
        <label>Пароль</label>
        <input name="password" type="password" required autoComplete="current-password" placeholder="••••••••" />
      </div>
      {state?.error && <p className="admin-login-error">{state.error}</p>}
      <button type="submit" className="btn btn--primary" disabled={pending} style={{ width: '100%' }}>
        {pending ? 'Входим…' : 'Войти'}
      </button>
    </form>
  );
}
