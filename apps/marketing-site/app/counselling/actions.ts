'use server';

import { createCounsellingRequest } from '@/lib/counsellingRequests';

export type SubmitState = { success?: boolean; error?: string } | undefined;

export async function submitCounsellingRequest(
  _prevState: SubmitState,
  formData: FormData
): Promise<SubmitState> {
  const name = String(formData.get('name') || '').trim();
  const contact = String(formData.get('contact') || '').trim();
  const message = String(formData.get('message') || '').trim();

  if (!name || !contact || !message) {
    return { error: 'Заполните имя, контакт и сообщение' };
  }
  if (name.length > 200 || contact.length > 200 || message.length > 4000) {
    return { error: 'Слишком длинный текст — сократите, пожалуйста' };
  }

  createCounsellingRequest({ name, contact, message });
  return { success: true };
}
