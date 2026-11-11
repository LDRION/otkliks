import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Logo } from '@/app/components/Logo';
import { getCustomerSession } from '@/lib/customerAuthSession';
import { OAuthButtons } from '@/app/components/OAuthButtons';
import { PromoOffer } from '@/app/components/PromoOffer';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = {
  title: 'Вход в личный кабинет',
  robots: { index: false, follow: false },
};

export default async function CustomerLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ oauthError?: string; next?: string; promo?: string }>;
}) {
  // Та же логика, что и в register/page.tsx: уже вошедшему сюда попадать не
  // должно (можно оказаться по старой закладке или ссылке из письма).
  const session = await getCustomerSession();
  if (session) redirect('/app');

  const { oauthError, next, promo } = await searchParams;

  return (
    <main className="admin-login">
      <div className="admin-login-card card">
        <div style={{ marginBottom: 24 }}>
          <Logo size={32} />
        </div>
        <h1 style={{ fontSize: '1.3rem', marginBottom: 22 }}>Вход в личный кабинет</h1>
        {/* Ошибку возвращает core-api в адресной строке, когда провайдер отказал
            или ссылка устарела. Без этого человек вернулся бы на форму входа без
            единого слова о том, что произошло. */}
        <PromoOffer unavailable={promo === 'unavailable'} />
        {oauthError && <p className="admin-login-error" style={{ marginBottom: 16 }}>{oauthError}</p>}
        <LoginForm />
        <OAuthButtons next={next && next.startsWith('/') ? next : '/app'} />
      </div>
    </main>
  );
}
