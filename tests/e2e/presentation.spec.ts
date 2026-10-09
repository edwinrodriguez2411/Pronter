import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import { pdfFixture, pptxFixture, svgFixture, wavFixture } from '../fixtures';
import { readFileSync, existsSync } from 'node:fs';

async function associate(host: Page, phone: Page, phoneOrigin = '') {
  await host.goto('/');
  await expect(host.locator('.qr-paper > svg')).toBeVisible();
  await expect(host.locator('.scan-station')).toHaveCSS('opacity', '1');
  // Resolve the QR token from a real host socket using the SVG encoder's rendered value isn't available.
  // Read its module-owned connection via a browser-independent QR decoder in the test below.
  const encoded = await host.locator('.qr-paper').screenshot();
  const { default: jsQR } = await import('jsqr');
  const { PNG } = await import('pngjs');
  const png = PNG.sync.read(encoded);
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  expect(decoded).not.toBeNull();
  const qrURL = new URL(decoded!.data);
  expect(qrURL.pathname).toBe('/control');
  const { publicUrl } = await (await host.request.get(new URL('/api/config', host.url()).href)).json() as { publicUrl: string };
  expect(qrURL.origin).toBe(new URL(publicUrl).origin);
  if (new URL(host.url()).protocol === 'https:') expect(qrURL.origin).toBe(new URL(host.url()).origin);
  const token = qrURL.hash;
  await phone.goto(`${phoneOrigin}/control${token}`);
  await expect(phone.getByText('Celular conectado', { exact: true })).toBeVisible();
  await expect(phone.getByRole('button', { name: /Enviar un archivo/ })).toBeEnabled();
  await expect(host.getByText('La pantalla es tuya.')).toBeVisible();
  return token;
}
async function upload(phone: Page, name: string, mimeType: string, buffer: Buffer) {
  await phone.locator('input[type=file]').setInputFiles({ name, mimeType, buffer });
  await expect(phone.locator('.current-file strong')).toHaveText(name);
}

async function networkInterruption(page: Page, stallOfflineHandshake = false) {
  let offline = false;
  let offlineAttempts = 0;
  const transports: WebSocketRoute[] = [];
  await page.routeWebSocket('**/socket.io/**', (socket) => {
    if (offline) { offlineAttempts++; if (!stallOfflineHandshake) void socket.close(); return; }
    transports.push(socket, socket.connectToServer());
  });
  return {
    get offlineAttempts() { return offlineAttempts; },
    async disconnect() {
      offline = true;
      await page.context().setOffline(true);
      // Browser offline emulation can leave an existing WebSocket open. Close both ends
      // so the test measures recovery after a detected transport loss, without waiting for a heartbeat.
      await Promise.all(transports.splice(0).map((socket) => socket.close()));
    },
    async reconnect() { offline = false; await page.context().setOffline(false); },
  };
}

test('returning online restarts a stalled handshake and permits the next file', async ({ browser }) => {
  const host = await browser.newPage(); const phone = await browser.newPage();
  const network = await networkInterruption(phone, true);
  await associate(host, phone); await upload(phone, 'primera.svg', 'image/svg+xml', svgFixture());
  await network.disconnect();
  await expect.poll(() => network.offlineAttempts).toBeGreaterThan(0);
  await network.reconnect();
  await phone.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(phone.getByText('Celular conectado', { exact: true })).toBeVisible({ timeout: 6000 });
  await upload(phone, 'despues-del-corte.pdf', 'application/pdf', pdfFixture());
  await expect(phone.getByRole('button', { name: 'Página siguiente' })).toBeEnabled();
  await host.close(); await phone.close();
});

async function drawOnPhone(phone: Page, touch = false) {
  const pad = phone.locator('.marker-pad'); await pad.scrollIntoViewIfNeeded();
  await expect(pad).toHaveAttribute('aria-disabled', 'false');
  const rect = (await pad.boundingBox())!;
  if (touch) {
    const scroll = await phone.evaluate(() => scrollY);
    const cdp = await phone.context().newCDPSession(phone);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x + rect.width * 0.25, y: rect.y + rect.height * 0.35 }] });
    for (let index = 1; index <= 12; index++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: rect.x + rect.width * (0.25 + index * 0.025), y: rect.y + rect.height * 0.35 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
    expect(await phone.evaluate(() => scrollY)).toBe(scroll);
  } else {
    await phone.mouse.move(rect.x + rect.width * 0.25, rect.y + rect.height * 0.35); await phone.mouse.down();
    await phone.mouse.move(rect.x + rect.width * 0.55, rect.y + rect.height * 0.35, { steps: 12 });
    await phone.mouse.up();
  }
  await expect(phone.getByRole('button', { name: 'Deshacer último trazo' })).toBeEnabled();
}
async function inkPixel(host: Page, selector: string, x: number, y: number) {
  return host.evaluate(({ selector, x, y }) => {
    const element = document.querySelector(selector)!;
    let rect = element.getBoundingClientRect();
    if (element instanceof SVGSVGElement || element instanceof HTMLVideoElement) {
      const ratio = element instanceof SVGSVGElement ? element.viewBox.baseVal.width / element.viewBox.baseVal.height : element.videoWidth / element.videoHeight;
      const width = Math.min(rect.width, rect.height * ratio), height = width / ratio;
      rect = new DOMRect(rect.left + (rect.width - width) / 2, rect.top + (rect.height - height) / 2, width, height);
    }
    const canvas = document.querySelector<HTMLCanvasElement>('.annotation-canvas')!;
    const overlay = canvas.getBoundingClientRect(), scale = canvas.width / overlay.width;
    const px = Math.round((rect.left + rect.width * x - overlay.left) * scale), py = Math.round((rect.top + rect.height * y - overlay.top) * scale);
    if (px < 2 || py < 2 || px >= canvas.width - 2 || py >= canvas.height - 2) return [0, 0, 0, 0];
    const pixels = canvas.getContext('2d')!.getImageData(px - 2, py - 2, 5, 5).data;
    let best = [0, 0, 0, 0];
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 3] > best[3]) best = Array.from(pixels.slice(index, index + 4));
    return best;
  }, { selector, x, y });
}
async function inkPixels(host: Page) {
  return host.locator('.annotation-canvas').evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0; for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) count++;
    return count;
  });
}

