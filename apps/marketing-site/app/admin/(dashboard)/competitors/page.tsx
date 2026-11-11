import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/adminApi';
import data from '@/lib/competitors/competitors.json';
import { latestEvidence } from '@/lib/evidence';
import { PRICE_CLAIM, PRICE_CLAIM_NOTE } from '@/lib/priceClaim';

export const metadata: Metadata = { title: 'Конкуренты', robots: { index: false, follow: false } };

// Разбор конкурентов и стратегия. Данные — lib/competitors/competitors.json:
// добавляем туда нового конкурента или меняем статус пункта стратегии — страница
// пересобирается сама.

type Mark = 'yes' | 'no' | 'partial' | 'soon' | '?';
type Comp = {
  id: string; name: string; url: string; type: string; priceMonth: number | null; self?: boolean;
  values: Record<string, [Mark, string]>; strengths: string[]; weaknesses: string[]; steal: string[];
};
type Item = { phase: number; area: string; action: string; why: string; beats: string[]; effort: string; status: string };

const MARK: Record<Mark, { icon: string; cls: string; label: string }> = {
  yes: { icon: '✓', cls: 'yes', label: 'есть' },
  partial: { icon: '◐', cls: 'partial', label: 'частично' },
  no: { icon: '✕', cls: 'no', label: 'нет' },
  soon: { icon: '…', cls: 'partial', label: 'скоро' },
  '?': { icon: '?', cls: 'unknown', label: 'не известно' },
};
const PHASES: Record<number, string> = {
  1: 'Этап 1 — эта неделя: сравняться по цене, бесплатному тарифу и подаче',
  2: 'Этап 2 — после первых оплат: облако и опыт пользователя',
  3: 'Этап 3 — потом: инструменты и мелочи',
  0: 'Не делаем',
};
const STATUS_CLS: Record<string, string> = { 'сделано': 'ok', 'в работе': 'ok', 'ждёт решения': 'off' };

