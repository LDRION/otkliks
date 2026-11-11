import { test, expect } from '@playwright/test';
import { registerCustomer } from './helpers';

test.describe('free tier and resume-abuse prevention', () => {
  test('fresh registration lands on the free tier immediately, no trial/button needed', async ({ page }) => {
    await registerCustomer(page);
    await page.goto('/app', { waitUntil: 'networkidle' });
    // Раньше тут проверялось ОТСУТСТВИЕ "Подписка не активна" — свежий аккаунт получал
    // временный 24-часовой триал с полным доступом. Теперь триала нет: свежий аккаунт
    // сразу на бесплатном тарифе (10 откликов/день, без чата и анкет) — это НЕ ошибка
    // и не блокировка, поэтому карточка тарифа показывается сразу, с честным описанием
    // лимита, а не текстом про истёкшую/неактивную подписку.
    await expect(page.locator('text=Вы на бесплатном тарифе')).toBeVisible();
    await expect(page.locator('text=Подписка не активна')).toHaveCount(0);
  });

  test('reusing the same hh.ru resume on a second free account blocks that account\'s free tier', async ({ page, browser }) => {
    const resumeUrl = `https://hh.ru/applicant/resumes/abuse-test-${Date.now()}`;

    await registerCustomer(page);
    await page.goto('/app/profile', { waitUntil: 'networkidle' });
    await page.fill('input[placeholder="https://hh.ru/applicant/resumes/..."]', resumeUrl);
    await page.locator('form:has(input[name="fullName"]) button[type="submit"]').click();
    await expect(page.locator('text=Сохранено ✓')).toBeVisible();

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    try {
      await registerCustomer(page2);
      await page2.goto('/app/profile', { waitUntil: 'networkidle' });
      await page2.fill('input[placeholder="https://hh.ru/applicant/resumes/..."]', resumeUrl);
      await page2.locator('form:has(input[name="fullName"]) button[type="submit"]').click();

      await expect(page2.locator('text=это резюме уже подключено на другом аккаунте')).toBeVisible();

      await page2.goto('/app', { waitUntil: 'networkidle' });
      await expect(page2.locator('text=Бесплатный тариф недоступен')).toBeVisible();
    } finally {
      await context2.close();
    }
  });
});