async function previewColor(phone: Page, x: number, y: number) {
  return phone.locator('.marker-preview').evaluate((image: HTMLImageElement, { x, y }) => {
    if (!image.complete || !image.naturalWidth) return [];
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    return [...context.getImageData(Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1).data].slice(0, 3);
  }, { x, y });
}
async function expectPreviewColor(phone: Page, x: number, y: number, color: number[]) {
  await expect.poll(async () => {
    const pixel = await previewColor(phone, x, y);
    return pixel.length === 3 && pixel.every((value, index) => Math.abs(value - color[index]) < 24);
  }).toBe(true);
}
async function previewTextPixels(phone: Page, blue = false) {
  return phone.locator('.marker-preview').evaluate((image: HTMLImageElement, blue) => {
    if (!image.complete || !image.naturalWidth) return 0;
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0; for (let index = 0; index < pixels.length; index += 4) if (blue ? pixels[index + 2] > pixels[index] + 40 : Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) < 150) count++;
    return count;
  }, blue);
}

test('clearing and undoing remove ink from both screens through repeated file replacements', async ({ browser }) => {
  test.setTimeout(90000);
  const host = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const phone = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const errors: string[] = []; host.on('pageerror', (error) => errors.push(error.message)); phone.on('pageerror', (error) => errors.push(error.message));
  await associate(host, phone);
  await upload(phone, 'primera.svg', 'image/svg+xml', svgFixture('#ff755c'));
  await phone.getByRole('button', { name: 'Marcador', exact: true }).click();
  await phone.getByRole('button', { name: 'Color azul' }).click();
  await phone.getByLabel('Grosor del marcador').selectOption('0.014');
  for (let index = 0; index < 3; index++) {
    await drawOnPhone(phone, true);
    await expectPreviewColor(phone, 0.4, 0.35, [36, 72, 232]);
    await phone.getByRole('button', { name: index === 1 ? 'Deshacer último trazo' : 'Borrar trazos de esta página' }).click();
    await expect.poll(() => inkPixels(host)).toBe(0);
    await expectPreviewColor(phone, 0.4, 0.35, [255, 117, 92]);
  }
  for (let index = 0; index < 3; index++) {
    await upload(phone, `paginas-${index}.pdf`, 'application/pdf', pdfFixture());
    await drawOnPhone(phone, true);
    await phone.getByRole('button', { name: 'Borrar trazos de esta página' }).click();
    await expect.poll(() => inkPixels(host)).toBe(0);
    await expectPreviewColor(phone, 0.4, 0.35, [255, 255, 255]);
    await upload(phone, `slides-${index}.pptx`, 'application/vnd.openxmlformats-officedocument.presentationml.presentation', pptxFixture());
    await drawOnPhone(phone, true);
    await upload(phone, `imagen-${index}.svg`, 'image/svg+xml', svgFixture('#ff755c'));
    await expect(phone.locator('.marker-pad')).toHaveAttribute('aria-disabled', 'false');
    await expectPreviewColor(phone, 0.4, 0.35, [255, 117, 92]);
    await expect(host.locator('.viewer-layer')).toHaveCount(1);
    await expect(phone.locator('.upload-progress')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
  await phone.screenshot({ path: '.cache/marker-clear-fixed.png', fullPage: true });
  await host.close(); await phone.close();
});

test('a stalled phone preview cannot retain erased ink or block a replacement file', async ({ browser }) => {
  const host = await browser.newPage();
  const phone = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  let holdZoomAck = false, zoomAck = '', releaseAck: (() => void) | undefined;
  await phone.routeWebSocket('**/socket.io/**', (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (holdZoomAck && typeof message === 'string' && message.includes('"viewer:command"') && message.includes('"zoom"')) zoomAck = message.match(/^42\/control,(\d+)/)?.[1] || '';
      server.send(message);
    });
    server.onMessage((message) => {
      if (zoomAck && typeof message === 'string' && message.startsWith(`43/control,${zoomAck}[`)) { releaseAck = () => socket.send(message); return; }
      socket.send(message);
    });
  });
  await associate(host, phone); await upload(phone, 'antes.svg', 'image/svg+xml', svgFixture('#ff755c'));
  await phone.getByRole('button', { name: 'Marcador', exact: true }).click();
  await phone.getByRole('button', { name: 'Color azul' }).click();
  await phone.getByLabel('Grosor del marcador').selectOption('0.014');
  await drawOnPhone(phone, true); await expectPreviewColor(phone, 0.4, 0.35, [36, 72, 232]);
  // Fault injection: browser image export never invokes its callback. The app must
  // cancel a superseded capture and bound a stalled one, instead of keeping busy forever.
  await host.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    (window as unknown as Record<string, unknown>).previewStalled = false;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (type === 'image/jpeg') { (window as unknown as Record<string, unknown>).previewStalled = true; return; }
      original.call(this, callback, type, quality);
    };
    (window as unknown as Record<string, unknown>).restoreExport = () => { HTMLCanvasElement.prototype.toBlob = original; };
  });
  await phone.getByRole('button', { name: 'Borrar trazos de esta página' }).click();
  await expect.poll(() => inkPixels(host)).toBe(0);
  await expect.poll(() => host.evaluate(() => (window as unknown as Record<string, unknown>).previewStalled)).toBe(true);
  await expect(phone.locator('.marker-preview')).toHaveCount(0);
  await expect(phone.locator('.marker-pad')).toHaveAttribute('aria-disabled', 'true');
  await host.evaluate(() => { ((window as unknown as Record<string, () => void>).restoreExport)(); });
  await expectPreviewColor(phone, 0.4, 0.35, [255, 117, 92]);
  await host.evaluate(() => {
    (window as unknown as Record<string, unknown>).previewStalled = false;
    HTMLCanvasElement.prototype.toBlob = function () { (window as unknown as Record<string, unknown>).previewStalled = true; };
  });
  await drawOnPhone(phone, true);
  await expect.poll(() => host.evaluate(() => (window as unknown as Record<string, unknown>).previewStalled)).toBe(true);
  await upload(phone, 'despues.svg', 'image/svg+xml', svgFixture('#f2b705'));
  await host.evaluate(() => { ((window as unknown as Record<string, () => void>).restoreExport)(); });
  await expect(phone.locator('.marker-pad')).toHaveAttribute('aria-disabled', 'false');
  await expectPreviewColor(phone, 0.1, 0.1, [242, 183, 5]);
  // The next upload supersedes an image still decoding. Its late completion must
  // not replace the latest file, leave hidden layers behind or keep controls locked.
  await host.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode; let delayed = false;
    HTMLImageElement.prototype.decode = async function () {
      await decode.call(this);
      if (!delayed) { delayed = true; (window as unknown as Record<string, unknown>).decodeDelayed = true; await new Promise((resolve) => setTimeout(resolve, 1800)); }
    };
  });
  await phone.locator('input[type=file]').setInputFiles({ name: 'lenta.svg', mimeType: 'image/svg+xml', buffer: svgFixture() });
  await expect.poll(() => host.evaluate(() => (window as unknown as Record<string, unknown>).decodeDelayed)).toBe(true);
  await upload(phone, 'ultima.svg', 'image/svg+xml', svgFixture('#ff755c'));
  await expect(phone.locator('.marker-pad')).toHaveAttribute('aria-disabled', 'false');
  await expectPreviewColor(phone, 0.1, 0.1, [255, 117, 92]);
  await expect(host.locator('.viewer-layer')).toHaveCount(1);
  holdZoomAck = true;
  await phone.getByRole('button', { name: 'Acercar', exact: true }).click();
  await expect(phone.locator('.zoom-controls')).toContainText('125%');
  await expect.poll(() => !!releaseAck).toBe(true);
  await upload(phone, 'final.svg', 'image/svg+xml', svgFixture('#f2b705'));
  // An ACK for the old file is still held, but new-file controls must be usable.
  await expect(phone.locator('.marker-pad')).toHaveAttribute('aria-disabled', 'false');
  await expect(phone.getByRole('button', { name: 'Acercar', exact: true })).toBeEnabled();
  holdZoomAck = false; releaseAck!(); zoomAck = '';
  await phone.waitForTimeout(1800);
  await expect(phone.locator('.current-file strong')).toHaveText('final.svg');
  await expect(host.locator('.viewer-layer')).toHaveCount(1);
  await host.close(); await phone.close();
});

