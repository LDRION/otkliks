'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCustomerSession } from '@/lib/customerAuthSession';
import { coreApiFetch } from '@/lib/coreApi';

export async function unpairDeviceAction(formData: FormData) {
  const session = await getCustomerSession();
  if (!session) redirect('/app/login');

  const deviceId = String(formData.get('deviceId') || '');
  if (!deviceId) return;

  await coreApiFetch(`/api/devices/${encodeURIComponent(deviceId)}`, {
    method: 'DELETE',
    token: session.coreApiToken,
  });

  revalidatePath('/app/devices');
}
