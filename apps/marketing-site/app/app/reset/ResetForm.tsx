'use client';

import { useActionState } from 'react';
import { resetPassword } from './actions';

export function ResetForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(resetPassword, undefined);

  return (
    <form action={formAction} className="admin-login-form">
      {/* Токен из ссылки — скрытым полем, чтобы не тащить его через URL повторно. */}
      <input type="hidden" name="token" value={token} />
      <p className="muted" style={{ fontSize: '0.9rem', marginBottom: 18, lineHeight: 1.6 }}>
        Придумайте новый пароль — минимум 8 символов. После сохранения мы сразу откроем
        вам личный кабинет.
      </p>
      <div className="field">
        <label>Новый пароль</label>
        <input name="password" type="password" required minLength={8} autoComplete="new-password" autoFocus />
      </div>
      <div className="field">
        <label>Повторите пароль</label>
        <input name="confirm" type="password" required minLength={8} autoComplete="new-password" />
      </div>
      {state?.error && <p className="admin-login-error">{state.error}</p>}
      <button type="submit" className="btn btn--primary" disabled={pending} style={{ width: '100%' }}>
        {pending ? 'Сохраняем…' : 'Сохранить пароль'}
      </button>
    </form>
  );
}
