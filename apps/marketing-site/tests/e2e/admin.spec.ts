import { test, expect } from '@playwright/test';
import { createAdmin } from '../../lib/admins';
import { hashPassword } from '../../lib/password';

async function seedOwner() {
  const email = `owner-test-${Date.now()}@otkliks.ru`;
  const password = 'admintest123';
  await createAdmin({ email, passwordHash: await hashPassword(password), role: 'owner' });
  return { email, password };
}

test.describe('admin auth', () => {
  test('owner can log in and manage admins; anonymous is redirected', async ({ page }) => {
    const { email, password } = await seedOwner();

    await page.goto('/admin/login', { waitUntil: 'networkidle' });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/admin', { timeout: 10_000 });

    await page.goto('/admin/users', { waitUntil: 'networkidle' });
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator(`text=${email}`).first()).toBeVisible();
  });

  test('anonymous visitor is redirected to admin login', async ({ page }) => {
    await page.goto('/admin', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin/);
  });
});
