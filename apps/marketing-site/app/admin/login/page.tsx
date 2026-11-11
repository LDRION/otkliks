import type { Metadata } from 'next';
import { LoginForm } from './LoginForm';
import { Logo } from '@/app/components/Logo';

export const metadata: Metadata = {
  title: 'Вход в админку',
  robots: { index: false, follow: false },
};

export default function AdminLoginPage() {
  return (
    <main className="admin-login">
      <div className="admin-login-card card">
        <div style={{ ['--logo-font-size' as string]: '1.8rem', marginBottom: 28 }}>
          <Logo size={46} animated />
        </div>
        <h1 style={{ fontSize: '1.3rem', marginBottom: 22 }}>Вход для администраторов</h1>
        <LoginForm />
      </div>
    </main>
  );
}
