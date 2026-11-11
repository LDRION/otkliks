import type { Metadata } from 'next';
import Link from 'next/link';
import { adminFetch, requireAdmin } from '@/lib/adminApi';
import { listAdmins } from '@/lib/admins';
import s from './clients.module.css';
import { STAGES, VIA_SHORT, ago, fmtDate, isReal, isTeam, landingText, lookalikes, stageLabel, type UserRow } from './shared';

export const metadata: Metadata = { title: 'Пользователи', robots: { index: false, follow: false } };

// Кто зарегистрировался, как и откуда, и дошёл ли до дела. «Реальные» — без тестовых
// адресов и без аккаунтов, помеченных в карточке как «наш».
type Show = 'real' | 'other' | 'all';

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const session = await requireAdmin('admin');
  const { show: rawShow } = await searchParams;
  const show: Show = rawShow === 'other' || rawShow === 'all' ? rawShow : 'real';
  const { users } = await adminFetch<{ users: UserRow[] }>(session, '/users');

  const adminEmails = new Set(listAdmins().map((a) => a.email.toLowerCase()));
  const real = users.filter((u) => isReal(u, adminEmails));
  const other = users.filter((u) => !isReal(u, adminEmails));
  const maybeOurs = lookalikes(users, adminEmails);
  const list = show === 'real' ? real : show === 'other' ? other : users;

  // Воронка по реальным: каждый шаг — по своему признаку (лаунчер можно подключить и без
  // резюме, отклики идут только из лаунчера).
  const STEP_TEST: Record<string, (u: UserRow) => boolean> = {
    resume: (u) => u.resumes > 0,
    launcher: (u) => u.devices > 0 || u.applied > 0,
    applying: (u) => u.applied > 0,
    invited: (u) => u.invites > 0,
    paid: (u) => u.paid > 0,
  };
  const reached = (i: number) => real.filter(STEP_TEST[STAGES[i].key]).length;
  const pct = (n: number) => (real.length ? `${Math.round((n / real.length) * 100)}%` : '—');
  const active7 = real.filter((u) => u.lastActivityAt && Date.now() - new Date(u.lastActivityAt).getTime() < 7 * 864e5).length;
  const new7 = real.filter((u) => Date.now() - new Date(u.createdAt).getTime() < 7 * 864e5).length;

  const bySource = Object.entries(real.reduce<Record<string, number>>((acc, u) => { acc[u.source] = (acc[u.source] || 0) + 1; return acc; }, {}))
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
      <h1 style={{ fontSize: '1.6rem' }}>Пользователи</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        Кто зарегистрировался, как и откуда пришёл, и докуда дошёл. Реальные — без тестовых адресов, без
        аккаунтов с почтой администратора сайта и без тех, что вы пометили как свои в карточке.
        {maybeOurs.size > 0 && <> Похожих на ваши — {maybeOurs.size}: они с пометкой «похоже, ваш», откройте и отметьте.</>}
      </p>

      <div className={s.funnel}>
        <div className={s.step}><span>Реальных пользователей</span><b>{real.length}</b><span>+{new7} за 7 дней</span></div>
        {STAGES.slice(1).map((st, i) => (
          <div key={st.key} className={s.step}><span>{st.label}</span><b>{reached(i + 1)}</b><span>{pct(reached(i + 1))} от всех</span></div>
        ))}
        <div className={s.step}><span>Активны за 7 дней</span><b>{active7}</b><span>лаунчер или отклики</span></div>
      </div>

      {bySource.length > 0 && (
        <div className="card" style={{ marginTop: 18 }}>
          <b>Откуда пришли реальные</b>
          <div className={s.sources}>
            {bySource.map(([src, n]) => <span key={src} className={s.src}>{src}: <b>{n}</b></span>)}
          </div>
          <p className="muted" style={{ fontSize: '0.82rem', marginTop: 10 }}>
            Источник записывается на сайте при первом заходе: партнёрская или промо-ссылка, utm-метка, сайт,
            с которого пришли, и страница входа. «Прямые заходы» — без всего этого, а у аккаунтов до 10.10.2026
            страница входа не записывалась вовсе. При регистрации прямо в лаунчере источник не виден.
          </p>
        </div>
      )}

      <div className={s.tabs}>
        <Link href="/admin/clients" className={`${s.tab} ${show === 'real' ? s.tabOn : ''}`}>Реальные · {real.length}</Link>
        <Link href="/admin/clients?show=other" className={`${s.tab} ${show === 'other' ? s.tabOn : ''}`}>Свои и тестовые · {other.length}</Link>
        <Link href="/admin/clients?show=all" className={`${s.tab} ${show === 'all' ? s.tabOn : ''}`}>Все · {users.length}</Link>
      </div>

      <div className={`card ${s.scroll}`} style={{ marginTop: 14 }}>
        <table className="admin-table">
          <thead>
            <tr><th>Пользователь</th><th>Регистрация</th><th>Как</th><th>Откуда</th><th>Этап</th><th className="num">Отклики</th><th>Активность</th></tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id}>
                <td>
                  <Link href={`/admin/clients/${u.id}`} className={s.rowLink}>{u.noEmail ? 'Без почты (VK)' : u.email}</Link>
                  {u.test && <span className={`${s.badge} ${s.badgeWarn}`}>тест</span>}
                  {isTeam(u, adminEmails) && <span className={s.badge}>админ</span>}
                  {u.internal && <span className={s.badge}>наш</span>}
                  {maybeOurs.has(u.id) && <Link href={`/admin/clients/${u.id}`} className={`${s.badge} ${s.badgeHint}`}>похоже, ваш</Link>}
                  <span className={s.sub}>{[u.fullName, u.note].filter(Boolean).join(' · ')}</span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(u.createdAt)}</td>
                <td className={s.nowrap}>{VIA_SHORT[u.signup.via] || u.signup.via}<span className={s.sub}>{u.signup.where || 'место не записано'}</span></td>
                <td>
                  {u.source}
                  {u.partner && <span className={s.sub}>партнёр {u.partner.code}</span>}
                  {u.promo && <span className={s.sub}>промокод {u.promo}</span>}
                  {landingText(u.acquisition) && <span className={s.sub}>{landingText(u.acquisition)}</span>}
                </td>
                <td><span className={`${s.stage} ${s[`stage_${u.stage}`] || ''}`}>{stageLabel(u.stage)}</span></td>
                <td className="num">{u.applied}{u.applied7 ? <span className={s.sub}>+{u.applied7} за 7 дн.</span> : null}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{ago(u.lastActivityAt)}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={7} className="muted">Пока никого.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
