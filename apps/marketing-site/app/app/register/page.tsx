import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Logo } from '@/app/components/Logo';
import { getCustomerSession } from '@/lib/customerAuthSession';
import { OAuthButtons } from '@/app/components/OAuthButtons';
import { PromoOffer } from '@/app/components/PromoOffer';
import { RegisterForm } from './RegisterForm';

export const metadata: Metadata = {
  title: 'Регистрация: 10 бесплатных откликов на hh.ru в день',
  description: 'Создайте аккаунт Откликс — 10 бесплатных откликов в день, без карты и без ограничения по времени.',
};

export default async function CustomerRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ oauthError?: string; promo?: string }>;
}) {
  // Ссылки «Начать бесплатно» на лэндинге и в тарифах ведут сюда безусловно, не
  // зная, залогинен ли уже человек (иначе пришлось бы протаскивать authed в
  // каждую из них). Проверяем на входе в саму страницу: у кого уже есть сессия,
  // тому education-форма не нужна — сразу в кабинет.
  const session = await getCustomerSession();
  if (session) redirect('/app');

  const { oauthError, promo } = await searchParams;

  return (
    <main className="admin-login">
      <div className="admin-login-card card">
        <div style={{ marginBottom: 24 }}>
          <Logo size={32} />
        </div>
        <h1 style={{ fontSize: '1.3rem', marginBottom: 6 }}>Создать аккаунт</h1>
        <p className="muted" style={{ marginBottom: 22, fontSize: '0.9rem' }}>
          10 бесплатных откликов в день — без карты, навсегда.
        </p>
        <PromoOffer unavailable={promo === 'unavailable'} />
        {oauthError && <p className="admin-login-error" style={{ marginBottom: 16 }}>{oauthError}</p>}
        <RegisterForm />
        <OAuthButtons />
      </div>
    </main>
  );
}
