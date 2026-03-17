import { test, expect } from '@playwright/test';
import { HomePage } from '../support/app.po';

test.describe('Main user flows', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('poh_relay_mode', 'test');
    });
  });
  test('home load -> charities visible', async ({ page }) => {
    const home = new HomePage(page);
    await home.open();
    await home.waitForCharitiesToRender();
  });

  test('search/filter charities', async ({ page }) => {
    const home = new HomePage(page);
    await home.open();
    await home.waitForCharitiesToRender();

    const count = await home.charities.count();
    test.skip(count === 0, 'No local-relay charities available for search/filter assertion');

    const firstName = (await home.charities.first().locator('h2').textContent())?.trim() ?? '';
    expect(firstName.length).toBeGreaterThan(1);

    await home.search.fill(firstName.slice(0, Math.min(8, firstName.length)));
    await expect(home.charities.first().locator('h2')).toContainText(firstName, { timeout: 10_000 });
  });

  test('open charity detail', async ({ page }) => {
    const home = new HomePage(page);
    await home.open();
    await home.waitForCharitiesToRender();

    const count = await home.charities.count();
    test.skip(count === 0, 'No local-relay charities available for detail-route assertion');

    const firstCard = home.charities.first();
    await firstCard.click();

    await expect(page).toHaveURL(/\/charities\//);
    await expect(page.locator('.charity, .loadingcharity')).toBeVisible();
  });

  test('navigate static pages (mission + paper)', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: /our mission/i }).click();
    await expect(page).toHaveURL(/\/paper$/);
    await expect(page.locator('.whitepaper h1')).toContainText(/proof of heart/i);

    await page.goto('/proof-of-heart');
    await expect(page.locator('main h1, .container h1').first()).toContainText(/proof of heart|donate bitcoin/i);
  });

  test('charity onboarding entry flow (non-destructive)', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: /for charities/i }).click();
    await expect(page).toHaveURL(/\/charity\/onboard$/);
    await expect(page.getByRole('heading', { name: /join as a charity/i })).toBeVisible();

    await expect(page.getByRole('button', { name: /connect nostr/i })).toBeVisible();
  });
});
