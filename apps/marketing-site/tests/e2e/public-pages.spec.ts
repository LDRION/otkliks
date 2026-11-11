import { test, expect } from '@playwright/test';

const PAGES = ['/', '/pricing', '/blog', '/privacy', '/oferta', '/counselling'];

test.describe('public pages', () => {
  for (const path of PAGES) {
    test(`${path} loads with no console errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
      page.on('pageerror', (err) => errors.push(String(err)));

      const res = await page.goto(path, { waitUntil: 'networkidle' });
      expect(res?.status()).toBe(200);
      expect(errors).toEqual([]);
    });
  }
});
