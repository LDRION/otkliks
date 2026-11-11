import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCustomerSession } from '@/lib/customerAuthSession';
import { coreApiFetch } from '@/lib/coreApi';
import { SecurityForm } from './SecurityForm';

export const metadata: Metadata = {
  title: 'Настройки',
  robots: { index: false, follow: false },
};

type Tenant = {
  email: string;
  subscription: { status: string; plan: string; priceRub: number; currentPeriodEnd?: string };
  isSubscriptionActive: boolean;
  dailyCap: number;
  dailyUsed: number;
};

const PLAN_LABEL: Record<string, string> = { weekly: 'неделя', monthly: 'месяц' };

export default async function CustomerSettingsPage() {
  const session = await getCustomerSession();
  if (!session) redirect('/app/login');

  const { tenant } = await coreApiFetch<{ tenant: Tenant }>('/api/auth/me', { token: session.coreApiToken });
  const sub = tenant.subscription;

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 60, maxWidth: 640 }}>
      <h1 style={{ fontSize: '1.6rem' }}>Настройки</h1>

      <div className="card" style={{ marginTop: 24 }}>
        <div style={{ fontWeight: 700 }}>Подписка</div>
        <p className="muted" style={{ marginTop: 8 }}>
          {tenant.isSubscriptionActive
            ? sub.status === 'trialing'
              ? `Пробный период${sub.currentPeriodEnd ? ` до ${new Date(sub.currentPeriodEnd).toLocaleDateString('ru-RU')}` : ''}.`
              : `Активна: тариф «${PLAN_LABEL[sub.plan] || sub.plan}», ${sub.priceRub} ₽${sub.currentPeriodEnd ? ` · до ${new Date(sub.currentPeriodEnd).toLocaleDateString('ru-RU')}` : ''}.`
            : `Бесплатный тариф: ${tenant.dailyUsed}/${tenant.dailyCap} откликов сегодня, всё включено.`}
        </p>
        <a href="/app" className="muted" style={{ fontSize: '0.85rem' }}>Управление и оплата — на дашборде</a>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div style={{ fontWeight: 700 }}>Уведомления</div>
        <p className="muted" style={{ marginTop: 8, lineHeight: 1.5 }}>
          Приглашения на созвон и вопросы, требующие вашего ответа, всегда видны на этом дашборде
          и в лаунчере — их нельзя отключить, это суть работы автопилота. Что дополнительно
          показывать в ленте «Что происходит» (предупреждения, заполненные анкеты) — настраивается
          в самом лаунчере, вкладка «Настройки»: это его собственная лента на вашем компьютере.
        </p>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div style={{ fontWeight: 700 }}>Безопасность</div>
        <p className="muted" style={{ marginTop: 8, marginBottom: 14 }}>
          Смена пароля от аккаунта Откликс (не от hh.ru — тот отдельно, в лаунчере).
        </p>
        <SecurityForm />
      </div>
    </div>
  );
}
