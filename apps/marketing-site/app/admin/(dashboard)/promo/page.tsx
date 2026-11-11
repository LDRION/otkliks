import type { Metadata } from 'next';
import { adminFetch, requireAdmin } from '@/lib/adminApi';
import { SITE_URL } from '@/lib/site';
import { PromoForm } from './PromoForm';
import { togglePromoAction, refillStockAction } from './actions';
import { TakeLink } from './TakeLink';

export const metadata: Metadata = { title: 'Промо-ссылки', robots: { index: false, follow: false } };

type Promo = {
  id: string; code: string; note: string; active: boolean;
  trialDays: number; trialDailyCap: number; discountPercent: number; discountValidDays: number;
  maxRedemptions: number; redemptions: number; expiresAt: string | null; createdAt: string; createdBy: string;
  redeemed: { email: string; at: string; paid: number }[];
};

const date = (s: string) => new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

export default async function PromoPage() {
  const session = await requireAdmin('admin');
  const { promos, stockFree } = await adminFetch<{ promos: Promo[]; stockFree: number }>(session, '/promos');
  const isOwner = session.role === 'owner';
  const now = Date.now();

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
      <h1 style={{ fontSize: '1.6rem' }}>Промо-ссылки</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        Персональные предложения. По умолчанию — ваше: 3 дня полного автопилота и скидка 50% на первую
        оплату; ссылка одноразовая, чтобы её нельзя было раздать дальше.
      </p>

      <div className="card" style={{ marginTop: 24 }}>
        <b>Ссылки для раздачи</b>
        <p className="muted" style={{ fontSize: '0.88rem', margin: '6px 0 14px' }}>
          3 дня автопилота × 200 откликов, потом −50% на одну оплату (скидка действует 14 дней после
          активации). Каждое нажатие даёт новую ссылку, которую вы ещё никому не отдавали.
          В запасе: <b>{stockFree}</b>.
        </p>
        <TakeLink siteUrl={SITE_URL} free={stockFree} />
        {isOwner && stockFree < 20 && (
          <form action={refillStockAction} style={{ marginTop: 12 }}>
            <button type="submit" className="btn-quiet">Пополнить запас на 100</button>
          </form>
        )}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <b>Особая ссылка (свои условия)</b>
        <div style={{ marginTop: 12 }}><PromoForm siteUrl={SITE_URL} /></div>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <b>Выданные</b>
        {promos.length === 0 ? <p className="muted" style={{ marginTop: 8 }}>Пока ни одной.</p> : (
          <table className="admin-table" style={{ marginTop: 12 }}>
            <thead><tr><th>Ссылка и заметка</th><th>Условия</th><th>Кто активировал</th><th /></tr></thead>
            <tbody>
              {promos.map((p) => {
                const expired = p.expiresAt && new Date(p.expiresAt).getTime() < now;
                const used = p.redemptions >= p.maxRedemptions;
                const state = !p.active ? ['выключена', 'off'] : expired ? ['истекла', 'off'] : used ? ['использована', 'ok'] : ['ждёт', ''];
                return (
                  <tr key={p.id}>
                    <td>
                      <code style={{ userSelect: 'all' }}>{SITE_URL}/promo/{p.code}</code>
                      <div className="muted" style={{ marginTop: 4, fontSize: '0.85rem' }}>{p.note || 'без заметки'}</div>
                      <div className="muted" style={{ fontSize: '0.78rem', marginTop: 2 }}>{date(p.createdAt)} · {p.createdBy}</div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {p.trialDays > 0 && <div>{p.trialDays} дн. × {p.trialDailyCap}/день</div>}
                      {p.discountPercent > 0 && <div>−{p.discountPercent}% на {p.discountValidDays} дн.</div>}
                      <div className="muted">{p.redemptions}/{p.maxRedemptions}</div>
                    </td>
                    <td>
                      <span className={`admin-pill ${state[1] ? `admin-pill--${state[1]}` : ''}`}>{state[0]}</span>
                      {p.redeemed.map((r, i) => (
                        <div key={i} style={{ marginTop: 6, fontSize: '0.88rem' }}>
                          {r.email} <span className="muted">{date(r.at)}</span>
                          {r.paid > 0 ? <span className="admin-pill admin-pill--ok" style={{ marginLeft: 6 }}>оплатил {r.paid} ₽</span> : null}
                        </div>
                      ))}
                    </td>
                    <td>
                      <form action={togglePromoAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="active" value={p.active ? '0' : '1'} />
                        <button type="submit" className="btn-quiet">{p.active ? 'Выключить' : 'Включить'}</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
