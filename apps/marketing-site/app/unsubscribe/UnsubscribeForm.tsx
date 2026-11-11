'use client';

import { useActionState } from 'react';
import { unsubscribeAction } from './actions';

// Кнопка, а не отписка по самому переходу: почтовые антивирусы и превью открывают
// ссылки из писем сами — без подтверждения людей отписывало бы без их ведома.
export function UnsubscribeForm({ u, t }: { u: string; t: string }) {
  const [state, action, pending] = useActionState(unsubscribeAction, undefined);
  if (state?.ok) return <p className="email-flash email-flash--ok">Готово — подсказки больше не придут. Служебные письма (чеки, восстановление пароля) останутся.</p>;
  return (
    <form action={action}>
      <input type="hidden" name="u" value={u} />
      <input type="hidden" name="t" value={t} />
      <button type="submit" className="btn btn--primary" disabled={pending}>{pending ? 'Отписываем…' : 'Отписаться от подсказок'}</button>
      {state?.error && <p className="admin-login-error" style={{ marginTop: 12 }}>{state.error}</p>}
    </form>
  );
}
