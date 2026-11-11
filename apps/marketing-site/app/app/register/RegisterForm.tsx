'use client';

import { useActionState } from 'react';
import { registerCustomer } from './actions';

export function RegisterForm() {
  const [state, formAction, pending] = useActionState(registerCustomer, undefined);

  return (
    <form action={formAction} className="admin-login-form">
      <div className="field">
        <label>Имя</label>
        <input name="fullName" placeholder="Как к вам обращаться" />
      </div>
      <div className="field">
        <label>Email</label>
        <input name="email" type="email" required autoComplete="username" />
      </div>
      <div className="field">
        <label>Пароль</label>
        <input name="password" type="password" required minLength={8} autoComplete="new-password" />
      </div>
      <label className="consent-check">
        <input type="checkbox" name="consent" required />
        <span>
          Даю <a href="/consent" target="_blank" rel="noopener">согласие на обработку персональных данных</a>
        </span>
      </label>
      {state?.error && <p className="admin-login-error">{state.error}</p>}
      <button type="submit" className="btn btn--primary" disabled={pending} style={{ width: '100%' }}>
        {pending ? 'Создаём…' : 'Создать аккаунт'}
      </button>
      <p className="muted consent-note">
        Создавая аккаунт, вы принимаете условия <a href="/oferta" target="_blank" rel="noopener">оферты</a> и{' '}
        <a href="/privacy" target="_blank" rel="noopener">политику конфиденциальности</a>.
      </p>
      <p className="muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>
        Уже есть аккаунт? <a href="/app/login" style={{ color: 'var(--accent)' }}>Войти</a>
      </p>
    </form>
  );
}
