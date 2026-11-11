import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/app/components/Logo';
import { ResetForm } from './ResetForm';

export const metadata: Metadata = {
  title: 'Новый пароль',
  robots: { index: false, follow: false },
};

// Сессию здесь НЕ проверяем и вошедшего не выгоняем: по ссылке из письма может
// прийти человек, у которого в этом браузере открыт чужой (например, старый общий)
// аккаунт — смена пароля всё равно относится к владельцу письма, а не к текущей
// сессии. Токен из ссылки решает всё сам.
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token || '';

  return (
    <main className="admin-login">
      <div className="admin-login-card card">
        <div style={{ marginBottom: 24 }}>
          <Logo size={32} />
        </div>
        <h1 style={{ fontSize: '1.3rem', marginBottom: 14 }}>Новый пароль</h1>
        {token ? (
          <ResetForm token={token} />
        ) : (
          <div>
            <p style={{ fontSize: '0.95rem', lineHeight: 1.6 }}>
              В адресе нет кода восстановления. Скорее всего, ссылку из письма скопировали
              не целиком — откройте её нажатием прямо из письма.
            </p>
            <Link href="/app/forgot" className="btn btn--primary" style={{ width: '100%', marginTop: 20 }}>
              Запросить ссылку заново
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
