import { test, expect } from '@playwright/test';
import { registerCustomer } from './helpers';

const CORE_API_URL = process.env.CORE_API_URL || 'http://localhost:4000';

test.describe('device pairing', () => {
  test('a paired device shows up and can be unpaired from the dashboard', async ({ page, context }) => {
    await registerCustomer(page);

    // Pair a device the same way local-agent would: exchange the session token for a
    // device token via core-api directly (there's no UI for pairing — it happens from
    // the launcher's own login screen).
    const cookies = await context.cookies();
    const sessionToken = cookies.find((c) => c.name === 'otkliks_customer_session')?.value;
    expect(sessionToken).toBeTruthy();

    const res = await fetch(`${CORE_API_URL}/api/devices/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({ label: 'Домашний ноутбук' }),
    });
    expect(res.status).toBe(201);

    await page.goto('/app/devices', { waitUntil: 'networkidle' });
    await expect(page.locator('text=Домашний ноутбук')).toBeVisible();
    await expect(page.locator('text=Устройств ещё нет')).toHaveCount(0);

    await page.click('button:has-text("Отвязать")');
    await page.waitForTimeout(500);
    await page.goto('/app/devices', { waitUntil: 'networkidle' });
    await expect(page.locator('text=Домашний ноутбук')).toHaveCount(0);
    await expect(page.locator('text=Устройств ещё нет')).toBeVisible();
  });
});
