'use client';

import { useActionState } from 'react';
import { markUserAction, type MarkState } from '../actions';
import s from '../clients.module.css';

export function MarkForm({ id, internal, note }: { id: string; internal: boolean; note: string }) {
  const [state, action, pending] = useActionState<MarkState, FormData>(markUserAction, undefined);
  return (
    <form action={action} className={s.markForm}>
      <input type="hidden" name="id" value={id} />
      <label className={s.check}>
        <input type="checkbox" name="internal" defaultChecked={internal} />
        Это наш аккаунт — не считать в реальных пользователях и в «Росте»
      </label>
      <textarea name="note" defaultValue={note} rows={2} maxLength={500} placeholder="Заметка: кто это, откуда знаем" />
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button type="submit" className="btn btn--line" disabled={pending}>{pending ? 'Сохраняю…' : 'Сохранить'}</button>
        {state?.saved && <span className={s.saved}>Сохранено</span>}
        {state?.error && <span style={{ color: 'var(--danger, #c4382f)', fontSize: '0.85rem' }}>{state.error}</span>}
      </div>
    </form>
  );
}
