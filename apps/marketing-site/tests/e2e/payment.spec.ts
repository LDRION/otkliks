import { test, expect } from '@playwright/test';
import { registerCustomer, expireTrial } from './helpers';

test.describe('subscription payment', () => {
  test('paying redirects to YooMoney, or fails gracefully if unconfigured', async ({ page }) => {
    const email = await registerCustomer(page);
    await expireTrial(email);
    await page.goto('/app', { waitUntil: 'networkidle' });

    await page.locator('form:has(input[value="weekly"]) button[type="submit"]').click();
    await page.waitForTimeout(600);

    const url = page.url();
    if (url.includes('yoomoney.ru')) {
      // YooMoney's own server redirects /quickpay/confirm -> /transfer/quickpay?requestId=...
      // once it accepts the payment request, so either shape means the link was valid.
      expect(url).toMatch(/quickpay/);
    } else {
      // YOOMONEY_WALLET not set in core-api/.env — core-api returns 503, the dashboard
      // shows a friendly message instead of crashing.
      expect(url).toContain('paymentError=');
      await expect(page.locator('text=Оплата временно недоступна')).toBeVisible();
    }
  });

  test('pricing page shows both plans', async ({ page }) => {
    await page.goto('/pricing', { waitUntil: 'networkidle' });
    const body = await page.content();
    expect(body).toContain('399');
    expect(body).toContain('899');
  });
});
