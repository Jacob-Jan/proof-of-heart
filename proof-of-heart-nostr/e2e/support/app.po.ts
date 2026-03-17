import { expect, type Locator, type Page } from '@playwright/test';

export class HomePage {
  readonly page: Page;
  readonly hero: Locator;
  readonly search: Locator;
  readonly charities: Locator;
  readonly emptyState: Locator;

  constructor(page: Page) {
    this.page = page;
    this.hero = page.getByRole('heading', { name: /donate bitcoin to charities on nostr/i });
    this.search = page.getByPlaceholder('Search charities...');
    this.charities = page.locator('.charity');
    this.emptyState = page.getByText('No charities found');
  }

  async open() {
    await this.page.goto('/');
    await expect(this.hero).toBeVisible();
  }

  async waitForCharitiesToRender() {
    await expect.poll(async () => {
      const cards = await this.charities.count();
      const hasEmpty = await this.emptyState.isVisible().catch(() => false);
      return cards > 0 || hasEmpty;
    }, { timeout: 25_000 }).toBe(true);
  }
}