export default async function CompetitorsPage() {
  await requireAdmin('admin');
  const evidence = await latestEvidence();
  const comps = data.competitors as unknown as Comp[];
  const byId = new Map(comps.map((c) => [c.id, c]));
  const items = data.strategy.items as unknown as Item[];
  const phases = [1, 2, 3, 0].filter((ph) => items.some((i) => i.phase === ph));
  const priced = comps.filter((c) => c.priceMonth !== null).sort((a, b) => (a.priceMonth ?? 0) - (b.priceMonth ?? 0));
  const maxPrice = Math.max(...priced.map((c) => c.priceMonth ?? 0));

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
      <h1 style={{ fontSize: '1.6rem' }}>Конкуренты и стратегия</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        {comps.length - 1} конкурентов в разборе · обновлено {new Date(data.updatedAt).toLocaleDateString('ru-RU')}
      </p>

      <div className="card comp-summary" style={{ marginTop: 20 }}>
        <b>Коротко</b>
        <p style={{ marginTop: 8, lineHeight: 1.6 }}>{data.strategy.summary}</p>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <b>Цена за месяц</b>
        <p className="muted" style={{ fontSize: '0.85rem', margin: '4px 0 12px' }}>Приведено к месяцу для сравнения; точные условия — в строке «Цена» таблицы.</p>
        <div className="comp-prices">
          {priced.map((c) => (
            <div key={c.id} className={`comp-price${c.self ? ' is-self' : ''}`}>
              <span className="comp-price__name">{c.name}</span>
              <span className="comp-price__bar"><i style={{ width: `${Math.max(2, ((c.priceMonth ?? 0) / maxPrice) * 100)}%` }} /></span>
              <span className="comp-price__val">{c.priceMonth === 0 ? 'бесплатно (бета)' : `${(c.priceMonth ?? 0).toLocaleString('ru-RU')} ₽`}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <b>Доказательства для «{PRICE_CLAIM}»</b>
        <p className="muted" style={{ fontSize: '0.85rem', margin: '4px 0 12px', lineHeight: 1.55 }}>
          На сайте: «{PRICE_CLAIM}*», сноска — «{PRICE_CLAIM_NOTE}». Если спросят (ФАС, модерация Директа) — показываем
          эти скриншоты: на каждом штамп с датой и адресом. Меняются цены — переснять:{' '}
          <code>node scripts/evidence/capture-competitor-prices.cjs</code>, сверить и обновить дату в lib/priceClaim.ts.
        </p>
        {!evidence ? <p className="muted">Снимков пока нет.</p> : (
          <>
            <p style={{ fontSize: '0.9rem' }}>Снято: <b>{evidence.capturedAtMsk}</b></p>
            <table className="admin-table" style={{ marginTop: 10 }}>
              <tbody>
                {evidence.items.map((it) => (
                  <tr key={it.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {it.ok
                        ? <a href={`/admin/evidence/${evidence.day}/${it.file}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{it.name}</a>
                        : <span>{it.name} <span className="admin-pill admin-pill--off">не снялось</span></span>}
                    </td>
                    <td className="muted" style={{ fontSize: '0.8rem' }}>
                      {(it.priceLines || []).filter((l) => /₽\s*(\/|за|в|·\s*(в|за|\/|одним))|нед|мес|дней|день/i.test(l)).slice(0, 3).join(' | ') || (it.ok ? 'цен на странице нет' : it.error)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <b>Кто что умеет</b>
        <p className="muted" style={{ fontSize: '0.85rem', margin: '4px 0 0' }}>
          ✓ есть · ◐ частично · ✕ нет · … скоро · ? не известно. Наведите на значок — будет подробность.
        </p>
        <div className="comp-matrix-wrap">
          <table className="comp-matrix">
            <thead>
              <tr><th />{comps.map((c) => <th key={c.id} className={c.self ? 'is-self' : ''}><a href={c.url} target="_blank" rel="noopener noreferrer">{c.name}</a><small>{c.type}</small></th>)}</tr>
            </thead>
            <tbody>
              {data.features.map((f) => (
                <tr key={f.key}>
                  <td className="comp-matrix__feat">{f.label}</td>
                  {comps.map((c) => {
                    const [m, note] = c.values[f.key] || ['?', ''];
                    const mk = MARK[m] || MARK['?'];
                    return (
                      <td key={c.id} className={`comp-cell comp-cell--${mk.cls}${c.self ? ' is-self' : ''}`} title={note ? `${mk.label}: ${note}` : mk.label}>
                        <span>{mk.icon}</span>{note && <small>{note}</small>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <b>Стратегия: что меняем, чтобы быть лучше</b>
        {phases.map((ph) => (
          <div key={ph} style={{ marginTop: 18 }}>
            <div className="comp-phase">{PHASES[ph]}</div>
            <ol className="comp-plan">
              {items.filter((i) => i.phase === ph).map((i) => (
                <li key={i.area}>
                  <div className="comp-plan__head">
                    <b>{i.area}</b>
                    <span className={`admin-pill ${STATUS_CLS[i.status] ? `admin-pill--${STATUS_CLS[i.status]}` : ''}`}>{i.status}</span>
                    {i.effort && i.effort !== '—' && <span className="muted" style={{ fontSize: '0.8rem' }}>{i.effort}</span>}
                  </div>
                  <div style={{ marginTop: 4 }}>{i.action}</div>
                  <div className="muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>Зачем: {i.why}</div>
                  {i.beats.length > 0 && (
                    <div className="muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>
                      Обходим: {i.beats.map((id) => byId.get(id)?.name || id).join(', ')}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, display: 'grid', gap: 16 }}>
        {comps.map((c) => (
          <details key={c.id} className={`card comp-card${c.self ? ' is-self' : ''}`} open={c.self}>
            <summary>
              <b>{c.name}</b> <span className="muted">· {c.type}</span>{' '}
              {!c.self && <a href={c.url} target="_blank" rel="noopener noreferrer" className="comp-link">сайт ↗</a>}
            </summary>
            <div className="comp-card__cols">
              <div><div className="comp-h comp-h--good">Сильные стороны</div><ul>{c.strengths.map((s) => <li key={s}>{s}</li>)}</ul></div>
              <div><div className="comp-h comp-h--bad">Слабые стороны</div><ul>{c.weaknesses.map((s) => <li key={s}>{s}</li>)}</ul></div>
              {c.steal.length > 0 && <div><div className="comp-h">Что взять себе</div><ul>{c.steal.map((s) => <li key={s}>{s}</li>)}</ul></div>}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
