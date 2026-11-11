import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Logo } from '@/app/components/Logo';
import { getCustomerSession } from '@/lib/customerAuthSession';
import { ForgotForm } from './ForgotForm';

export const metadata: Metadata = {
  title: 'Восстановление пароля',
  robots: { index: false, follow: false },
};

export default async function ForgotPasswordPage() {
  // Уже вошедшему восстанавливать нечего — пароль меняется в настройках кабинета.
  const session = await getCustomerSession();
  if (session) redirect('/app/settings');

  return (
    <main className="admin-login">
      <div className="admin-login-card card">
        <div style={{ marginBottom: 24 }}>
          <Logo size={32} />
        </div>
        <h1 style={{ fontSize: '1.3rem', marginBottom: 14 }}>Восстановление пароля</h1>
        <ForgotForm />
      </div>
    </main>
  );
}
