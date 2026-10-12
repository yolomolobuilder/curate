import { test, expect } from '@playwright/test';

test.describe('Curate Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');

    // We must pass the correct storage key based on earlier checks ('curatecal_items_v1')
    await page.evaluate(() => {
      localStorage.setItem('curatecal_first_activation_completed_v1', 'true');
    });

    await page.reload();
  });

  test('Canvas drag smoke test (verify position changes)', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('curatecal_items_v1', JSON.stringify([{
        id: 'test-item-canvas',
        title: 'Canvas Item',
        thumbnailUrl: '',
        contentType: 'youtube',
        status: 'inbox',
        createdAt: new Date().toISOString()
      }]));
    });
    await page.reload();

    const canvasButton = page.locator('button', { hasText: 'Home' }).first();
    await expect(canvasButton).toBeVisible();
    await canvasButton.click();

    await expect(page.locator('h1').filter({ hasText: 'Everything worth exploring' })).toBeVisible();

    const canvas = page.locator('.cursor-grab').first();
    await expect(canvas).toBeVisible();

    const initialStyle = await canvas.getAttribute('style');

    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 - 100, box.y + box.height / 2 - 100, { steps: 5 });
      await page.mouse.up();
    }

    const finalStyle = await canvas.getAttribute('style');
    expect(finalStyle).not.toBe(initialStyle);
  });

  test('Calendar drag smoke test (verify item moves to day slot)', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('curatecal_items_v1', JSON.stringify([{
        id: 'test-item-1',
        title: 'Test Video',
        thumbnailUrl: '',
        contentType: 'youtube',
        status: 'inbox',
        createdAt: new Date().toISOString()
      }]));
    });
    await page.reload();

    const calendarTab = page.locator('button', { hasText: 'Calendar' });
    await expect(calendarTab).toBeVisible();
    await calendarTab.click();

    // Inbox might need to be opened manually if not open
    const inboxBtn = page.locator('button', { hasText: 'Inbox' }).first();
    if (await inboxBtn.isVisible()) {
        const isSelected = await inboxBtn.getAttribute('class');
        if (!isSelected?.includes('font-medium')) {
            await inboxBtn.click();
        }
    }

    const inboxItem = page.locator('text=Test Video').first();
    await expect(inboxItem).toBeVisible();

    // Use an explicit XPath query to find the droppable cell. In month view it's the 140px min height block.
    const daySlot = page.locator('div.min-h-\\[140px\\]').first();
    await expect(daySlot).toBeVisible();

    await inboxItem.dragTo(daySlot);

    const itemInGrid = daySlot.locator('text=Test Video').first();
    await expect(itemInGrid).toBeVisible();
  });

  test('Quick plan smoke test', async ({ page }) => {
    const calendarTab = page.locator('button', { hasText: 'Calendar' });
    await expect(calendarTab).toBeVisible();
    await calendarTab.click();

    const planButton = page.locator('button', { hasText: 'Plan 2h' }).first();
    if (await planButton.isVisible()) {
        await planButton.click();
        const modalHeading = page.locator('h2', { hasText: 'Quick Plan' });
        await expect(modalHeading).toBeVisible();
        const closeBtn = page.locator('button', { hasText: 'Cancel' });
        await closeBtn.click();
        await expect(modalHeading).not.toBeVisible();
    }
  });

  test('Position persistence smoke test', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
        localStorage.setItem('curatecal_first_activation_completed_v1', 'true');
        localStorage.setItem('curatecal_items_v1', JSON.stringify([{
            id: 'test-item-2',
            title: 'Test Position Persistence',
            thumbnailUrl: '',
            contentType: 'article',
            status: 'inbox',
            createdAt: new Date().toISOString()
        }]));
    });

    await page.reload();

    const canvasButton = page.locator('button', { hasText: 'Home' }).first();
    await expect(canvasButton).toBeVisible();
    await canvasButton.click();

    const testItem = page.locator('h4', { hasText: 'Test Position Persistence' }).first();
    await expect(testItem).toBeVisible();

    const cardContainer = testItem.locator('xpath=ancestor::div[contains(@class, "absolute")]').first();
    const initialStyle = await cardContainer.getAttribute('style');

    await page.reload();

    const testItemReloaded = page.locator('h4', { hasText: 'Test Position Persistence' }).first();
    await expect(testItemReloaded).toBeVisible();
    const cardContainerReloaded = testItemReloaded.locator('xpath=ancestor::div[contains(@class, "absolute")]').first();
    const reloadedStyle = await cardContainerReloaded.getAttribute('style');

    expect(reloadedStyle).toBe(initialStyle);
  });
});
