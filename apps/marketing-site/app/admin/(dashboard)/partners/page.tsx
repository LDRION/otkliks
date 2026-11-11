import type { Metadata } from 'next';
import Link from 'next/link';
import { adminFetch, requireAdmin } from '@/lib/adminApi';
import { resolvePayoutAction, blockAffiliateAction, reverseCommissionAction } from './actions';

export const metadata: Metadata = { title: 'Партнёры', robots: { index: false, follow: false } };

type Aff = { id: string; email: string; code: string; blocked: boolean; clicks: number; referrals: number; paidReferrals: number; revenue: number; held: number; balance: number; reserved: number; totalEarned: number; totalWithdrawn: number };
type Payout = { id: string; amount: number; details: string; status: string; requestedAt: string; processedAt?: string; processedBy?: string; note?: string; email: string; code?: string; blocked?: boolean; referrals: number; totalEarned: number };
type Com = { _id: string; amount: number; paymentAmount: number; status: string; availableAt: string; createdAt: string; email: string };

const rub = (n = 0) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;
const date = (s?: string) => (s ? new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export default async function AdminPartnersPage({ searchParams }: { searchParams: Promise<{ aff?: string; err?: string }> }) {
  const session = await requireAdmin('admin');
  const isOwner = session.role === 'owner';
  const { aff, err } = await searchParams;
  const selected = aff && /^[a-f0-9]{24}$/.test(aff) ? aff : null;

  const [{ affiliates, terms }, { payouts }, history, commissions] = await Promise.all([
    adminFetch<{ affiliates: Aff[]; terms: { rate: number; holdDays: number; minPayout: number } }>(session, '/affiliates'),
    adminFetch<{ payouts: Payout[] }>(session, '/payouts?status=pending'),
    adminFetch<{ payouts: Payout[] }>(session, '/payouts?status=approved'),
    selected ? adminFetch<{ commissions: Com[] }>(session, `/affiliates/${selected}/commissions`) : Promise.resolve(null),
  ]);
  const sel = selected ? affiliates.find((a) => a.id === selected) : null;

  // Воронка по всей программе: переходы → регистрации → платящие → деньги.
  const sum = (f: (a: Aff) => number) => affiliates.reduce((s, a) => s + (f(a) || 0), 0);
  const clicks = sum((a) => a.clicks), regs = sum((a) => a.referrals), payers = sum((a) => a.paidReferrals);
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
      <h1 style={{ fontSize: '1.6rem' }}>Партнёры</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        {Math.round(terms.rate * 100)}% с каждой оплаты приглашённых, удержание {terms.holdDays} дней, вывод от {rub(terms.minPayout)}.
        {!isOwner && ' Одобрять выплаты может только владелец.'}
      </p>
      {err === 'conflict' && (
        <p className="admin-login-error" style={{ marginTop: 16 }}>
          Действие не выполнено: статус уже изменился, или деньги по этой комиссии уже выведены / зарезервированы к выводу. Такой случай решается вручную.
        </p>
      )}
      {err === 'failed' && <p className="admin-login-error" style={{ marginTop: 16 }}>Не получилось — попробуйте ещё раз.</p>}

      <div className="partner-stats">
        <div className="card"><span className="muted">Партнёров / приводят платящих</span><b>{affiliates.length} / {affiliates.filter((a) => a.paidReferrals > 0).length}</b></div>
        <div className="card"><span className="muted">Переходов по ссылкам</span><b>{clicks}</b></div>
        <div className="card"><span className="muted">Регистраций</span><b>{regs}</b><span className="muted">{pct(regs, clicks)} от переходов</span></div>
        <div className="card"><span className="muted">Платящих</span><b>{payers}</b><span className="muted">{pct(payers, regs)} от регистраций</span></div>
        <div className="card"><span className="muted">Выручка от приглашённых</span><b>{rub(sum((a) => a.revenue))}</b></div>
        <div className="card"><span className="muted">Начислено партнёрам</span><b>{rub(sum((a) => a.totalEarned))}</b><span className="muted">выплачено {rub(sum((a) => a.totalWithdrawn))}</span></div>
        <div className="card"><span className="muted">Должны партнёрам</span><b>{rub(sum((a) => a.held + a.balance + a.reserved))}</b><span className="muted">из них к выводу {rub(sum((a) => a.balance + a.reserved))}</span></div>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <b>Запросы на вывод</b>
        {payouts.length === 0 ? <p className="muted" style={{ marginTop: 8 }}>Новых запросов нет.</p> : (
          <table className="admin-table" style={{ marginTop: 12 }}>
            <thead><tr><th>Партнёр</th><th className="num">Сумма</th><th>Реквизиты</th><th /></tr></thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.email} <span className="muted">({p.code})</span>
                    <div className="muted" style={{ fontSize: '0.82rem' }}>приглашено {p.referrals}, заработано {rub(p.totalEarned)}, запрос {date(p.requestedAt)}</div>
                    {p.blocked && <span className="admin-pill admin-pill--off">заблокирован</span>}
                  </td>
                  <td className="num"><b>{rub(p.amount)}</b></td>
                  <td style={{ wordBreak: 'break-word' }}>{p.details}</td>
                  <td>
                    {isOwner ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <form action={resolvePayoutAction}>
                          <input type="hidden" name="id" value={p.id} /><input type="hidden" name="approve" value="1" />
                          <button type="submit" className="btn btn--primary btn--sm">Выплачено</button>
                        </form>
                        <form action={resolvePayoutAction} style={{ display: 'flex', gap: 6 }}>
                          <input type="hidden" name="id" value={p.id} /><input type="hidden" name="approve" value="0" />
                          <input name="note" placeholder="причина" maxLength={200} style={{ width: 120 }} />
                          <button type="submit" className="btn-quiet">Отклонить</button>
                        </form>
                      </div>
                    ) : <span className="muted">ждёт владельца</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted" style={{ fontSize: '0.82rem', marginTop: 10 }}>
          «Выплачено» нажимайте после того, как перевели деньги. Отклонение возвращает сумму на баланс партнёра.
        </p>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <b>Все партнёры</b>
        {affiliates.length === 0 ? <p className="muted" style={{ marginTop: 8 }}>Пока никто не присоединился.</p> : (
          <table className="admin-table" style={{ marginTop: 12 }}>
            <thead><tr><th>Партнёр</th><th className="num">Переходы</th><th className="num">Регистрации / платят</th><th className="num">Выручка</th><th className="num">Удержание</th><th className="num">Доступно</th><th className="num">Выплачено</th><th /></tr></thead>
            <tbody>
              {affiliates.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/admin/partners?aff=${a.id}`} style={{ color: 'var(--accent)' }}>{a.email}</Link> <span className="muted">({a.code})</span>
                    {a.blocked && <> <span className="admin-pill admin-pill--off">заблокирован</span></>}
                  </td>
                  <td className="num">{a.clicks}</td>
                  <td className="num">{a.referrals} / {a.paidReferrals}</td>
                  <td className="num">{rub(a.revenue)}</td>
                  <td className="num">{rub(a.held)}</td>
                  <td className="num">{rub(a.balance)}{a.reserved ? <div className="muted">+{rub(a.reserved)} в запросе</div> : null}</td>
                  <td className="num">{rub(a.totalWithdrawn)}</td>
                  <td>
                    {isOwner && (
                      <form action={blockAffiliateAction}>
                        <input type="hidden" name="id" value={a.id} /><input type="hidden" name="blocked" value={a.blocked ? '0' : '1'} />
                        <button type="submit" className="btn-quiet">{a.blocked ? 'Разблокировать' : 'Заблокировать'}</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {sel && commissions && (
        <div className="card" style={{ marginTop: 24 }}>
          <b>Начисления: {sel.email}</b>
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: 6 }}>Если оплату приглашённого вернули — отмените комиссию за неё.</p>
          <table className="admin-table" style={{ marginTop: 12 }}>
            <thead><tr><th>За кого</th><th className="num">Оплата</th><th className="num">Комиссия</th><th>Статус</th><th /></tr></thead>
            <tbody>
              {commissions.commissions.map((c) => (
                <tr key={c._id}>
                  <td>{c.email} <span className="muted">{date(c.createdAt)}</span></td>
                  <td className="num">{rub(c.paymentAmount)}</td>
                  <td className="num">{rub(c.amount)}</td>
                  <td>{c.status === 'held' ? `удержание до ${date(c.availableAt)}` : c.status === 'available' ? 'доступно' : 'отменено'}</td>
                  <td>
                    {isOwner && c.status !== 'reversed' && (
                      <form action={reverseCommissionAction}>
                        <input type="hidden" name="id" value={c._id} /><input type="hidden" name="aff" value={sel.id} />
                        <button type="submit" className="btn-quiet">Отменить</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {history.payouts.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <b>Проведённые выплаты</b>
          <table className="admin-table" style={{ marginTop: 12 }}>
            <tbody>
              {history.payouts.slice(0, 50).map((p) => (
                <tr key={p.id}><td>{p.email}</td><td className="num">{rub(p.amount)}</td><td className="muted">{date(p.processedAt)} · {p.processedBy}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
