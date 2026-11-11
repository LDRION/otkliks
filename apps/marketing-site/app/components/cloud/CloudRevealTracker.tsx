'use client';

import { useEffect } from 'react';
import { trackCloudReveal } from './actions';
import { reachGoal } from '@/app/components/Analytics';

// Карточка облачного тарифа на главной размыта до клика (CSS-переключатель
// #cloud-reveal). Сам клик — сигнал «мне интересно»: считаем его в админке («Облако»)
// и целью cloud_reveal в Метрике/GA4. Один браузер засчитывается один раз.
const KEY = 'otkliks_cloud_reveal';

function visitorId(): string {
  try {
    let id = localStorage.getItem(`${KEY}_id`);
    if (!id) {
      id = (crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));
      localStorage.setItem(`${KEY}_id`, id);
    }
    return id;
  } catch {
    return '';
  }
}

export function CloudRevealTracker() {
  useEffect(() => {
    const box = document.getElementById('cloud-reveal') as HTMLInputElement | null;
    if (!box) return undefined;
    const onChange = () => {
      if (!box.checked) return;
      try { if (localStorage.getItem(`${KEY}_sent`)) return; } catch { /* приватный режим — просто шлём */ }
      const id = visitorId();
      if (!id) return;
      reachGoal('cloud_reveal', 'cloud_reveal');
      trackCloudReveal(id).catch(() => {});
      try { localStorage.setItem(`${KEY}_sent`, '1'); } catch { /* ignore */ }
    };
    box.addEventListener('change', onChange);
    return () => box.removeEventListener('change', onChange);
  }, []);
  return null;
}
