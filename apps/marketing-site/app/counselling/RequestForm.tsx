'use client';

import { useActionState } from 'react';
import { submitCounsellingRequest } from './actions';

type Props = {
  defaultName?: string;
  defaultContact?: string;
};

export function RequestForm({ defaultName = '', defaultContact = '' }: Props) {
  const [state, formAction, pending] = useActionState(submitCounsellingRequest, undefined);

  if (state?.success) {
    return (
      <div className="card counselling-success">
        <p style={{ fontWeight: 600 }}>Заявка отправлена</p>
        <p className="muted" style={{ marginTop: 8 }}>
          Мария получит её и свяжется с вами по указанному контакту.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="admin-login-form counselling-form">
      <div className="field">
        <label>Как к вам обращаться</label>
        <input name="name" required maxLength={200} placeholder="Имя" defaultValue={defaultName} />
      </div>
      <div className="field">
        <label>Как с вами связаться</label>
        <input
          name="contact"
          required
          maxLength={200}
          placeholder="Telegram, email или телефон"
          defaultValue={defaultContact}
        />
      </div>
      <div className="field">
        <label>Коротко о ситуации</label>
        <textarea
          name="message"
          required
          rows={4}
          maxLength={4000}
          placeholder="Что беспокоит, что хотелось бы обсудить — можно в двух словах"
        />
      </div>
      {state?.error && <p className="admin-login-error">{state.error}</p>}
      <button type="submit" className="btn btn--primary" disabled={pending} style={{ width: '100%' }}>
        {pending ? 'Отправляем…' : 'Отправить заявку'}
      </button>
    </form>
  );
}
