const { test, expect } = require('@playwright/test');

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 740 }, { width: 1920, height: 1080 }]) {
  test(`landing renders and responds at ${viewport.width}px`, async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('.scene')).toHaveClass('scene ready');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500);
    await expect(page.locator('h1')).toHaveText('BorenStudio.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const canvas = page.locator('canvas');
    const first = await canvas.screenshot();
    await page.mouse.move(viewport.width * .8, 230);
    await page.waitForTimeout(400);
    expect(Buffer.compare(first, await canvas.screenshot())).not.toBe(0);
    const pixels = await page.evaluate(async () => {
      const canvas = document.querySelector('canvas');
      await new Promise(requestAnimationFrame);
      const copy = document.createElement('canvas');
      copy.width = canvas.width; copy.height = canvas.height;
      const context = copy.getContext('2d');
      context.drawImage(canvas, 0, 0);
      const rgba = context.getImageData(0, 0, copy.width, copy.height).data;
      let colored = 0;
      for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] > 0 && rgba[i + 1] > 60) colored++;
      return colored / (copy.width * copy.height);
    });
    expect(pixels).toBeGreaterThan(.015);
    await page.screenshot({ path: testInfo.outputPath('hero.png') });
    await page.getByRole('button', { name: 'Pausar animación' }).click();
    await expect(page.getByRole('button', { name: 'Reanudar animación' })).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(150);
    const paused = await canvas.screenshot();
    await page.waitForTimeout(200);
    expect(Buffer.compare(paused, await canvas.screenshot())).toBe(0);
    await page.getByRole('button', { name: 'Reanudar animación' }).click();
    for (const id of ['servicios', 'proyectos', 'estudio', 'faq', 'contacto']) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      await page.waitForTimeout(1100);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${id}.png`) });
    }
    await page.locator('#faq summary').first().click();
    await expect(page.locator('#faq details').first()).toHaveAttribute('open', '');
    await expect(page.locator('.contact-link')).toHaveAttribute('href', /^https:\/\/wa.me\/525636146876/);
    expect(await page.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('reduced motion and unavailable WebGL keep the landing usable', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', baseURL: 'http://127.0.0.1:8790' });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('.scene')).toHaveClass('scene ready');
  await expect(page.locator('.motion-control')).toBeHidden();
  await expect(page.locator('.intro h2')).toHaveCSS('opacity', '1');
  await context.close();
  const fallback = await browser.newContext({ baseURL: 'http://127.0.0.1:8790' });
  await fallback.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      return type.startsWith('webgl') ? null : getContext.call(this, type, ...args);
    };
  });
  const fallbackPage = await fallback.newPage();
  await fallbackPage.goto('/');
  await expect(fallbackPage.locator('.scene-fallback')).toBeVisible();
  await expect(fallbackPage.locator('.contact-link')).toBeVisible();
  await fallback.close();
});
