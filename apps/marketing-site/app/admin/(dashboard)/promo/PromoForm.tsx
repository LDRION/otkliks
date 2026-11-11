'use client';

import { useActionState, useState } from 'react';
import { createPromoAction } from './actions';

export function PromoForm({ siteUrl }: { siteUrl: string }) {
  const [state, action, pending] = useActionState(createPromoAction, undefined);
  const [copied, setCopied] = useState(false);
  const link = state?.created ? `${siteUrl}/promo/${state.created}` : '';

  return (
    <form action={action}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
        Кому и почему (видно только в админке)
        <input name="note" maxLength={500} placeholder="Например: Анна, полгода без ответов на отклики, выгорание" />
      </label>
      <div className="admin-form-grid">
        <label>Дней полного автопилота<input name="trialDays" type="number" min={0} max={30} defaultValue={3} /></label>
        <label>Откликов в день<input name="trialDailyCap" type="number" min={10} max={200} defaultValue={200} /></label>
        <label>Скидка на первую оплату, %<input name="discountPercent" type="number" min={0} max={90} defaultValue={50} /></label>
        <label>Скидка действует, дней<input name="discountValidDays" type="number" min={1} max={90} defaultValue={14} /></label>
        <label>Сколько человек может активировать<input name="maxRedemptions" type="number" min={1} max={10000} defaultValue={1} /></label>
        <label>Ссылка живёт, дней (0 — бессрочно)<input name="expiresInDays" type="number" min={0} max={365} defaultValue={30} /></label>
      </div>
      <button type="submit" className="btn btn--primary" disabled={pending} style={{ marginTop: 16 }}>
        {pending ? 'Создаём…' : 'Создать ссылку'}
      </button>
      {state?.error && <p className="admin-login-error" style={{ marginTop: 10 }}>{state.error}</p>}
      {link && (
        <div className="partner-link" style={{ marginTop: 14 }}>
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn btn--ghost" onClick={async () => {
            try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* выделите вручную */ }
          }}>{copied ? 'Скопировано' : 'Скопировать'}</button>
        </div>
      )}
    </form>
  );
}
