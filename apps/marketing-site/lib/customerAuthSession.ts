import { cookies } from 'next/headers';
import { CUSTOMER_SESSION_COOKIE, verifyCustomerSession } from './customer-session';

export type CustomerSession = {
  tenantId: string;
  email: string;
  fullName?: string;
  coreApiToken: string;
};

// Node-runtime only (next/headers) — не импортировать из middleware.ts.
export async function getCustomerSession(): Promise<CustomerSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifyCustomerSession(token);
  if (!payload) return null;
  return { ...payload, coreApiToken: token };
}