test('phone sees the file and synchronized ink, and controls fullscreen with an honest browser fallback', async ({ browser }) => {
  const host = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await associate(host, phone);
  // An expired host gesture cannot authorize native fullscreen remotely.
  await host.evaluate(() => { document.documentElement.requestFullscreen = () => Promise.reject(new DOMException('User activation required', 'NotAllowedError')); });
  await phone.getByRole('button', { name: 'Pantalla completa del PC', exact: true }).click();
  await expect(host.locator('.host-app')).toHaveClass(/is-expanded/);
  await expect(host.locator('.app-header')).toBeHidden();
  await expect(host.getByRole('button', { name: 'Activar pantalla completa', exact: true })).toBeVisible();
  await expect(phone.getByText(/Para ocultar las barras del navegador/)).toBeVisible();
  await phone.getByRole('button', { name: 'Salir de pantalla completa del PC', exact: true }).click();
  await expect(host.locator('.app-header')).toBeVisible();
  await host.evaluate(() => { delete (document.documentElement as unknown as Record<string, unknown>).requestFullscreen; });
  await upload(phone, 'vista.svg', 'image/svg+xml', svgFixture('#ff755c'));
  await phone.getByRole('button', { name: 'Marcador', exact: true }).click();
  const pad = phone.locator('.marker-pad'); await expect(pad).toHaveAttribute('aria-disabled', 'false');
  await expectPreviewColor(phone, 0.1, 0.1, [255, 117, 92]);
  await phone.getByRole('button', { name: 'Color azul' }).click(); await phone.getByLabel('Grosor del marcador').selectOption('0.014');
  await drawOnPhone(phone, true);
  await expect.poll(() => inkPixel(host, '.content-image img', 0.4, 0.35)).toEqual([36, 72, 232, 255]);
  await expectPreviewColor(phone, 0.4, 0.35, [36, 72, 232]);
  const originalView = await phone.locator('.marker-preview').getAttribute('data-view');
  await phone.getByRole('button', { name: 'Acercar', exact: true }).click();
  await expect(pad).toHaveAttribute('aria-disabled', 'false');
  await expect(phone.locator('.marker-preview')).not.toHaveAttribute('data-view', originalView!);
  await expectPreviewColor(phone, 0.1, 0.1, [255, 117, 92]);
  await upload(phone, 'paginas.pdf', 'application/pdf', pdfFixture()); await expect(pad).toHaveAttribute('aria-disabled', 'false');
  await expectPreviewColor(phone, 0.1, 0.1, [255, 255, 255]);
  await expect.poll(() => previewTextPixels(phone)).toBeGreaterThan(100);
  const firstPage = await phone.locator('.marker-preview').getAttribute('src');
  await phone.getByRole('button', { name: 'Página siguiente' }).click(); await expect(pad).toHaveAttribute('aria-disabled', 'false');
  await expect(phone.locator('.marker-preview')).toHaveAttribute('data-page', '2');
  await expect(phone.locator('.marker-preview')).not.toHaveAttribute('src', firstPage!);
  await upload(phone, 'diapositivas.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', pptxFixture()); await expect(pad).toHaveAttribute('aria-disabled', 'false');
  await expectPreviewColor(phone, 0.1, 0.1, [238, 240, 255]);
  await expect.poll(() => previewTextPixels(phone, true)).toBeGreaterThan(100);
  await upload(phone, 'documento.md', 'text/markdown', Buffer.from('# Vista móvil\n\nDocumento que puedes señalar.'));
  await expect(pad).toHaveAttribute('aria-disabled', 'false');
  await expectPreviewColor(phone, 0.9, 0.9, [255, 255, 255]);
  await expect.poll(() => previewTextPixels(phone)).toBeGreaterThan(100);
  await upload(phone, 'video.mp4', 'video/mp4', readFileSync('tests/fixtures/sample.mp4')); await expect(pad).toHaveAttribute('aria-disabled', 'false');
  await expect(phone.locator('.marker-preview')).toHaveJSProperty('naturalWidth', 800);
  await upload(phone, 'presentacion.svg', 'image/svg+xml', svgFixture('#ff755c')); await expect(pad).toHaveAttribute('aria-disabled', 'false');
  await drawOnPhone(phone); await expectPreviewColor(phone, 0.4, 0.35, [36, 72, 232]);
  await phone.screenshot({ path: '.cache/mobile-file-preview.png', fullPage: true });
  await host.screenshot({ path: '.cache/host-file-preview.png' });
  await phone.getByRole('button', { name: 'Pantalla completa del PC', exact: true }).click();
  await expect(host.locator('.host-app')).toHaveClass(/is-expanded/);
  await expect(pad).toHaveAttribute('aria-disabled', 'false');
  await expectPreviewColor(phone, 0.1, 0.1, [255, 117, 92]);
  await phone.getByRole('button', { name: 'Salir de pantalla completa del PC', exact: true }).click();
  await expect(host.locator('.host-app')).not.toHaveClass(/is-expanded/);
  // Exiting genuine native fullscreen also works from the phone.
  await host.getByRole('button', { name: 'Pantalla completa', exact: true }).click();
  await expect(phone.getByRole('button', { name: 'Salir de pantalla completa del PC', exact: true })).toBeVisible();
  await phone.getByRole('button', { name: 'Salir de pantalla completa del PC', exact: true }).click();
  await expect.poll(() => host.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await host.close(); await phone.close();
});

test('phone and PC drawing follows zoom, pan, resize, reconnect, replacement and fullscreen', async ({ browser }) => {
  const host = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors: string[] = []; host.on('pageerror', (error) => errors.push(error.message)); phone.on('pageerror', (error) => errors.push(error.message));
  const network = await networkInterruption(phone);
  await associate(host, phone);
  await upload(phone, 'marcador.svg', 'image/svg+xml', svgFixture());
  await phone.getByRole('button', { name: 'Marcador', exact: true }).click();
  await phone.getByRole('button', { name: 'Color azul' }).click();
  await phone.getByLabel('Grosor del marcador').selectOption('0.014');
  await drawOnPhone(phone, true);
  const overlay = host.locator('.annotation-canvas');
  await expect(overlay).toHaveAttribute('data-strokes', '1');
  await expect.poll(() => inkPixel(host, '.content-image img', 0.4, 0.35)).toEqual([36, 72, 232, 255]);
  await phone.getByRole('button', { name: 'Acercar', exact: true }).click();
  await expect(phone.locator('.zoom-controls')).toContainText('125%');
  await expect.poll(() => inkPixel(host, '.content-image img', 0.4, 0.35)).toEqual([36, 72, 232, 255]);
  await phone.getByRole('button', { name: 'Desplazar a la izquierda' }).click();
  await expect.poll(() => inkPixel(host, '.content-image img', 0.4, 0.35)).toEqual([36, 72, 232, 255]);
  await phone.getByRole('button', { name: 'Ajustar', exact: true }).click();
  await expect(phone.locator('.marker-pad')).toHaveAttribute('aria-disabled', 'false');
  await expect(phone.locator('.zoom-controls')).toContainText('100%');
  await host.setViewportSize({ width: 1024, height: 768 });
  await expect.poll(() => inkPixel(host, '.content-image img', 0.4, 0.35)).toEqual([36, 72, 232, 255]);
  await host.getByRole('button', { name: 'Dibujar en el PC', exact: true }).click();
  await expect(overlay).toHaveClass(/is-drawing/);
  const image = (await host.locator('.content-image img').boundingBox())!;
  await host.mouse.move(image.x + image.width * 0.4, image.y + image.height * 0.6); await host.mouse.down();
  await host.mouse.move(image.x + image.width * 0.6, image.y + image.height * 0.6, { steps: 12 }); await host.mouse.up();
  await expect(overlay).toHaveAttribute('data-strokes', '2');
  await expect.poll(() => inkPixel(host, '.content-image img', 0.5, 0.6)).toEqual([227, 66, 52, 255]);
  await host.getByRole('button', { name: 'Deshacer último trazo' }).click(); await expect(overlay).toHaveAttribute('data-strokes', '1');
  await phone.getByRole('button', { name: 'Deshacer último trazo' }).click(); await expect(overlay).toHaveAttribute('data-strokes', '0');
  await drawOnPhone(phone); await drawOnPhone(phone); await expect(overlay).toHaveAttribute('data-strokes', '2');
  await phone.getByRole('button', { name: 'Borrar trazos de esta página' }).click();
  await expect.poll(() => inkPixels(host)).toBe(0);
  await drawOnPhone(phone); await expect(overlay).toHaveAttribute('data-strokes', '1');
  await network.disconnect(); await expect(phone.getByText(/Reconectando ·/)).toBeVisible();
  await network.reconnect(); await expect(phone.getByText('Celular conectado', { exact: true })).toBeVisible();
  await expect.poll(() => phone.locator('.controller-error').allTextContents()).toEqual([]);
  await expect(overlay).toHaveAttribute('data-strokes', '1');
  await phone.locator('input[type=file]').setInputFiles({ name: 'roto.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') });
  await expect(phone.locator('.controller-notice')).toContainText('no coincide');
  await expect(overlay).toHaveAttribute('data-strokes', '1');
  await host.getByRole('button', { name: 'Pantalla completa', exact: true }).click();
  await expect(host.getByRole('button', { name: 'Salir de pantalla completa' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => inkPixel(host, '.content-image img', 0.4, 0.35)).toEqual([36, 72, 232, 255]);
  await host.keyboard.press('f'); await expect(host.getByRole('button', { name: 'Pantalla completa', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await upload(phone, 'nuevo.svg', 'image/svg+xml', svgFixture('#ff755c'));
  await expect(overlay).toHaveAttribute('data-strokes', '0'); await expect.poll(() => inkPixels(host)).toBe(0);
  await phone.getByRole('button', { name: 'Color blanco' }).click(); await drawOnPhone(phone);
  await expect(overlay).toHaveAttribute('data-strokes', '1');
  await phone.screenshot({ path: '.cache/marker-phone.png', fullPage: true });
  await host.screenshot({ path: '.cache/marker-desktop.png' });
  await phone.getByRole('button', { name: 'Salir', exact: true }).click();
  await expect(host.getByText('Sesión terminada.', { exact: true })).toBeVisible(); await expect(overlay).toHaveCount(0);
  await expect(host.locator('.qr-paper > svg')).toBeVisible();
  expect(errors).toEqual([]); await host.close(); await phone.close();
});

test('drawing belongs to each PDF/PPTX page and follows Markdown scrolling and video letterboxing', async ({ browser }) => {
  const host = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const phone = await browser.newPage({ viewport: { width: 320, height: 812 } });
  // Delay control state and acknowledgements to expose stale-page actions on the internet.
  await phone.routeWebSocket('**/socket.io/**', (socket) => {
    const server = socket.connectToServer();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    socket.onClose(() => { for (const timer of timers) clearTimeout(timer); timers.clear(); });
    server.onMessage((message) => {
      if (typeof message !== 'string' || !message.includes('/control,')) { socket.send(message); return; }
      const timer = setTimeout(() => { timers.delete(timer); socket.send(message); }, 250);
      timers.add(timer);
    });
  });
  const errors: string[] = []; host.on('pageerror', (error) => errors.push(error.message)); phone.on('pageerror', (error) => errors.push(error.message));
  await associate(host, phone); await upload(phone, 'paginas.pdf', 'application/pdf', pdfFixture());
  await phone.getByRole('button', { name: 'Marcador', exact: true }).click(); await drawOnPhone(phone);
  const overlay = host.locator('.annotation-canvas'); await expect(overlay).toHaveAttribute('data-strokes', '1');
  await expect.poll(() => inkPixel(host, '.content-pdf canvas', 0.4, 0.35)).toEqual([227, 66, 52, 255]);
  expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await phone.getByRole('button', { name: 'Página siguiente' }).click();
  await expect(phone.locator('.marker-pad')).toHaveAttribute('aria-disabled', 'true');
  await expect(overlay).toHaveAttribute('data-strokes', '0');
  await phone.getByRole('button', { name: 'Color azul' }).click(); await drawOnPhone(phone); await expect(overlay).toHaveAttribute('data-strokes', '1');
  await phone.getByRole('button', { name: 'Página anterior' }).click();
  await expect.poll(() => inkPixel(host, '.content-pdf canvas', 0.4, 0.35)).toEqual([227, 66, 52, 255]);
  await phone.getByRole('button', { name: 'Borrar trazos de esta página' }).click(); await expect(overlay).toHaveAttribute('data-strokes', '0');
  await phone.getByRole('button', { name: 'Página siguiente' }).click();
  await expect.poll(() => inkPixel(host, '.content-pdf canvas', 0.4, 0.35)).toEqual([36, 72, 232, 255]);
  await upload(phone, 'diapositivas.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', pptxFixture());
  await expect(overlay).toHaveAttribute('data-strokes', '0'); await drawOnPhone(phone);
  await expect.poll(() => inkPixel(host, '.ppt-slide > svg', 0.4, 0.35)).toEqual([36, 72, 232, 255]);
  await phone.getByRole('button', { name: 'Página siguiente' }).click(); await expect(overlay).toHaveAttribute('data-strokes', '0');
  await phone.getByRole('button', { name: 'Página anterior' }).click(); await expect(overlay).toHaveAttribute('data-strokes', '1');
  await upload(phone, 'documento.md', 'text/markdown', Buffer.from('# Documento largo\n\n' + Array.from({ length: 40 }, (_, index) => `Párrafo ${index + 1}: una explicación para comprobar el desplazamiento.\n\n`).join('')));
  await drawOnPhone(phone); await expect(overlay).toHaveAttribute('data-strokes', '1');
  await expect.poll(() => inkPixels(host)).toBeGreaterThan(0);
  await phone.getByRole('button', { name: 'Bajar documento' }).click(); await phone.getByRole('button', { name: 'Bajar documento' }).click();
  await expect.poll(() => inkPixels(host)).toBe(0);
  await phone.getByRole('button', { name: 'Subir documento' }).click(); await phone.getByRole('button', { name: 'Subir documento' }).click();
  await expect.poll(() => inkPixels(host)).toBeGreaterThan(0);
  await upload(phone, 'video.mp4', 'video/mp4', readFileSync('tests/fixtures/sample.mp4'));
  await drawOnPhone(phone); await expect(overlay).toHaveAttribute('data-strokes', '1');
  await expect.poll(() => inkPixel(host, '.content-video > video', 0.4, 0.35)).toEqual([36, 72, 232, 255]);
  expect(errors).toEqual([]); await host.close(); await phone.close();
});

test('real QR, exclusive controller, image, pointer, replacement, failure preservation and exit', async ({ browser }) => {
  const host = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors: string[] = []; host.on('pageerror', (error) => errors.push(error.message)); phone.on('pageerror', (error) => errors.push(error.message));
  const token = await associate(host, phone);
  await host.getByRole('button', { name: 'Pantalla completa', exact: true }).click();
  await expect.poll(() => host.evaluate(() => document.fullscreenElement === document.documentElement)).toBe(true);
  await host.getByRole('button', { name: 'Salir de pantalla completa', exact: true }).click();
  await expect.poll(() => host.evaluate(() => document.fullscreenElement === null)).toBe(true);
  const other = await browser.newPage(); await other.goto(`/control${token}`);
  await expect(other.getByText('Esta pantalla ya tiene un celular conectado.')).toBeVisible();
  await upload(phone, 'hola.svg', 'image/svg+xml', svgFixture());
  await expect(host.locator('.content-image img')).toBeVisible();
  await phone.getByRole('button', { name: 'Acercar', exact: true }).click();
  await expect(phone.locator('.zoom-controls')).toContainText('125%');
  await phone.locator('.laser-pad').scrollIntoViewIfNeeded();
  const pad = await phone.locator('.laser-pad').boundingBox();
  await phone.mouse.move(pad!.x + 60, pad!.y + 60); await phone.mouse.down();
  await expect(host.getByTestId('host-laser')).toHaveCSS('opacity', '1');
  await phone.mouse.up(); await expect(host.getByTestId('host-laser')).toHaveCSS('opacity', '0');
  await upload(phone, 'dos.svg', 'image/svg+xml', svgFixture('#ff755c'));
  await expect(host.locator('.viewer-layer:not(.is-candidate)')).toHaveCount(1);
  await phone.locator('input[type=file]').setInputFiles({ name: 'roto.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') });
  await expect(phone.locator('.controller-notice')).toContainText('no coincide');
  await expect(phone.locator('.current-file strong')).toHaveText('dos.svg');
  await phone.getByRole('button', { name: 'Pantalla negra' }).click();
  await expect(host.locator('.black-curtain')).toBeVisible();
  await phone.getByRole('button', { name: 'Mostrar presentación' }).click();
  await expect(host.locator('.black-curtain')).toHaveCount(0);
  const download = host.waitForEvent('download', { timeout: 500 }).then(() => true, () => false);
  await phone.getByRole('button', { name: 'Salir', exact: true }).click();
  await expect(host.getByText('Sesión terminada.', { exact: true })).toBeVisible();
  await expect(host.locator('.qr-paper > svg')).toBeVisible();
  expect(await download).toBe(false);
  await other.reload(); await expect(other.getByText(/Este QR ya se usó o caducó/)).toBeVisible();
  expect(errors).toEqual([]);
  await host.close(); await phone.close(); await other.close();
});

test('HTTP LAN phone uploads and controls a file after waiting in the chooser', async ({ browser, request }) => {
  test.setTimeout(90000);
  const { publicUrl } = await (await request.get('/api/config')).json() as { publicUrl: string };
  test.skip(new URL(publicUrl).protocol !== 'http:' || ['localhost', '127.0.0.1'].includes(new URL(publicUrl).hostname), 'This scenario requires a local HTTP network interface.');
  const host = await browser.newPage();
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors: string[] = []; phone.on('pageerror', (error) => errors.push(error.message));
  const network = await networkInterruption(phone);
  const token = await associate(host, phone, publicUrl);
  expect(await phone.evaluate(() => ({ secure: isSecureContext, uuid: typeof crypto.randomUUID }))).toEqual({ secure: false, uuid: 'undefined' });
  const chooserPromise = phone.waitForEvent('filechooser');
  await phone.getByRole('button', { name: /Enviar un archivo/ }).click();
  const chooser = await chooserPromise;
  await expect(host.getByText('Eligiendo archivo en el celular', { exact: true })).toBeVisible();
  const session = await phone.context().newCDPSession(phone);
  await session.send('Page.setWebLifecycleState', { state: 'frozen' });
  // Native Android file pickers can suspend the page. Keep it frozen beyond the old 10s timeout.
  await new Promise((resolve) => setTimeout(resolve, 16000));
  await session.send('Page.setWebLifecycleState', { state: 'active' });
  await chooser.setFiles({ name: 'desde-celular.svg', mimeType: 'image/svg+xml', buffer: svgFixture() });
  await expect(phone.locator('.current-file strong')).toHaveText('desde-celular.svg');
  await phone.getByRole('button', { name: 'Acercar', exact: true }).click();
  await expect(phone.locator('.zoom-controls')).toContainText('125%');
  // Choose again, lose both transports, and return after the normal 20s reservation.
  const nextChooser = phone.waitForEvent('filechooser');
  await phone.getByRole('button', { name: /Enviar otro archivo/ }).click();
  const second = await nextChooser;
  await expect(host.getByText('Eligiendo archivo en el celular', { exact: true })).toBeVisible();
  await network.disconnect();
  await expect(host.getByText('El celular está eligiendo un archivo. La pantalla sigue reservada.', { exact: true })).toBeVisible();
  await new Promise((resolve) => setTimeout(resolve, 22000));
  const other = await browser.newPage(); await other.goto(`/control${token}`);
  await expect(other.getByText('Esta pantalla ya tiene un celular conectado.')).toBeVisible();
  // Deliver the selected File before reconnection completes: the app must hold it and recover.
  await second.setFiles({ name: 'despues-de-buscar.pdf', mimeType: 'application/pdf', buffer: pdfFixture() });
  await network.reconnect();
  // Allow the app's 30s connection wait plus preparation of the received PDF.
  await expect(phone.locator('.current-file strong')).toHaveText('despues-de-buscar.pdf', { timeout: 35000 });
  await phone.getByRole('button', { name: 'Página siguiente' }).click();
  await expect(phone.getByRole('spinbutton', { name: 'Ir a página' })).toHaveValue('2');
  expect(errors).toEqual([]);
  await phone.getByRole('button', { name: 'Salir', exact: true }).click();
  await expect(host.getByText('Sesión terminada.', { exact: true })).toBeVisible();
  await host.close(); await phone.close(); await other.close();
});

test('file-channel namespace rejection is retried without losing the controller credential', async ({ browser }) => {
  const host = await browser.newPage(); const phone = await browser.newPage();
  let rejections = 0;
  await phone.routeWebSocket('**/socket.io/**', (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (typeof message === 'string' && message.startsWith('40/transfer,') && rejections === 0) {
        rejections++;
        socket.send('44/transfer,{"message":"El canal está recuperándose."}');
      } else server.send(message);
    });
  });
  await associate(host, phone);
  expect(rejections).toBe(1);
  await upload(phone, 'tras-reintento.svg', 'image/svg+xml', svgFixture());
  await expect(host.locator('.content-image img')).toBeVisible();
  await phone.getByRole('button', { name: 'Salir', exact: true }).click();
  await host.close(); await phone.close();
});

test('PDF pages, PPTX slides, Markdown GFM and audio controls in one SPA', async ({ browser }) => {
  const host = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors: string[] = []; host.on('pageerror', (error) => errors.push(error.message));
  await associate(host, phone);
  await upload(phone, 'documento.pdf', 'application/pdf', pdfFixture());
  await expect(host.locator('.content-pdf canvas')).toBeVisible();
  await phone.getByRole('button', { name: 'Página siguiente' }).click();
  await expect(phone.getByRole('spinbutton', { name: 'Ir a página' })).toHaveValue('2');
  await upload(phone, 'ideas.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', pptxFixture());
  await expect(host.locator('.ppt-slide')).toContainText('Diapositiva 1');
  await expect(host.locator('.ppt-slide svg')).toHaveAttribute('viewBox', '0 0 960 540');
  await expect(host.locator('.ppt-slide rect').first()).toHaveAttribute('fill', 'rgb(238,240,255)');
  await expect(host.locator('.ppt-slide foreignObject')).toHaveAttribute('width', '787.4');
  await phone.getByRole('button', { name: 'Página siguiente' }).click();
  await expect(host.locator('.ppt-slide')).toContainText('Diapositiva 2');
  await phone.getByLabel('Vista estática').click();
  await expect(phone.getByLabel('Vista estática')).toBeChecked();
  await upload(phone, 'notas.md', 'text/markdown', Buffer.from('# Hola, Markdown\n\n| Una | Tabla |\n|---|---|\n| Sí | Funciona |\n\n<script>window.infected = true</script>\n\n![externa](https://example.com/leak.png)'));
  await expect(host.locator('.markdown-content h1')).toHaveText('Hola, Markdown');
  await expect(host.locator('.markdown-content table')).toBeVisible();
  expect(await host.evaluate(() => (window as unknown as { infected?: boolean }).infected)).toBeUndefined();
  expect(await host.locator('.markdown-content img').count()).toBe(0);
  await upload(phone, 'cancion.wav', 'audio/wav', wavFixture());
  await expect(host.locator('audio')).toBeVisible();
  await host.getByRole('button', { name: 'Activar audio' }).click();
  await expect(phone.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible();
  await phone.getByRole('button', { name: 'Pausar', exact: true }).click();
  await expect(phone.getByRole('button', { name: 'Reproducir', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await host.close(); await phone.close();
});

test('landing and controller do not overflow small viewports and respect reduced motion', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' });
  await page.goto('/'); await expect(page.locator('.qr-paper > svg')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator('.scan-station').evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  await page.close();
});

test('native video, browser conversion and recovery retain the current presentation', async ({ browser, baseURL }) => {
  test.setTimeout(120000);
  const host = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  const phone = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const network = await networkInterruption(phone);
  const errors: string[] = []; host.on('pageerror', (error) => errors.push(error.message));
  const external: string[] = []; host.on('request', (request) => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(baseURL!).origin) external.push(request.url()); });
  const token = await associate(host, phone);
  await upload(phone, 'video.mp4', 'video/mp4', readFileSync('tests/fixtures/sample.mp4'));
  await expect(host.locator('video')).toBeVisible();
  await host.getByRole('button', { name: 'Activar audio' }).click();
  await expect(phone.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible();
  await phone.getByRole('button', { name: 'Pausar', exact: true }).click();
  await expect(phone.getByRole('button', { name: 'Reproducir', exact: true })).toBeVisible();
  await phone.getByLabel('Velocidad de reproducción').selectOption('1.5');
  await expect.poll(() => host.locator('video').evaluate((element: HTMLVideoElement) => element.playbackRate)).toBe(1.5);
  await upload(phone, 'convertir.avi', 'video/x-msvideo', readFileSync('tests/fixtures/sample.avi'));
  await expect(host.locator('video')).toBeVisible();
  expect(await host.locator('video').evaluate((element: HTMLVideoElement) => element.videoWidth)).toBe(320);
  await network.disconnect();
  await expect(host.getByText(/Reconectando ·/)).toBeVisible();
  const other = await browser.newPage(); await other.goto(`/control${token}`);
  await expect(other.getByText('Esta pantalla ya tiene un celular conectado.')).toBeVisible();
  await network.reconnect();
  await expect(phone.getByText('Celular conectado', { exact: true })).toBeVisible();
  await expect(phone.locator('.current-file strong')).toHaveText('convertir.avi');
  await upload(phone, 'tras-reconectar.svg', 'image/svg+xml', svgFixture());
  expect(await phone.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }))).toEqual({ local: 0, session: 0, cookie: '' });
  expect(await host.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }))).toEqual({ local: 0, session: 0, cookie: '' });
  expect(external).toEqual([]); expect(errors).toEqual([]);
  await host.close(); await phone.close(); await other.close();
});

