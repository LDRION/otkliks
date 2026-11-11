import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCustomerSession } from '@/lib/customerAuthSession';
import { logoutCustomer } from './actions';
import { Logo } from '@/app/components/Logo';
import { DashboardNav } from '@/app/components/DashboardNav';
import { tenantDisplayName } from '@/lib/tenantDisplay';

export default async function CustomerDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getCustomerSession();
  if (!session) redirect('/app/login');

  // Вход через VK часто не даёт email вовсе — тогда в сессии лежит техническая
  // заглушка вида vk_123456789@oauth.otkliks.local, и показывать её в шапке
  // нельзя. tenantDisplayName достаёт настоящее имя (VK его как раз отдаёт) и
  // прячет заглушку, если и имени тоже нет.
  const displayName = tenantDisplayName(session);

  return (
    <div className="admin-shell">
      <header className="admin-topbar admin-topbar--site">
        <div className="admin-topbar-inner">
          {/* Тот же интерактивный логотип, что и в публичной шапке (SiteNav). Ведёт
              на лендинг (/), а не на /app — стандартное ожидание от клика по лого
              (это «домой», а не «обновить текущую страницу кабинета»); раньше клик
              внутри кабинета никуда не уводил, просто оставался на месте. */}
          <Link href="/" className="logo logo--link" aria-label="Откликс — на сайт">
            <Logo />
          </Link>
          <DashboardNav />
          <div className="admin-topbar-user">
            {/* Настройки — иконкой-шестерёнкой слева от почты, а не текстовым пунктом
                навигации: заходят сюда редко, а место в основном ряду навигации ценнее
                для того, чем реально пользуются каждый день. Виден только здесь, в
                кабинете — сам layout уже требует активную сессию (см. redirect выше). */}
            <Link href="/app/settings" className="icon-btn" aria-label="Настройки" title="Настройки">
              {/* Heroicons cog-6-tooth (outline) — стандартная, узнаваемая шестерёнка. */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            </Link>
            {/* Имени тоже нет (заглушка почты + пустое fullName) — тогда просто
                не показываем ничего вместо email: шестерёнка и «Выйти» рядом
                и так дают понять, что это меню аккаунта. */}
            {displayName && <span className="muted">{displayName}</span>}
            <form action={logoutCustomer}>
              {/* Тихая кнопка, а не обведённая пилюля: выход — редкое действие, а
                  выглядел он весомее логотипа и навигации вместе взятых. */}
              <button type="submit" className="btn-quiet">
                Выйти
              </button>
            </form>
          </div>
        </div>
      </header>
      {/* ym-hide-content: Вебвизор Метрики видит только каркас кабинета, без текста —
          здесь переписка с работодателями, резюме и вопросы, это личные данные. */}
      <main className="admin-main ym-hide-content">{children}</main>
    </div>
  );
}
