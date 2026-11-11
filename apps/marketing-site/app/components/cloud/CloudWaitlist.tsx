'use client';

import { useActionState, useEffect, useState } from 'react';
import { joinCloudWaitlist, cloudWaitlistIdentity } from './actions';
import { reachGoal } from '@/app/components/Analytics';

// «Сообщить о запуске» в карточке облачного тарифа. Это проверка спроса: считаем,
// сколько людей хотят облако, прежде чем его строить. Цифры — в админке.
export function CloudWaitlist({ source }: { source: 'landing' | 'pricing' | 'dashboard' }) {
  const [state, action, pending] = useActionState(joinCloudWaitlist, undefined);
  // Вошёл с настоящей почтой — поле не показываем. Страница статичная, поэтому
  // узнаём это после загрузки; до ответа показываем обычную форму.
  const [me, setMe] = useState<{ email: string | null; joined: boolean } | null>(null);
  useEffect(() => { cloudWaitlistIdentity().then(setMe).catch(() => setMe({ email: null, joined: false })); }, []);

  useEffect(() => {
    if (state?.ok && !state.already) reachGoal('cloud_waitlist', 'cloud_waitlist', { source });
  }, [state, source]);

  if (me?.joined && !state) {
    return <p className="cloud-waitlist__done">Вы уже в списке — напишем на {me.email}, как только запустим.</p>;
  }

  if (state?.ok) {
    return (
      <p className="cloud-waitlist__done">
        {state.already ? 'Вы уже в списке — напишем, как только запустим.' : 'Готово! Напишем на почту, как только облачный тариф запустится.'}
      </p>
    );
  }

  return (
    <form action={action} className="cloud-waitlist">
      <input type="hidden" name="source" value={source} />
      {/* Ловушка для ботов — людям не видна. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="cloud-waitlist__trap" />
      {!me?.email && (
        <input
          type="email" name="email" required maxLength={254} autoComplete="email"
          placeholder="Ваша почта" aria-label="Почта для уведомления о запуске"
        />
      )}
      <button type="submit" className="btn btn--primary" disabled={pending}>
        {pending ? 'Записываем…' : 'Сообщить о запуске'}
      </button>
      {state?.error && <p className="cloud-waitlist__error">{state.error}</p>}
      <p className="cloud-waitlist__note">
        {me?.email ? `Напишем на ${me.email} — одно письмо о запуске, без рассылок.` : 'Одно письмо о запуске — и всё, без рассылок.'}
      </p>
    </form>
  );
}
