import { test, expect, chromium, type Page, type WebSocketRoute } from '@playwright/test';
import { pdfFixture, pptxFixture, svgFixture, wavFixture } from '../fixtures';
import { readFileSync, existsSync } from 'node:fs';
import { mkdirSync, openSync, closeSync, ftruncateSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { catalog, type Locale } from '../../shared/messages';

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

test('four languages and an accessible contextual tour preserve the paired content', async ({ browser }) => {
  const host = await browser.newPage(); const phone = await browser.newPage({ viewport: { width: 320, height: 812 }, isMobile: true, hasTouch: true });
  await associate(host, phone); await upload(phone, 'idiomas.svg', 'image/svg+xml', svgFixture());
  const original = await host.locator('.content-image img').getAttribute('src');
  for (const locale of ['es', 'en', 'pt', 'fr'] as Locale[]) {
    await phone.locator('.controller-header select').selectOption(locale);
    await expect(phone.locator('html')).toHaveAttribute('lang', locale === 'pt' ? 'pt-BR' : locale);
    await expect(phone.locator('.upload-button')).toBeEnabled(); await expect(phone.locator('.upload-button strong')).toHaveText(catalog.anotherFile[locale]);
    await phone.locator('input[type=file]').setInputFiles({ name: 'invalid.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('bad') });
    await expect(phone.getByRole('alert')).toContainText(catalog.fileFormat[locale]);
    await phone.getByRole('button', { name: catalog.help[locale], exact: true }).click();
    const guide = phone.getByRole('dialog'); await expect(guide).toBeVisible();
    await guide.getByRole('combobox', { name: catalog.guideIndex[locale] }).selectOption('7');
    await expect(guide.locator('h2')).toHaveText(catalog.guideMarker[locale]);
    await expect(guide).toContainText(catalog.guideUnavailable[locale]);
    await phone.keyboard.press('Escape'); await expect(guide).toHaveCount(0);
    await expect(phone.getByRole('button', { name: catalog.help[locale], exact: true })).toBeFocused();
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(host.locator('.content-image img')).toHaveAttribute('src', original!);
  }
  await phone.getByRole('button', { name: catalog.help.fr, exact: true }).click();
  await phone.getByRole('dialog').getByRole('combobox', { name: catalog.guideIndex.fr }).selectOption('2');
  await expect(phone.locator('.link-panel input')).toHaveClass(/guide-target/);
  const target = (await phone.locator('.link-panel input').boundingBox())!, panel = (await phone.getByRole('dialog').boundingBox())!;
  expect(target.y).toBeGreaterThanOrEqual(0); expect(target.y + target.height).toBeLessThan(panel.y);
  await phone.screenshot({ path: '.cache/pronter-guide-fr.png' });
  await phone.keyboard.press('Escape');
  await host.locator('.app-header select').selectOption('en');
  await expect(host.getByText('Phone connected', { exact: true })).toBeVisible();
  await expect(phone.getByText('Téléphone connecté', { exact: true })).toBeVisible();
  await phone.setViewportSize({ width: 812, height: 375 });
  await phone.getByRole('button', { name: catalog.help.fr, exact: true }).click();
  const rect = (await phone.getByRole('dialog').boundingBox())!; expect(rect.y).toBeGreaterThanOrEqual(0); expect(rect.y + rect.height).toBeLessThanOrEqual(375);
  await phone.keyboard.press('Escape');
  await upload(phone, 'traduccion.md', 'text/markdown', Buffer.from('![](https://remote.example/picture.jpg)'));
  await expect(host.locator('.missing-image')).toHaveText(catalog.externalImage.en);
  await host.locator('.app-header select').selectOption('fr'); await expect(host.locator('.missing-image')).toHaveText(catalog.externalImage.fr);
  await host.locator('.app-header select').selectOption('en');
  await phone.getByRole('button', { name: catalog.exit.fr, exact: true }).click();
  await expect(host.locator('.qr-paper > svg')).toBeVisible();
  const { default: jsQR } = await import('jsqr'), { PNG } = await import('pngjs'); const png = PNG.sync.read(await host.locator('.qr-paper').screenshot());
  const qr = new URL(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)!.data); expect(qr.searchParams.get('lang')).toBe('en');
  const second = await browser.newPage(); await second.goto(qr.pathname + qr.search + qr.hash);
  await expect(second.getByText('Phone connected', { exact: true })).toBeVisible(); expect(new URL(second.url()).searchParams.get('lang')).toBe('en');
  await second.getByRole('button', { name: 'Exit', exact: true }).click();
  await host.close(); await phone.close(); await second.close();
});

test('oversized native files are rejected before reading and a valid 100 MB video stays responsive', async ({ browser }) => {
  test.setTimeout(180000); mkdirSync('.cache', { recursive: true });
  const tooLarge = resolve('.cache/oversized-300.mp4'); const fd = openSync(tooLarge, 'w'); ftruncateSync(fd, 300_000_000); closeSync(fd);
  const nearLimit = resolve('.cache/near-limit-100.mp4'), sample = readFileSync('tests/fixtures/sample.mp4');
  const large = openSync(nearLimit, 'w'); writeSync(large, sample); const box = Buffer.alloc(8); box.writeUInt32BE(100_000_000 - sample.length); box.write('free', 4); writeSync(large, box); ftruncateSync(large, 100_000_000); closeSync(large);
  const host = await browser.newPage(); const phone = await browser.newPage();
  await associate(host, phone); await upload(phone, 'anterior.svg', 'image/svg+xml', svgFixture());
  await phone.locator('.controller-header select').selectOption('en');
  await phone.evaluate(() => { const slice = File.prototype.slice; (window as unknown as Record<string, number>).oversizeReads = 0; File.prototype.slice = function (...args) { if (this.name === 'oversized-300.mp4') { (window as unknown as Record<string, number>).oversizeReads++; } return slice.apply(this, args); }; });
  await phone.locator('input[type=file]').setInputFiles(tooLarge);
  await expect(phone.getByRole('alert')).toContainText('100 MB');
  expect(await phone.evaluate(() => (window as unknown as Record<string, number>).oversizeReads)).toBe(0);
  await expect(phone.locator('.current-file strong')).toHaveText('anterior.svg');
  await phone.locator('input[type=file]').setInputFiles(nearLimit);
  await expect(phone.getByRole('button', { name: 'How to use', exact: true })).toBeEnabled();
  await expect(phone.locator('.current-file strong')).toHaveText('near-limit-100.mp4', { timeout: 120000 });
  await expect(host.locator('video')).toBeVisible();
  await host.getByRole('button', { name: 'Activar audio' }).click();
  await expect(phone.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await phone.getByRole('button', { name: 'Pause', exact: true }).click();
  await phone.locator('.controller-header select').selectOption('es');
  await upload(phone, 'despues.svg', 'image/svg+xml', svgFixture());
  await expect(host.locator('.viewer-layer')).toHaveCount(1); await expect(host.locator('video')).toHaveCount(0);
  await phone.getByRole('button', { name: 'Salir', exact: true }).click(); await host.close(); await phone.close();
});

test('YouTube and Vimeo adapters relay media controls and web links offer an honest external fallback', async ({ browser }) => {
  test.setTimeout(90000);
  const host = await browser.newPage(), phone = await browser.newPage();
  const frameHtml = '<!doctype html><p id="state">paused</p><script>addEventListener("message",e=>{if(typeof e.data==="string")document.getElementById("state").textContent=e.data});</script>';
  await host.route('https://www.youtube-nocookie.com/embed/**', route => route.fulfill({ contentType: 'text/html', body: frameHtml }));
  await host.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'application/javascript', body: `window.YT={Player:class {constructor(el,o){this.el=el;this.time=0;this.volume=100;this.rate=1;this.state=2;el.addEventListener('load',()=>o.events.onReady());}playVideo(){this.state=1;this.el.contentWindow.postMessage('playing','*');}pauseVideo(){this.state=2;this.el.contentWindow.postMessage('paused','*');}getCurrentTime(){return this.time;}getDuration(){return 60;}isMuted(){return !!this.muted;}mute(){this.muted=true;}unMute(){this.muted=false;}getVolume(){return this.volume;}getPlaybackRate(){return this.rate;}getAvailablePlaybackRates(){return [0.5,1,1.5,2];}getPlayerState(){return this.state;}setVolume(v){this.volume=v;}seekTo(t){this.time=t;}setPlaybackRate(r){this.rate=r;}destroy(){this.el.remove();}}};window.onYouTubeIframeAPIReady();` }));
  await host.route('https://player.vimeo.com/video/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><p id="state">paused</p><script>let s={getDuration:60,getCurrentTime:0,getPaused:true,getVolume:1,getPlaybackRate:1};addEventListener('message',e=>{let d=typeof e.data==='string'?JSON.parse(e.data):e.data;if(!d.method)return;if(d.method==='play'){s.getPaused=false;document.getElementById('state').textContent='playing';}if(d.method==='pause'){s.getPaused=true;document.getElementById('state').textContent='paused';}if(d.method==='setCurrentTime')s.getCurrentTime=d.value;if(d.method==='setVolume')s.getVolume=d.value;if(d.method==='setPlaybackRate')s.getPlaybackRate=d.value;e.source.postMessage({method:d.method,value:s[d.method]??d.value??true},e.origin)});parent.postMessage({event:'ready'},'*');</script>` }));
  await host.context().route('https://blocked.example/**', route => route.fulfill({ contentType: 'text/html', headers: { 'X-Frame-Options': 'DENY' }, body: '<h1>Blocked embed</h1>' }));
  await associate(host, phone);
  const sendLink = async (url: string) => { await phone.getByLabel('Enlace para mostrar').fill(url); await phone.getByRole('button', { name: 'Mostrar enlace', exact: true }).click(); await expect(phone.locator('.current-file strong')).toContainText(url.includes('youtu.be') ? 'YouTube' : url.includes('vimeo.com') ? 'Vimeo' : 'blocked.example'); await expect(phone.locator('.source-progress')).toHaveCount(0); };
  for (const url of ['https://youtu.be/M7lc1UVf-VE', 'https://vimeo.com/76979871']) {
    await sendLink(url); await expect(phone.locator('.media-controls')).toBeVisible();
    await phone.getByRole('button', { name: 'Reproducir', exact: true }).click();
    await expect(host.frameLocator('.content-link iframe').locator('#state')).toHaveText('playing');
    await phone.getByRole('button', { name: 'Pausar', exact: true }).click();
    await expect(host.frameLocator('.content-link iframe').locator('#state')).toHaveText('paused');
    await phone.getByLabel('Velocidad de reproducción').selectOption('1.5');
    await expect(phone.getByLabel('Velocidad de reproducción')).toHaveValue('1.5');
    await expect(phone.locator('.marker-pad')).toHaveCount(0);
  }
  await host.frameLocator('.content-link iframe').locator('body').evaluate(() => parent.postMessage({ event: 'error', data: { method: 'play', name: 'PrivacyError', message: 'Playback denied' } }, '*'));
  await expect(phone.locator('.media-controls')).toHaveCount(0);
  await expect(phone.getByRole('status').filter({ hasText: 'no permite incrustarse' })).toBeVisible();
  await sendLink('https://blocked.example/page'); await expect(phone.locator('.media-controls')).toHaveCount(0);
  await expect(phone.locator('.external-actions')).toContainText('Pronter no controla esa pestaña');
  const popup = host.waitForEvent('popup'); await host.getByRole('link', { name: 'Abrir fuera', exact: true }).click(); const external = await popup; await expect(external.locator('h1')).toHaveText('Blocked embed'); await external.close();
  await upload(phone, 'volver.svg', 'image/svg+xml', svgFixture()); await expect(host.locator('.content-link iframe')).toHaveCount(0);
  await expect(phone.locator('.external-actions')).toHaveCount(0); await phone.getByRole('button', { name: 'Salir', exact: true }).click(); await host.close(); await phone.close();
});

test('direct media links can be controlled and cancelling a stalled link preserves the playing file', async ({ browser }) => {
  const host = await browser.newPage(), phone = await browser.newPage();
  await host.route('https://media.example/sample.mp4', route => route.fulfill({ contentType: 'video/mp4', body: readFileSync('tests/fixtures/sample.mp4') }));
  await host.route('https://media.example/stall.mp4', () => {});
  await associate(host, phone);
  await upload(phone, 'mantener.mp4', 'video/mp4', readFileSync('tests/fixtures/sample.mp4'));
  await host.getByRole('button', { name: 'Activar audio' }).click();
  await expect(phone.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible();
  await phone.getByLabel('Enlace para mostrar').fill('https://media.example/stall.mp4');
  await phone.getByRole('button', { name: 'Mostrar enlace', exact: true }).click();
  await expect(phone.locator('.source-progress')).toBeVisible();
  await expect(phone.locator('.source-progress')).toContainText('media.example');
  await phone.locator('.source-progress').getByRole('button', { name: 'Cancelar envío', exact: true }).click();
  await expect(phone.locator('.source-progress')).toHaveCount(0);
  await expect(phone.locator('.current-file strong')).toHaveText('mantener.mp4');
  await expect(host.locator('.viewer-layer')).toHaveCount(1);
  await expect(phone.locator('.media-controls button').first()).toBeEnabled();
  await phone.getByLabel('Enlace para mostrar').fill('https://media.example/sample.mp4');
  await phone.getByRole('button', { name: 'Mostrar enlace', exact: true }).click();
  await expect(phone.locator('.current-file strong')).toHaveText('Video · media.example');
  await expect(host.locator('video')).toHaveCount(1);
  await host.getByRole('button', { name: 'Activar audio' }).click();
  await expect(phone.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible();
  await phone.getByRole('button', { name: 'Pausar', exact: true }).click();
  await expect.poll(() => host.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(true);
  await phone.getByLabel('Velocidad de reproducción').selectOption('1.5');
  await expect.poll(() => host.locator('video').evaluate((video: HTMLVideoElement) => video.playbackRate)).toBe(1.5);
  await upload(phone, 'despues-del-link.svg', 'image/svg+xml', svgFixture());
  await expect(host.locator('video')).toHaveCount(0); await expect(phone.locator('.external-actions')).toHaveCount(0);
  await phone.getByRole('button', { name: 'Salir', exact: true }).click(); await host.close(); await phone.close();
});

test('a normal cross-origin website cannot be scrolled remotely even when it permits CORS', async ({ browser }) => {
  const host = await browser.newPage(), phone = await browser.newPage();
  await host.route('https://website.example/**', route => route.fulfill({ contentType: 'text/html', headers: { 'Access-Control-Allow-Origin': '*' }, body: '<!doctype html><meta charset="utf-8"><button onclick="window.scrollBy(0,400)">Desplazar aquí</button><div style="height:4000px">Página externa</div>' }));
  await associate(host, phone);
  await phone.getByLabel('Enlace para mostrar').fill('https://website.example/article'); await phone.getByRole('button', { name: 'Mostrar enlace', exact: true }).click();
  await expect(phone.locator('.current-file strong')).toHaveText('website.example');
  await expect(host.getByText('Navegación en el PC', { exact: true })).toBeVisible();
  await expect(host.frameLocator('.content-link iframe').getByText('Página externa', { exact: true })).toBeVisible();
  const blocked = await host.evaluate(() => {
    try { document.querySelector<HTMLIFrameElement>('.content-link iframe')!.contentWindow!.scrollBy(0,400); return ''; }
    catch (error) { return (error as DOMException).name; }
  });
  expect(blocked).toBe('SecurityError');
  await expect(phone.locator('.scroll-controls')).toHaveCount(0);
  await expect(phone.locator('.external-actions')).toContainText('el PC necesita una extensión');
  await host.frameLocator('.content-link iframe').getByRole('button', { name: 'Desplazar aquí' }).click();
  await expect.poll(() => host.frameLocator('.content-link iframe').locator('body').evaluate(() => scrollY)).toBe(400);
  await phone.locator('.controller-header select').selectOption('en');
  await expect(phone.locator('.external-actions')).toContainText('the computer needs an extension');
  await phone.getByRole('button', { name: 'Exit', exact: true }).click(); await host.close(); await phone.close();
});

test('real YouTube embed loads and accepts remote playback controls', async ({ browser }) => {
  test.setTimeout(90000);
  const host = await browser.newPage(), phone = await browser.newPage(); await associate(host, phone);
  await phone.getByLabel('Enlace para mostrar').fill('https://www.youtube.com/watch?v=M7lc1UVf-VE'); await phone.getByRole('button', { name: 'Mostrar enlace', exact: true }).click();
  await expect(phone.locator('.current-file strong')).toContainText('YouTube', { timeout: 20000 });
  await expect(phone.locator('.media-controls')).toBeVisible();
  await host.getByRole('button', { name: 'Activar audio' }).click();
  await expect(phone.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible();
  await phone.getByRole('button', { name: 'Pausar', exact: true }).click();
  await expect(phone.getByRole('button', { name: 'Reproducir', exact: true })).toBeVisible();
  await expect(host.locator('.content-link iframe')).toHaveCount(1);
  await phone.getByRole('button', { name: 'Salir', exact: true }).click(); await host.close(); await phone.close();
});

test('first YouTube playback starts from the phone before any host interaction', async ({ baseURL }) => {
  test.setTimeout(90000);
  const browser = await chromium.launch({ args: ['--autoplay-policy=document-user-activation-required', '--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplay'] });
  try {
    const host = await browser.newPage({ baseURL, locale: 'es-CO' }), phone = await browser.newPage({ baseURL, locale: 'es-CO', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    // Playwright's DOM evaluations can grant user activation. Read the pairing
    // token from the real socket instead of touching the host DOM in this case.
    const paired = new Promise<string>((resolve) => host.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string' || !payload.startsWith('43/control,')) return;
      const token = JSON.parse(payload.slice(payload.indexOf('[')))[0]?.data?.token;
      if (token) resolve(token);
    })));
    await host.goto('/'); await phone.goto(`/control#${await paired}`);
    await expect(phone.getByText('Celular conectado', { exact: true })).toBeVisible();
    const cdp = await host.context().newCDPSession(host);
    const activation = await cdp.send('Runtime.evaluate', { expression: 'navigator.userActivation.hasBeenActive', userGesture: false, returnByValue: true });
    expect(activation.result.value).toBe(false);
    await phone.getByLabel('Enlace para mostrar').fill('https://youtu.be/M7lc1UVf-VE?si=android-share');
    await phone.getByRole('button', { name: 'Mostrar enlace', exact: true }).click();
    await expect(phone.locator('.current-file strong')).toContainText('YouTube', { timeout: 20000 });
    await phone.getByRole('button', { name: 'Reproducir', exact: true }).click();
    await expect(phone.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible();
    await expect(phone.getByRole('slider', { name: 'Volumen', exact: true })).toHaveValue('0');
    await expect(phone.getByRole('status').filter({ hasText: 'Se inicia sin sonido' })).toBeVisible();
    await phone.getByRole('button', { name: 'Pausar', exact: true }).click();
    await expect(phone.getByRole('button', { name: 'Reproducir', exact: true })).toBeVisible();
    await phone.getByRole('button', { name: 'Reproducir', exact: true }).click();
    await expect(phone.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible();
    await host.getByRole('button', { name: 'Activar audio', exact: true }).click();
    await expect(phone.getByRole('slider', { name: 'Volumen', exact: true })).toHaveValue('1');
    await expect(phone.locator('.activation-hint')).toHaveCount(0);
    await upload(phone, 'despues-de-youtube.svg', 'image/svg+xml', svgFixture());
    await expect(host.locator('.content-link iframe')).toHaveCount(0);
    await phone.getByRole('button', { name: 'Salir', exact: true }).click();
  } finally { await browser.close(); }
});

test('real Vimeo response either permits playback or reports provider refusal and allows recovery', async ({ browser }, testInfo) => {
  test.setTimeout(60000);
  const host = await browser.newPage(), phone = await browser.newPage(); await associate(host, phone);
  await upload(phone, 'conservar.svg', 'image/svg+xml', svgFixture());
  const url = 'https://vimeo.com/76979871/8272103f6e';
  await phone.getByLabel('Enlace para mostrar').fill(url); await phone.getByRole('button', { name: 'Mostrar enlace', exact: true }).click();
  await expect(phone.locator('.source-progress')).toHaveCount(0, { timeout: 20000 });
  const refusal = phone.getByRole('status').filter({ hasText: catalog.embedUnavailable.es });
  await expect.poll(async () => await refusal.count() || (await phone.locator('.current-file strong').textContent() === 'Vimeo · vimeo.com' ? 1 : 0)).toBe(1);
  if (await phone.locator('.current-file strong').textContent() === 'Vimeo · vimeo.com' && await phone.locator('.media-controls').count()) {
    await host.getByRole('button', { name: 'Activar audio' }).click();
    await expect.poll(async () => await refusal.count() || await phone.getByRole('button', { name: 'Pausar', exact: true }).count()).toBe(1);
    if (!await refusal.count()) {
      await phone.getByRole('button', { name: 'Pausar', exact: true }).click(); await expect(phone.getByRole('button', { name: 'Reproducir', exact: true })).toBeVisible();
      testInfo.annotations.push({ type: 'provider', description: 'Vimeo real playback and remote pause passed.' });
    }
  }
  if (await refusal.count()) {
    await expect(refusal).toBeVisible(); await expect(phone.locator('.media-controls')).toHaveCount(0);
    await expect(host.getByRole('link', { name: 'Abrir fuera', exact: true })).toHaveAttribute('href', url);
    testInfo.annotations.push({ type: 'provider', description: 'Vimeo refused playback; failure, external fallback and recovery passed. Actual Vimeo playback remains unverified.' });
  } else await expect(phone.locator('.current-file strong')).toHaveText('Vimeo · vimeo.com');
  await upload(phone, 'recuperado.svg', 'image/svg+xml', svgFixture());
  await expect(host.locator('.viewer-layer')).toHaveCount(1); await expect(host.locator('iframe')).toHaveCount(0);
  await expect(refusal).toHaveCount(0);
  await testInfo.attach('provider-result', { body: Buffer.from(JSON.stringify(testInfo.annotations)), contentType: 'application/json' });
  await phone.getByRole('button', { name: 'Salir', exact: true }).click(); await host.close(); await phone.close();
});

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
  // Include the stale-transport probe and internet round trips, while staying
  // below the 20-second stalled handshake/reservation this regression exposes.
  await expect(phone.getByText('Celular conectado', { exact: true })).toBeVisible({ timeout: 10000 });
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
  await host.getByRole('button', { name: 'Activar pantalla completa', exact: true }).click();
  await expect(host.locator('.host-app')).toHaveClass(/is-expanded/);
  await host.getByRole('button', { name: 'Cerrar aviso', exact: true }).click();
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
  // A host gesture must wait for the preceding remote transition. Delay its
  // layout callback so an old confirmation cannot overwrite a new native mode.
  await host.evaluate(() => {
    const raf = window.requestAnimationFrame;
    (window as unknown as Record<string, () => void>).restoreDisplayFrame = () => { window.requestAnimationFrame = raf; };
    window.requestAnimationFrame = (callback) => raf(time => { setTimeout(() => callback(time), 500); });
  });
  await phone.getByRole('button', { name: 'Salir de pantalla completa del PC', exact: true }).click();
  await expect(host.locator('.host-app')).not.toHaveClass(/is-expanded/);
  await expect(host.locator('.fullscreen-button')).toBeDisabled();
  // Exiting genuine native fullscreen also works from the phone.
  await host.getByRole('button', { name: 'Pantalla completa', exact: true }).click();
  await host.evaluate(() => { ((window as unknown as Record<string, () => void>).restoreDisplayFrame)(); });
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
