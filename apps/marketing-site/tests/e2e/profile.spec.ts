import { test, expect } from '@playwright/test';
import { registerCustomer } from './helpers';

const URL_PLACEHOLDER = 'https://hh.ru/applicant/resumes/...';
const LABEL_PLACEHOLDER = 'Fullstack';

test.describe('profile with multiple resumes', () => {
  test('add, save, reload, then remove a resume — both persist', async ({ page }) => {
    await registerCustomer(page);
    await page.goto('/app/profile', { waitUntil: 'networkidle' });

    await page.fill(`input[placeholder="${URL_PLACEHOLDER}"]`, 'https://hh.ru/applicant/resumes/aaa');
    await page.fill(`input[placeholder="${LABEL_PLACEHOLDER}"]`, 'Fullstack');

    await page.click('button:has-text("Добавить ещё резюме")');
    await page.locator(`input[placeholder="${URL_PLACEHOLDER}"]`).nth(1).fill('https://hh.ru/applicant/resumes/bbb');
    await page.locator(`input[placeholder="${LABEL_PLACEHOLDER}"]`).nth(1).fill('AI/LLM');

    await page.locator('form:has(input[name="fullName"]) button[type="submit"]').click();
    await expect(page.locator('text=Сохранено')).toBeVisible();

    await page.goto('/app/profile', { waitUntil: 'networkidle' });
    const urls = await page.locator(`input[placeholder="${URL_PLACEHOLDER}"]`).evaluateAll((els) => (els as HTMLInputElement[]).map((e) => e.value));
    expect(urls).toEqual(['https://hh.ru/applicant/resumes/aaa', 'https://hh.ru/applicant/resumes/bbb']);

    await page.click('button:has-text("Удалить резюме")');
    await page.locator('form:has(input[name="fullName"]) button[type="submit"]').click();
    await page.waitForTimeout(500);

    await page.goto('/app/profile', { waitUntil: 'networkidle' });
    const urlsAfterDelete = await page.locator(`input[placeholder="${URL_PLACEHOLDER}"]`).evaluateAll((els) => (els as HTMLInputElement[]).map((e) => e.value));
    expect(urlsAfterDelete).toEqual(['https://hh.ru/applicant/resumes/bbb']);
  });

  test('resume connected removes the dashboard "resume missing" card', async ({ page }) => {
    await registerCustomer(page);
    await page.goto('/app', { waitUntil: 'networkidle' });
    await expect(page.locator('text=Резюме ещё не подключено')).toBeVisible();

    await page.goto('/app/profile', { waitUntil: 'networkidle' });
    await page.fill(`input[placeholder="${URL_PLACEHOLDER}"]`, 'https://hh.ru/applicant/resumes/ccc');
    await page.locator('form:has(input[name="fullName"]) button[type="submit"]').click();
    await expect(page.locator('text=Сохранено')).toBeVisible();

    await page.goto('/app', { waitUntil: 'networkidle' });
    await expect(page.locator('text=Резюме ещё не подключено')).toHaveCount(0);
  });
});
