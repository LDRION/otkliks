import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/adminApi';
import { listPosts } from '@/lib/blog';
import core from '@/lib/seo/semantic-core.json';
import wordstat from '@/lib/seo/wordstat.json';

export const metadata: Metadata = { title: 'SEO — запросы и страницы', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// Семантическое ядро: что люди ищут → группы → какая страница сайта отвечает.
// Данные — lib/seo/semantic-core.json (собирается scripts/seo/). Статус «нужна»
// превращается в «есть» САМ, как только в блоге опубликована статья с целевым
// адресом — править JSON после публикации не нужно.

type Group = {
  id: string; title: string; intent: string; priority: number; page: string;
  status: 'есть' | 'нужна' | 'доработать' | 'позже'; note: string; queries: string[];
  volume?: number; volumeNote?: string;
};
type WsQuery = { query: string; total: number; file: string; note?: string; tails: [string, number][] };

const perMonth = (n?: number) => (n ? `≈ ${n.toLocaleString('ru-RU')} в мес` : '');

const STATUS_PILL: Record<string, string> = { 'есть': 'ok', 'доработать': '', 'нужна': 'off', 'позже': '' };
const PRIO = ['', 'высокий', 'средний', 'низкий'];

export default async function SeoPage() {
  await requireAdmin('admin');
  const published = new Set(listPosts({ publishedOnly: true }).map((p) => `/blog/${p.slug}`));
  const groups = (core.groups as Group[]).map((g) => ({
    ...g,
    status: g.status === 'нужна' && published.has(g.page) ? 'есть' as const : g.status,
  }));

  const inGroups = groups.reduce((s, g) => s + g.queries.length, 0);
  const covered = groups.filter((g) => g.status === 'есть');
  const coveredQ = covered.reduce((s, g) => s + g.queries.length, 0);
  const todo = groups
    .filter((g) => g.status === 'нужна' || g.status === 'доработать')
    .sort((a, b) => a.priority - b.priority || (b.volume ?? 0) - (a.volume ?? 0) || b.queries.length - a.queries.length);
  const wsQueries = (wordstat.queries as WsQuery[]).slice().sort((a, b) => b.total - a.total);
  const measured = groups.filter((g) => g.volume);
  const date = new Date(core.collectedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
      <h1 style={{ fontSize: '1.6rem' }}>SEO — что ищут люди и чем мы отвечаем</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        {core.source}. Собрано {date}: {core.seedCount} тем → {core.rawCount} формулировок, из них {inGroups} по делу
        (остальное — шум вроде заговоров и «ребёнок откликается на имя»).
      </p>

      <div className="partner-stats">
        <div className="card"><span className="muted">Групп запросов</span><b>{groups.length}</b><span className="muted">{inGroups} запросов в них</span></div>
        <div className="card"><span className="muted">Закрыто страницами</span><b>{covered.length} / {groups.length}</b><span className="muted">{Math.round((coveredQ / Math.max(1, inGroups)) * 100)}% запросов</span></div>
        <div className="card"><span className="muted">Нужно написать</span><b>{groups.filter((g) => g.status === 'нужна').length}</b><span className="muted">и доработать: {groups.filter((g) => g.status === 'доработать').length}</span></div>
        <div className="card"><span className="muted">Частоты (Вордстат)</span><b>{measured.length} / {groups.length}</b><span className="muted">групп с частотой · {wordstat.period.split(' (')[0]}</span></div>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <b>Что писать дальше — по порядку</b>
        <p className="muted" style={{ fontSize: '0.85rem', margin: '6px 0 0' }}>
          Сначала высокий приоритет, внутри — где больше спрос в месяц (Вордстат). Статья с этим адресом в блоге сама закроет пункт.
        </p>
        <ol className="seo-todo">
          {todo.map((g) => (
            <li key={g.id}>
              <div><b>{g.title}</b> <span className={`admin-pill ${g.priority === 1 ? 'admin-pill--off' : ''}`}>{PRIO[g.priority]}</span> <span className="muted">· {g.volume ? perMonth(g.volume) : `${g.queries.length} запросов`}</span></div>
              <div className="muted" style={{ fontSize: '0.85rem', marginTop: 4 }}>{g.note}</div>
              <code className="seo-url">{g.page}</code>
            </li>
          ))}
        </ol>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <b>Все группы</b>
        <table className="admin-table" style={{ marginTop: 12 }}>
          <thead><tr><th>Группа</th><th>Приоритет</th><th className="num">Спрос в мес</th><th className="num">Запросов</th><th>Страница</th><th>Статус</th></tr></thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id}>
                <td>
                  <details className="seo-details">
                    <summary><b>{g.title}</b> <span className="muted" style={{ fontSize: '0.8rem' }}>· {g.intent}</span></summary>
                    <ul>{g.queries.map((q) => <li key={q}>{q}</li>)}</ul>
                  </details>
                </td>
                <td>{PRIO[g.priority]}</td>
                <td className="num" title={g.volumeNote}>{g.volume ? g.volume.toLocaleString('ru-RU') : <span className="muted">—</span>}</td>
                <td className="num">{g.queries.length}</td>
                <td>{g.page ? (g.status === 'есть' ? <a href={g.page} target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>{g.page}</a> : <code className="seo-url">{g.page}</code>) : <span className="muted">—</span>}</td>
                <td><span className={`admin-pill ${STATUS_PILL[g.status] ? `admin-pill--${STATUS_PILL[g.status]}` : ''}`}>{g.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <b>Вордстат: сколько ищут в месяц</b>
        <p className="muted" style={{ fontSize: '0.85rem', margin: '6px 0 12px' }}>
          {wordstat.source}. Период: {wordstat.period}. Скриншоты — {wordstat.screenshots} в репозитории.
        </p>
        <table className="admin-table">
          <tbody>
            {wsQueries.map((q) => (
              <tr key={q.query}>
                <td>
                  <details className="seo-details">
                    <summary><b>{q.query}</b>{q.note ? <span className="muted" style={{ fontSize: '0.8rem' }}> · {q.note}</span> : null}</summary>
                    {q.tails.length ? <ul>{q.tails.map(([t, n]) => <li key={t}>{t} — {n.toLocaleString('ru-RU')}</li>)}</ul> : <p className="muted" style={{ fontSize: '0.85rem' }}>Хвостов нет.</p>}
                  </details>
                </td>
                <td className="num"><b>{q.total.toLocaleString('ru-RU')}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <b>Реальные запросы из поиска</b>
        <p className="muted" style={{ fontSize: '0.88rem', marginTop: 6 }}>
          Выше — то, что люди печатают вообще. По каким словам находят именно нас, покажут Яндекс Вебмастер
          («Эффективность» → «Поисковые запросы») и Google Search Console («Эффективность») через 1–2 недели
          после индексации. Тогда добавим сюда и эти цифры.
        </p>
      </div>
    </div>
  );
}
