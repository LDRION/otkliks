import { test, expect } from '@playwright/test';
import { registerCustomer, TEST_PASSWORD } from './helpers';

test.describe('customer account flow', () => {
  test('register (24h trial auto-granted), log out, log back in', async ({ page }) => {
    const email = await registerCustomer(page);

    await expect(page).toHaveURL(/\/app$/);
    // Trial is granted automatically at registration — the "subscription not active" card
    // (with payment buttons) must NOT show up right after signing up.
    await expect(page.locator('text=Подписка не активна')).toHaveCount(0);

    await page.locator('button:has-text("Выйти")').click();
    await page.waitForURL('**/app/login', { timeout: 10_000 });

    // Unauthenticated /app redirects to login with a return path
    await page.goto('/app');
    await expect(page).toHaveURL(/\/app\/login\?next=%2Fapp/);

    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/app', { timeout: 10_000 });
  });

  test('wrong password is rejected', async ({ page }) => {
    const email = await registerCustomer(page);
    await page.locator('button:has-text("Выйти")').click();
    await page.waitForURL('**/app/login');

    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', 'totally-wrong-password');
    await page.click('button[type="submit"]');

    await expect(page.locator('.admin-login-error')).toBeVisible();
    await expect(page).toHaveURL(/\/app\/login/);
  });
});
