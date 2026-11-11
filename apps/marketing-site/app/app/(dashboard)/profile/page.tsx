import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCustomerSession } from '@/lib/customerAuthSession';
import { coreApiFetch } from '@/lib/coreApi';
import { ProfileForm } from './ProfileForm';
import { LAUNCHER_AVAILABLE } from '@/lib/autopilot';

export const metadata: Metadata = {
  title: 'Резюме и профиль',
  robots: { index: false, follow: false },
};

type Tenant = {
  fullName: string;
  profile: {
    strongStack: string[];
    honestGaps: string[];
    portfolioLink?: { domain: string; canonical: string };
    contactTelegram?: string;
    minSalary?: { amount: number; currency: string };
  };
  resumeProfiles: { key: string; label: string; similarVacanciesUrl: string }[];
};

export default async function CustomerProfilePage() {
  const session = await getCustomerSession();
  if (!session) redirect('/app/login');

  const { tenant } = await coreApiFetch<{ tenant: Tenant }>('/api/auth/me', { token: session.coreApiToken });

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 60, maxWidth: 640 }}>
      <h1 style={{ fontSize: '1.6rem' }}>Резюме и профиль</h1>
      <p className="muted" style={{ marginTop: 8, marginBottom: 28 }}>
        Отсюда автопилот берёт данные для подбора вакансий и написания сопроводительных писем.
      </p>

      <ProfileForm
        fullName={tenant.fullName || ''}
        strongStack={tenant.profile.strongStack}
        honestGaps={tenant.profile.honestGaps}
        portfolioCanonical={tenant.profile.portfolioLink?.canonical || ''}
        contactTelegram={tenant.profile.contactTelegram || ''}
        minSalaryAmount={tenant.profile.minSalary?.amount || 0}
        minSalaryCurrency={tenant.profile.minSalary?.currency || 'RUB'}
        resumeProfiles={tenant.resumeProfiles.map((r) => ({ key: r.key, label: r.label, url: r.similarVacanciesUrl }))}
      />

      <div className="card" style={{ marginTop: 28 }}>
        <b>Что дальше</b>
        <p className="muted" style={{ marginTop: 8 }}>
          Само по себе заполненное резюме откликов не отправляет: работу делает лаунчер —
          программа на вашем компьютере, которая заходит на hh.ru от вашего имени.{' '}
          {LAUNCHER_AVAILABLE
            ? 'Скачайте архив, распакуйте и запустите — профиль и подписку он подхватит сам.'
            : 'Сборки пока нет, мы её готовим — до тех пор автопилот не запустится.'}{' '}
          Текущее состояние всегда видно на <a href="/app">дашборде</a>.
        </p>
      </div>
    </div>
  );
}
