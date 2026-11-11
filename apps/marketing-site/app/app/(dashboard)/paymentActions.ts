'use server';

import { redirect } from 'next/navigation';
import { getCustomerSession } from '@/lib/customerAuthSession';
import { coreApiFetch, CoreApiError } from '@/lib/coreApi';

export async function createPaymentAction(formData: FormData) {
  const session = await getCustomerSession();
  if (!session) redirect('/app/login');

  const plan = String(formData.get('plan') || '');
  if (plan !== 'weekly' && plan !== 'monthly') return;

  let res: { paymentUrl: string };
  try {
    res = await coreApiFetch<{ paymentUrl: string }>('/api/payment/create', {
      method: 'POST',
      token: session.coreApiToken,
      body: { plan },
    });
  } catch (e) {
    const reason = e instanceof CoreApiError ? 'unavailable' : 'error';
    redirect(`/app?paymentError=${reason}`);
  }

  redirect(res.paymentUrl);
}
