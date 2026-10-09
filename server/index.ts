import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { createBroker } from './broker.js';

const port = Number(process.env.PORT || 5173);
const production = process.env.NODE_ENV === 'production';
const publicUrl = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL)?.replace(/\/$/, '');
if (publicUrl && !/^https?:\/\/[^/]+$/.test(publicUrl)) throw new Error('PUBLIC_URL or RENDER_EXTERNAL_URL must be an HTTP(S) origin without a path.');
const app = express();
app.disable('x-powered-by');
app.use((_request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  if (production) response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data:; font-src 'self' blob: data:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'self'");
  next();
});
app.get('/api/config', (request, response) => {
  let origin = publicUrl;
  if (!origin) {
    const requestHost = request.headers.host || `localhost:${port}`;
    if (/^(localhost|127\.0\.0\.1)(:|$)/.test(requestHost)) {
      const addresses = Object.entries(networkInterfaces()).flatMap(([name, entries]) => (entries || []).filter((entry) => entry.family === 'IPv4' && !entry.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address)).map((entry) => ({ name, address: entry.address })));
      addresses.sort((a, b) => Number(/vEthernet|WSL|Virtual|VPN/i.test(a.name)) - Number(/vEthernet|WSL|Virtual|VPN/i.test(b.name)));
      origin = `http://${addresses[0]?.address || 'localhost'}:${port}`;
    } else origin = `${request.secure ? 'https' : 'http'}://${requestHost}`;
  }
  response.setHeader('Cache-Control', 'no-store');
  response.json({ publicUrl: origin, graceMs: Number(process.env.RECONNECT_GRACE_MS || 20000) });
});
app.get('/api/health', (_request, response) => { response.setHeader('Cache-Control', 'no-store'); response.json({ ok: true }); });
const httpServer = createServer(app);
createBroker(httpServer, { graceMs: Number(process.env.RECONNECT_GRACE_MS || 20000), publicOrigin: publicUrl });
if (production) {
  app.use(express.static(path.resolve('dist'), { index: false, maxAge: '1h' }));
  app.get('/{*path}', (_request, response) => { response.setHeader('Cache-Control', 'no-store'); response.sendFile(path.resolve('dist/index.html')); });
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server: httpServer }, allowedHosts: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
httpServer.listen(port, '0.0.0.0', () => { process.stdout.write(`Pronter listo en http://localhost:${port}\n`); });
