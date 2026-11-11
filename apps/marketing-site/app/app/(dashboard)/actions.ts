'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CUSTOMER_SESSION_COOKIE } from '@/lib/customer-session';

export async function logoutCustomer() {
  const cookieStore = await cookies();
  cookieStore.delete(CUSTOMER_SESSION_COOKIE);
  redirect('/app/login');
}
