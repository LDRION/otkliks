import { test, expect } from '@playwright/test';
import { registerCustomer } from './helpers';

test.describe('counselling request form', () => {
  test('anonymous visitor sees an empty form', async ({ page }) => {
    await page.goto('/counselling', { waitUntil: 'networkidle' });
    await expect(page.locator('input[name="name"]')).toHaveValue('');
    await expect(page.locator('input[name="contact"]')).toHaveValue('');
  });

  test('logged-in customer gets name and email prefilled', async ({ page }) => {
    const email = await registerCustomer(page, { fullName: 'Мария Тестова' });

    await page.goto('/counselling', { waitUntil: 'networkidle' });
    await expect(page.locator('input[name="name"]')).toHaveValue('Мария Тестова');
    await expect(page.locator('input[name="contact"]')).toHaveValue(email);
  });
});
