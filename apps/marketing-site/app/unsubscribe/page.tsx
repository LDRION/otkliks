import type { Metadata } from 'next';
import { UnsubscribeForm } from './UnsubscribeForm';

export const metadata: Metadata = { title: 'Отписка от подсказок', robots: { index: false, follow: false } };

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ u?: string; t?: string }> }) {
  const { u = '', t = '' } = await searchParams;
  return (
    <main>
      <section className="section">
        <div className="container" style={{ maxWidth: 560, textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.6rem' }}>Отписаться от подсказок?</h1>
          <p className="muted" style={{ margin: '12px 0 24px' }}>
            Это письма о том, что осталось до запуска автопилота. Служебные письма —
            чеки, восстановление пароля, окончание оплаченного периода — продолжат приходить.
          </p>
          {u && t ? <UnsubscribeForm u={u} t={t} /> : <p className="admin-login-error">Ссылка неполная. Напишите на support@otkliks.ru — отпишем вручную.</p>}
        </div>
      </section>
    </main>
  );
}
