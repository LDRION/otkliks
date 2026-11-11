'use client';

import { useActionState } from 'react';
import { changePasswordAction } from '../settingsActions';

export function SecurityForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, undefined);

  return (
    <form action={formAction} style={{ display: 'grid', gap: 10, maxWidth: 320 }}>
      <input type="password" name="currentPassword" placeholder="Текущий пароль" autoComplete="current-password" required />
      <input type="password" name="newPassword" placeholder="Новый пароль (минимум 8 символов)" autoComplete="new-password" required minLength={8} />
      <button type="submit" className="btn btn--ghost" style={{ width: 'auto' }} disabled={pending}>
        {pending ? 'Меняю…' : 'Сменить пароль'}
      </button>
      {state?.error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{state.error}</p>}
      {state?.success && <p style={{ color: 'var(--success)', fontSize: '0.85rem' }}>Пароль изменён.</p>}
    </form>
  );
}
