import type { Page } from '@playwright/test';
import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/otkliks';

export function uniqueEmail(tag: string) {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@otkliks.ru`;
}

export const TEST_PASSWORD = 'testpass123';

export async function registerCustomer(page: Page, opts: { email?: string; fullName?: string } = {}) {
  const email = opts.email || uniqueEmail('customer');
  await page.goto('/app/register', { waitUntil: 'networkidle' });
  await page.fill('input[name="fullName"]', opts.fullName || 'Тестовый Клиент');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/app', { timeout: 10_000 });
  return email;
}

// Every registration lands on the free tier by default already (see core-api
// routes/auth.js — no more auto-granted 24h trial), so this no longer "expires" a
// trial so much as force the tenant into the same subscription.status:'none' state a
// lapsed/never-paid tenant would have — used by tests that need to exercise the
// no-active-subscription / payment path directly, same as admin.spec.ts seeds an owner
// directly rather than through a UI flow that doesn't exist.
export async function expireTrial(email: string) {
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    await client.db().collection('tenants').updateOne(
      { email },
      { $set: { 'subscription.status': 'none' } }
    );
  } finally {
    await client.close();
  }
}
