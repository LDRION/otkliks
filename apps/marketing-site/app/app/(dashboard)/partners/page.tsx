import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCustomerSession } from '@/lib/customerAuthSession';
import { coreApiFetch } from '@/lib/coreApi';
import { SITE_URL } from '@/lib/site';
import { joinPartnerProgram } from './actions';
import { CopyLink, PayoutForm } from './PartnerTools';

export const metadata: Metadata = { title: 'Партнёрская программа', robots: { index: false, follow: false } };

type Me = {
  joined: boolean;
  noEmail?: boolean;
  terms: { rate: number; holdDays: number; minPayout: number };
  code?: string; blocked?: boolean;
  held?: number; balance?: number; reserved?: number; totalEarned?: number; totalWithdrawn?: number;
  referralsCount?: number;
  clicks?: number;
  referrals?: { who: string; at: string; paid: boolean }[];
  commissions?: { amount: number; paymentAmount: number; status: string; availableAt: string; at: string }[];
  payouts?: { amount: number; status: string; requestedAt: string; processedAt?: string; note: string }[];
};

const rub = (n = 0) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;
const date = (s: string) => new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
const STATUS: Record<string, string> = {
  held: 'на удержании', available: 'доступно', reversed: 'отменено',
  pending: 'на рассмотрении', approved: 'выплачено', rejected: 'отклонено',
};

export default async function PartnersPage() {
  const session = await getCustomerSession();
  if (!session) redirect('/app/login');
  const me = await coreApiFetch<Me>('/api/affiliate/me', { token: session.coreApiToken });
  const pct = Math.round(me.terms.rate * 100);

  if (!me.joined) {
    return (
      <div className="container" style={{ paddingTop: 40, paddingBottom: 60, maxWidth: 820 }}>
        <h1 style={{ fontSize: '1.6rem' }}>Партнёрская программа</h1>
        <div className="card" style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: '1.25rem' }}>{pct}% с каждой оплаты тех, кого вы приведёте</h2>
          <ul className="partner-terms">
            <li>Делитесь своей ссылкой — в соцсетях, в чатах, с друзьями, которые ищут работу.</li>
            <li>Человек, зарегистрировавшийся по ней, закрепляется за вами <b>навсегда</b>: {pct}% от каждой его оплаты — ваши, не только от первой.</li>
            <li>Комиссия становится доступной к выводу через {me.terms.holdDays} дней после оплаты — это срок, в который оплату могут вернуть.</li>
            <li>Вывод — от {rub(me.terms.minPayout)} на карту или по СБП.</li>
          </ul>
          <form action={joinPartnerProgram} style={{ marginTop: 20 }}>
            <button type="submit" className="btn btn--primary">Стать партнёром</button>
          </form>
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: 14 }}>
            Нажимая кнопку, вы принимаете <Link href="/partners" style={{ color: 'var(--accent)' }}>условия партнёрской программы</Link>.
          </p>
        </div>
      </div>
    );
  }

  const link = `${SITE_URL}/p/${me.code}`;
  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
      <h1 style={{ fontSize: '1.6rem' }}>Партнёрская программа</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        {pct}% с каждой оплаты приглашённых — навсегда. <Link href="/partners" style={{ color: 'var(--accent)' }}>Условия</Link>
      </p>
      {me.blocked && (
        <p className="email-flash email-flash--err">Начисления и выплаты по вашему аккаунту приостановлены. Напишите на support@otkliks.ru.</p>
      )}

      <div className="card" style={{ marginTop: 24 }}>
        <b>Ваша ссылка</b>
        <CopyLink url={link} />
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: 8 }}>
          Ссылка постоянная — скопируйте и делитесь где угодно. Кто перейдёт по ней и
          зарегистрируется, закрепится за вами навсегда.
        </p>
      </div>

      <div className="partner-stats">
        <div className="card"><span className="muted">Переходов по ссылке</span><b>{me.clicks || 0}</b></div>
        <div className="card"><span className="muted">Зарегистрировались</span><b>{me.referralsCount}</b></div>
        <div className="card"><span className="muted">Из них платят</span><b>{(me.referrals || []).filter((r) => r.paid).length}</b></div>
        <div className="card"><span className="muted">На удержании</span><b>{rub(me.held)}</b></div>
        <div className="card"><span className="muted">Доступно к выводу</span><b>{rub(me.balance)}</b></div>
        <div className="card"><span className="muted">Выплачено</span><b>{rub(me.totalWithdrawn)}</b></div>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <b>Вывод средств</b>
        {(me.reserved || 0) > 0 && <p className="muted" style={{ marginTop: 6 }}>На рассмотрении: {rub(me.reserved)}</p>}
        <PayoutForm balance={me.balance || 0} min={me.terms.minPayout} noEmail={!!me.noEmail} />
      </div>

      <div className="grid grid--2" style={{ gap: 24, marginTop: 24 }}>
        <div className="card">
          <b>Приглашённые</b>
          {me.referrals?.length ? (
            <table className="partner-table">
              <tbody>
                {me.referrals.map((r, i) => (
                  <tr key={i}><td>{r.who}</td><td className="muted">{date(r.at)}</td><td>{r.paid ? 'платит' : '—'}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted" style={{ marginTop: 8 }}>Пока никого — поделитесь ссылкой.</p>}
        </div>
        <div className="card">
          <b>Начисления</b>
          {me.commissions?.length ? (
            <table className="partner-table">
              <tbody>
                {me.commissions.map((c, i) => (
                  <tr key={i}>
                    <td>{rub(c.amount)}</td>
                    <td className="muted">с {rub(c.paymentAmount)}</td>
                    <td>{c.status === 'held' ? `до ${date(c.availableAt)}` : STATUS[c.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted" style={{ marginTop: 8 }}>Начисления появятся после первой оплаты приглашённого.</p>}
        </div>
      </div>

      {!!me.payouts?.length && (
        <div className="card" style={{ marginTop: 24 }}>
          <b>История выплат</b>
          <table className="partner-table">
            <tbody>
              {me.payouts.map((p, i) => (
                <tr key={i}><td>{rub(p.amount)}</td><td className="muted">{date(p.requestedAt)}</td><td>{STATUS[p.status]}{p.note ? ` — ${p.note}` : ''}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