test('HEIC browser worker decodes the upstream fixture when available', async ({ browser }) => {
  test.skip(!existsSync('tests/fixtures/example.heic'), 'Optional upstream fixture; see README.');
  const host = await browser.newPage(); const phone = await browser.newPage();
  await associate(host, phone);
  await upload(phone, 'foto.heic', 'image/heic', readFileSync('tests/fixtures/example.heic'));
  await expect(host.locator('.content-image img')).toBeVisible();
  expect(await host.locator('.content-image img').evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(100);
  await host.close(); await phone.close();
});

test('legacy PPT renders the upstream sample when available', async ({ browser }) => {
  test.skip(!existsSync('tests/fixtures/sample.ppt'), 'Optional upstream fixture; see README.');
  const host = await browser.newPage(); const phone = await browser.newPage();
  await associate(host, phone);
  await upload(phone, 'antiguo.ppt', 'application/vnd.ms-powerpoint', readFileSync('tests/fixtures/sample.ppt'));
  await expect(host.locator('.ppt-slide svg')).toBeVisible();
  await expect(host.locator('.ppt-slide')).toContainText('CFB');
  await host.close(); await phone.close();
});

test('PowerPoint animation steps and embedded images survive Worker disposal', async ({ browser }) => {
  test.skip(!existsSync('tests/fixtures/animated.pptx') || !existsSync('tests/fixtures/embedded.pptx'), 'Optional upstream fixtures; see README.');
  const host = await browser.newPage(); const phone = await browser.newPage();
  await associate(host, phone);
  await upload(phone, 'animaciones.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', readFileSync('tests/fixtures/animated.pptx'));
  await expect(phone.locator('.animation-control')).toContainText('Avance 0 /');
  await phone.getByRole('button', { name: 'Página siguiente' }).click();
  await expect(phone.locator('.animation-control')).toContainText('Avance 1 /');
  await expect(phone.getByRole('spinbutton', { name: 'Ir a página' })).toHaveValue('1');
  await phone.getByLabel('Vista estática').click();
  await expect(phone.getByLabel('Vista estática')).toBeChecked();
  await upload(phone, 'imagenes.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', readFileSync('tests/fixtures/embedded.pptx'));
  // The first image in this fixture is an external URL and must have its source removed.
  expect(await host.locator('.ppt-slide image').first().getAttribute('href')).toBeNull();
  const image = host.locator('.ppt-slide image').nth(1);
  await expect(image).toBeVisible();
  const source = await image.getAttribute('href') || await image.getAttribute('xlink:href');
  expect(source).toMatch(/^blob:/);
  expect(await host.evaluate(async (url) => { const response = await fetch(url!); return (await response.blob()).size; }, source)).toBeGreaterThan(100);
  await host.close(); await phone.close();
});
