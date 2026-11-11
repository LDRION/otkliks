import { cookies } from 'next/headers';
import { coreApiFetch } from '@/lib/coreApi';
import { PROMO_COOKIE, normalizeCode } from '@/lib/attribution';

type Offer = { trialDays: number; trialDailyCap: number; discountPercent: number; discountValidDays: number };

const days = (n: number) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} день`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${n} дня`;
  return `${n} дней`;
};

// Баннер персонального предложения на входе/регистрации. Условия берутся из
// core-api по коду из cookie — выдумать их на стороне браузера нельзя.
export async function PromoOffer({ unavailable = false }: { unavailable?: boolean }) {
  if (unavailable) {
    return (
      <p className="promo-offer promo-offer--off">
        Это персональное предложение уже использовано или больше не действует. Регистрация
        при этом работает как обычно — 10 бесплатных откликов в день.
      </p>
    );
  }

  const code = normalizeCode((await cookies()).get(PROMO_COOKIE)?.value);
  if (!code) return null;
  let offer: Offer | null = null;
  try {
    offer = (await coreApiFetch<{ offer: Offer }>(`/api/promo/${code}`)).offer;
  } catch {
    return null;
  }
  if (!offer) return null;

  return (
    <div className="promo-offer">
      <div className="promo-offer__title">Для вас персональное предложение</div>
      <ul>
        {offer.trialDays > 0 && (
          <li>
            <b>{days(offer.trialDays)} полного автопилота бесплатно</b> — до {offer.trialDailyCap} откликов
            в день, переписка с работодателями и анкеты
          </li>
        )}
        {offer.discountPercent > 0 && (
          <li>
            <b>Скидка {offer.discountPercent}%</b> на первую оплату — применится сама
          </li>
        )}
      </ul>
    </div>
  );
}
