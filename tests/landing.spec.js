const { test, expect } = require('@playwright/test');

const sections = ['estudio', 'afluya', 'proceso', 'proyectos', 'integraciones', 'servicios', 'faq', 'contacto'];

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 740 }, { width: 1920, height: 1080 }]) {
  test(`landing renders and responds at ${viewport.width}px`, async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('.hero-media')).toHaveClass(/ready/);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(2500);
    await expect(page.locator('h1')).toHaveText('Diseño con carácter. Desarrollo con intención.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    // The tower keeps assembling itself.
    const tower = page.locator('#tower');
    const first = await tower.screenshot();
    await page.waitForTimeout(600);
    expect(Buffer.compare(first, await tower.screenshot())).not.toBe(0);
    const colored = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => {
      const canvas = document.querySelector('#tower');
      const copy = document.createElement('canvas');
      copy.width = canvas.width; copy.height = canvas.height;
      const context = copy.getContext('2d');
      context.drawImage(canvas, 0, 0);
      const rgba = context.getImageData(0, 0, copy.width, copy.height).data;
      let count = 0;
      for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] > 0 && rgba[i + 1] > 60) count++;
      resolve(count / (copy.width * copy.height));
    })));
    expect(colored).toBeGreaterThan(.015);
    await page.screenshot({ path: testInfo.outputPath('hero.png') });

    await page.getByRole('button', { name: 'Pausar animación' }).click();
    await expect(page.getByRole('button', { name: 'Reanudar animación' })).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(0, 0);
    await page.waitForTimeout(1200);
    const paused = await tower.screenshot();
    await page.waitForTimeout(300);
    expect(Buffer.compare(paused, await tower.screenshot())).toBe(0);
    await page.getByRole('button', { name: 'Reanudar animación' }).click();

    for (const id of sections) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      await page.waitForTimeout(1100);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${id}.png`) });
    }
    await page.locator('#proyectos').scrollIntoViewIfNeeded();
    await page.getByRole('tab', { name: 'PidoYa' }).click();
    await expect(page.getByRole('tab', { name: 'PidoYa' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#afluya a[href="https://afluya.com"]').first()).toBeVisible();
    await expect(page.locator('.contact-link')).toHaveAttribute('href', /^https:\/\/wa.me\/525636146876/);
    await page.locator('#faq summary').first().click();
    await expect(page.locator('#faq details').first()).toHaveAttribute('open', '');
    // The phone number is never shown; every WhatsApp link opens a prefilled message.
    expect(await page.evaluate(() => document.body.innerText.includes('3614'))).toBe(false);
    expect(await page.locator('a[href*="wa.me"]').evaluateAll(links => links.every(link => new URL(link.href).searchParams.get('text')?.includes('me interesa')))).toBe(true);
    expect(await page.locator('.card-media.rendered').count()).toBe(6);
    expect(await page.locator('img').evaluateAll(images => images.every(image => !image.complete || image.naturalWidth > 0))).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('reduced motion and unavailable WebGL keep the landing usable', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', baseURL: 'http://127.0.0.1:8790' });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.locator('.hero-media')).toHaveClass(/ready/);
  await expect(page.locator('.motion-control')).toBeHidden();
  await expect(page.locator('#estudio h2').first()).toHaveCSS('opacity', '1');
  await expect(page.locator('h1 .line').first()).toBeVisible();
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
  await expect(fallbackPage.locator('.hero-fallback')).toBeVisible();
  await expect(fallbackPage.locator('.motion-control')).toBeHidden();
  await expect(fallbackPage.locator('.contact-link')).toBeVisible();
  await fallback.close();
});
