import type { Metadata } from 'next';
import Link from 'next/link';
import { adminFetch, requireAdmin } from '@/lib/adminApi';
import { SITE_URL } from '@/lib/site';

export const metadata: Metadata = { title: 'Рост', robots: { index: false, follow: false } };

type SvcCounts = { applied: number; invites: number; invitedUsers: number; forms: number; hoursSaved: number };
type Overview = {
  service?: { year: SvcCounts; total: SvcCounts; yearLabel: number; minutesPerApply: number };
  cloudWaitlist?: { total: number; new7: number; reveals?: number };
  users: number; new7: number; new30: number; paying: number; trials: number;
  revenueTotal: number; revenue30: number;
  sources: { source: string; registrations: number; registrations30: number; paid: number; revenue: number }[];
  promo: { total: number; redeemed: number };
  affiliates: number; pendingPayouts: number;
};

const rub = (n = 0) => `${Math.round(n).toLocaleString('ru-RU')} ₽`;

// Короткие ссылки для профилей в соцсетях (редиректы в next.config.js ставят
// utm-метки): по ним отчёт ниже и различает Telegram, VK и YouTube.
const SOCIAL_LINKS = [
  ['Telegram', 'tg'],
  ['VK', 'vk'],
  ['YouTube', 'yt'],
].map(([name, path]) => [name, `${SITE_URL}/${path}`]);

export default async function GrowthPage() {
  const session = await requireAdmin('admin');
  const o = await adminFetch<Overview>(session, '/overview');

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 60 }}>
      <h1 style={{ fontSize: '1.6rem' }}>Рост</h1>
      <p className="muted" style={{ marginTop: 8 }}>Пользователи, выручка и откуда люди приходят. Тестовые аккаунты не учитываются.</p>

      <div className="partner-stats">
        <div className="card"><span className="muted">Пользователей</span><b>{o.users}</b><span className="muted">+{o.new7} за 7 дней, +{o.new30} за 30</span></div>
        <div className="card"><span className="muted">Платят сейчас</span><b>{o.paying}</b><span className="muted">и {o.trials} на пробном</span></div>
        <div className="card"><span className="muted">Выручка за 30 дней</span><b>{rub(o.revenue30)}</b><span className="muted">всего {rub(o.revenueTotal)}</span></div>
        <Link href="/admin/waitlist" className="card" style={{ color: 'inherit', textDecoration: 'none' }}><span className="muted">Ждут облачный тариф</span><b>{o.cloudWaitlist?.total ?? 0}</b><span className="muted">описание открыли {o.cloudWaitlist?.reveals ?? 0} · подробнее →</span></Link>
        <div className="card"><span className="muted">Промо / партнёры</span><b>{o.promo.redeemed} / {o.affiliates}</b><span className="muted">{o.pendingPayouts ? `выплат ждут: ${o.pendingPayouts}` : 'выплат не ждут'}</span></div>
      </div>

      {o.service && (
        <div className="card" style={{ marginTop: 24 }}>
          <b>Статистика сервиса — как была на главной, но настоящая</b>
          <p className="muted" style={{ fontSize: '0.85rem', margin: '6px 0 0' }}>
            С лендинга блок убран, пока цифры не станут убедительными. Тестовые аккаунты не считаются.
          </p>
          <table className="admin-table" style={{ marginTop: 12 }}>
            <thead><tr><th>Показатель</th><th className="num">В {o.service.yearLabel} году</th><th className="num">За всё время</th></tr></thead>
            <tbody>
              <tr><td>Откликов отправлено</td><td className="num">{o.service.year.applied.toLocaleString('ru-RU')}</td><td className="num">{o.service.total.applied.toLocaleString('ru-RU')}</td></tr>
              <tr><td>Сэкономлено часов соискателей <span className="muted">(оценка: ~{o.service.minutesPerApply} мин на отклик вручную)</span></td><td className="num">{o.service.year.hoursSaved.toLocaleString('ru-RU')}</td><td className="num">{o.service.total.hoursSaved.toLocaleString('ru-RU')}</td></tr>
              <tr><td>Приглашений на собеседование <span className="muted">(чатов)</span></td><td className="num">{o.service.year.invites}</td><td className="num">{o.service.total.invites}</td></tr>
              <tr><td>Пользователей, получивших приглашение</td><td className="num">{o.service.year.invitedUsers}</td><td className="num">{o.service.total.invitedUsers}</td></tr>
              <tr><td>Анкет работодателей заполнено</td><td className="num">{o.service.year.forms}</td><td className="num">{o.service.total.forms}</td></tr>
              <tr><td>Получили оффер</td><td className="num muted" colSpan={2}>не отслеживается — hh не сообщает об оффере; узнать можно только у самих людей</td></tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ marginTop: 24 }}>
        <b>Источники</b>
        <table className="admin-table" style={{ marginTop: 12 }}>
          <thead><tr><th>Откуда</th><th>Регистраций</th><th>За 30 дней</th><th>Оплатили</th><th>Выручка</th></tr></thead>
          <tbody>
            {o.sources.map((s) => (
              <tr key={s.source}>
                <td>{s.source}</td><td>{s.registrations}</td><td>{s.registrations30}</td>
                <td>{s.paid}{s.registrations ? <span className="muted"> ({Math.round((s.paid / s.registrations) * 100)}%)</span> : null}</td>
                <td>{rub(s.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: 10 }}>
          Приоритет: партнёрская ссылка → промо-ссылка → utm-метка → сайт, с которого пришли → прямой заход.
          Источник фиксируется у тех, кто зарегистрировался после его подключения.
        </p>
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <b>Ссылки для профилей в соцсетях</b>
        <p className="muted" style={{ marginTop: 6 }}>Поставьте их в описание канала и группы — тогда регистрации из соцсетей будут видны отдельными строками выше.</p>
        <table className="admin-table" style={{ marginTop: 12 }}>
          <tbody>
            {SOCIAL_LINKS.map(([name, url]) => (
              <tr key={name}><td style={{ width: 110 }}>{name}</td><td><code style={{ userSelect: 'all', wordBreak: 'break-all' }}>{url}</code></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
