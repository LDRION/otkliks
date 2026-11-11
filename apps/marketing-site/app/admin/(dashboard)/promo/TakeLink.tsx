'use client';

import { useActionState, useState } from 'react';
import { takePromoAction } from './actions';

// «Взять ссылку»: каждое нажатие — новая, ещё никому не выданная ссылка из запаса.
export function TakeLink({ siteUrl, free }: { siteUrl: string; free: number }) {
  const [state, action, pending] = useActionState(takePromoAction, undefined);
  const [copied, setCopied] = useState(false);
  const link = state?.code ? `${siteUrl}/promo/${state.code}` : '';

  return (
    <form action={action}>
      <div className="partner-payout__row" style={{ alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '2 1 260px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Кому (необязательно, видно только в админке)
          <input name="note" maxLength={500} placeholder="Например: Анна, VK, выгорание после 200 откликов" />
        </label>
        <button type="submit" className="btn btn--primary" disabled={pending || free === 0}>
          {pending ? 'Берём…' : 'Взять ссылку'}
        </button>
      </div>
      {state?.error && <p className="admin-login-error" style={{ marginTop: 10 }}>{state.error}</p>}
      {link && (
        <div className="partner-link" style={{ marginTop: 12 }}>
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn btn--ghost" onClick={async () => {
            try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* выделите вручную */ }
          }}>{copied ? 'Скопировано' : 'Скопировать'}</button>
        </div>
      )}
    </form>
  );
}
