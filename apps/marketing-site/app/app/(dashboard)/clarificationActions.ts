'use server';

import { revalidatePath } from 'next/cache';
import { getCustomerSession } from '@/lib/customerAuthSession';
import { coreApiFetch } from '@/lib/coreApi';

export async function answerClarificationAction(formData: FormData): Promise<void> {
  const session = await getCustomerSession();
  if (!session) return;

  const id = String(formData.get('id') || '');
  const answerText = String(formData.get('answerText') || '').trim();
  if (!id || !answerText) return;
  const aiImprove = formData.get('aiImprove') === 'on';

  await coreApiFetch(`/api/activity/clarifications/${id}/answer`, {
    method: 'POST',
    token: session.coreApiToken,
    body: { answerText, aiImprove },
  }).catch(() => {});

  // Доставка работодателю — на следующем круге чатов лаунчера (нужен живой браузер
  // с сессией hh.ru); здесь только фиксируем ответ и убираем вопрос из списка открытых.
  revalidatePath('/app');
}
