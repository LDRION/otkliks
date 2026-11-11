import type { Metadata } from 'next';
import { adminFetch, requireAdmin } from '@/lib/adminApi';

export const metadata: Metadata = { title: 'Облачный тариф — спрос', robots: { index: false, follow: false } };

type Waitlist = {
  total: number; new7: number; new30: number; registered: number; paying: number; everPaid: number;
  bySource: { source: string; count: number }[];
  weeks: { from: string; count: number; reveals: number }[];
  reveals: { total: number; new7: number; new30: number; withAccount: number; bySource: { source: string; count: number }[] };
  entries: { email: string; name: string; at: string; source: string; referrer: string; account: boolean; paying: boolean; paid: number }[];
};

const date = (s: string) => new Date(s).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
const rub = (n = 0) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;

// Порог «строим облако» — ориентир, а не закон: 20–30 записавшихся за месяц, и
// особенно — сколько из них уже платят за локальный тариф.
const GOAL = 30;

export default async function WaitlistPage() {
  const session = await requireAdmin('admin');
  const w = await adminFetch<Waitlist>(session, '/waitlist');
  const max = Math.max(1, ...w.weeks.map((x) => Math.max(x.count, x.reveals)));
  const conv = w.reveals.total ? Math.round((w.total / w.reveals.total) * 100) : null;
  const progress = Math.min(100, Math.round((w.new30 / GOAL) * 100));

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
      <h1 style={{ fontSize: '1.6rem' }}>Облачный тариф — спрос</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        Кто нажал «Сообщить о запуске» в карточке облачного тарифа. Ориентир, чтобы начинать
        строить: {GOAL} человек за месяц — особенно из тех, кто уже платит.
      </p>

      <div className="partner-stats">
        <div className="card"><span className="muted">Открыли описание на главной</span><b>{w.reveals.total}</b><span className="muted">+{w.reveals.new7} за 7 дней · уникальные</span></div>
        <div className="card"><span className="muted">Из них оставили почту</span><b>{conv === null ? '—' : `${conv}%`}</b><span className="muted">{w.total} из {w.reveals.total}</span></div>
        <div className="card"><span className="muted">Всего в листе</span><b>{w.total}</b><span className="muted">+{w.new7} за 7 дней</span></div>
        <div className="card">
          <span className="muted">За 30 дней</span><b>{w.new30} / {GOAL}</b>
          <div className="waitlist-bar"><i style={{ width: `${progress}%` }} /></div>
        </div>
        <div className="card"><span className="muted">С аккаунтом Откликса</span><b>{w.registered}</b><span className="muted">из {w.total}</span></div>
        <div className="card"><span className="muted">Уже платят сейчас</span><b>{w.paying}</b><span className="muted">платили хоть раз: {w.everPaid}</span></div>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <b>По неделям</b>
        <p className="muted" style={{ fontSize: '0.85rem', margin: '4px 0 0' }}>
          <span className="waitlist-legend waitlist-legend--reveal" /> открыли описание{' '}
          <span className="waitlist-legend" /> оставили почту
        </p>
        <div className="waitlist-weeks">
          {w.weeks.map((x) => (
            <div key={x.from} className="waitlist-weeks__col" title={`с ${date(x.from)}: открыли ${x.reveals}, почту оставили ${x.count}`}>
              <span>{x.reveals || x.count ? `${x.reveals} / ${x.count}` : ''}</span>
              <div className="waitlist-weeks__bars">
                <i className="is-reveal" style={{ height: `${Math.round((x.reveals / max) * 100)}%` }} />
                <i style={{ height: `${Math.round((x.count / max) * 100)}%` }} />
              </div>
              <small>{date(x.from)}</small>
            </div>
          ))}
        </div>
      </div>

      {w.reveals.bySource.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <b>Откуда пришли те, кто открыл описание</b>
          <table className="admin-table" style={{ marginTop: 12 }}>
            <tbody>{w.reveals.bySource.map((s) => <tr key={s.source}><td>{s.source}</td><td className="num">{s.count}</td></tr>)}</tbody>
          </table>
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: 8 }}>С аккаунтом Откликса: {w.reveals.withAccount}.</p>
        </div>
      )}

      {w.bySource.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <b>Где оставляют почту</b>
          <table className="admin-table" style={{ marginTop: 12 }}>
            <tbody>{w.bySource.map((s) => <tr key={s.source}><td>{s.source}</td><td className="num">{s.count}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ marginTop: 24 }}>
        <b>Кто записался</b>
        {w.entries.length === 0 ? <p className="muted" style={{ marginTop: 8 }}>Пока никого — кнопка на главной и на странице тарифов.</p> : (
          <table className="admin-table" style={{ marginTop: 12 }}>
            <thead><tr><th>Почта</th><th>Когда</th><th>Где нажал</th><th>Откуда пришёл</th><th>Аккаунт</th></tr></thead>
            <tbody>
              {w.entries.map((e) => (
                <tr key={e.email}>
                  <td style={{ wordBreak: 'break-all' }}>{e.email}{e.name ? <div className="muted" style={{ fontSize: '0.82rem' }}>{e.name}</div> : null}</td>
                  <td>{date(e.at)}</td>
                  <td>{e.source}</td>
                  <td>{e.referrer || <span className="muted">—</span>}</td>
                  <td>
                    {e.paying ? <span className="admin-pill admin-pill--ok">платит</span>
                      : e.paid > 0 ? <span className="admin-pill">платил {rub(e.paid)}</span>
                      : e.account ? <span className="admin-pill">бесплатный</span>
                      : <span className="muted">нет</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
