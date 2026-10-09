import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { io, type Socket } from 'socket.io-client';
import { createBroker } from '../server/broker';
import { CHUNK_BYTES, MAX_FILE_BYTES, MAX_PREVIEW_BYTES, emptyViewer, type Credentials, type Reply } from '../shared/protocol';

let broker: ReturnType<typeof createBroker>;
let url: string;
let sockets: Socket[];
async function socket(namespace: string, auth?: Credentials) {
  const client = io(`${url}/${namespace}`, { transports: ['websocket'], forceNew: true, autoConnect: false, reconnection: false, auth });
  sockets.push(client);
  await new Promise<void>((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); client.connect(); });
  return client;
}
const call = <T = unknown>(client: Socket, event: string, ...args: unknown[]): Promise<Reply<T>> => client.timeout(2000).emitWithAck(event, ...args);
function event(client: Socket, name: string) { return new Promise<any>((resolve) => client.once(name, resolve)); }
async function pair() {
  const host = await socket('control');
  const hostInfo = (await call<Credentials & { token: string }>(host, 'pair:create')).data!;
  const controller = await socket('control');
  const controllerInfo = (await call<Credentials>(controller, 'pair:join', hostInfo.token)).data!;
  return { host, controller, hostInfo, controllerInfo };
}
beforeEach(async () => {
  sockets = [];
  const server = createServer();
  broker = createBroker(server, { graceMs: 150, pickerGraceMs: 500 });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => { for (const client of sockets) client.disconnect(); await broker.close(); });

describe('volatile pairing broker', () => {
  it('permits only the admitted phone to control the host display before a file is loaded', async () => {
    const { host, controller } = await pair();
    host.on('display:command', (value, ack) => { expect(value).toBe(true); ack({ ok: true }); });
    expect((await call(controller, 'display:command', true)).ok).toBe(true);
    const other = await socket('control');
    expect((await call(other, 'display:command', true)).code).toBe('OFFLINE');
    expect((await call(controller, 'display:command', 'yes')).code).toBe('OFFLINE');
    const received = event(controller, 'display:state');
    host.emit('display:state', { expanded: true, native: false, needsClick: true });
    expect(await received).toEqual({ expanded: true, native: false, needsClick: true });
  });
  it('bounds and authenticates reverse preview frames without storing images on the broker', async () => {
    const { host, controller, hostInfo, controllerInfo } = await pair();
    const received = event(controller, 'viewer:state'); host.emit('viewer:state', { ...emptyViewer(), assetId: 'asset' }); await received;
    const hostData = await socket('transfer', hostInfo), phoneData = await socket('transfer', controllerInfo);
    const meta = { assetId: 'asset', page: 1, zoom: 1, viewId: 'view', sequence: 1, width: 800, height: 450 };
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    let frames = 0;
    phoneData.on('preview:frame', (view, image, ack) => { frames++; expect(view).toEqual(meta); expect(image).toEqual(bytes); ack({ ok: true }); });
    expect((await call(phoneData, 'preview:frame', meta, bytes)).code).toBe('OFFLINE');
    expect((await call(hostData, 'preview:frame', { ...meta, assetId: 'old' }, bytes)).code).toBe('INVALID_PREVIEW');
    expect((await call(hostData, 'preview:frame', meta, Buffer.alloc(MAX_PREVIEW_BYTES + 1))).code).toBe('INVALID_PREVIEW');
    expect((await call(hostData, 'preview:frame', meta, bytes)).ok).toBe(true);
    expect((await call(hostData, 'preview:frame', meta, bytes)).code).toBe('PREVIEW_BUSY');
    expect(frames).toBe(1);
  });
  it('relays drawing only from the admitted phone and only for the visible asset and page', async () => {
    const { host, controller, hostInfo } = await pair();
    const viewer = { ...emptyViewer(), assetId: 'asset', kind: 'pdf' as const, pages: 2, capabilities: ['draw' as const] };
    const receivedState = event(controller, 'viewer:state'); host.emit('viewer:state', viewer); await receivedState;
    let calls = 0;
    host.on('viewer:ink', (_command, ack) => { calls++; ack({ ok: true }); });
    const stroke = { id: 'begin', assetId: 'asset', page: 1, type: 'begin', strokeId: 'stroke', color: 'coral', width: 0.006, point: { x: 0.5, y: 0.5 } };
    expect((await call(controller, 'viewer:ink', stroke)).ok).toBe(true);
    expect((await call(controller, 'viewer:ink', { ...stroke, page: 2 })).code).toBe('STALE_CONTENT');
    expect((await call(controller, 'viewer:ink', { ...stroke, assetId: 'old' })).code).toBe('STALE_CONTENT');
    expect((await call(controller, 'viewer:ink', { ...stroke, point: { x: Infinity, y: 0 } })).code).toBe('INVALID_INK');
    const other = await socket('control');
    expect((await call(other, 'pair:join', hostInfo.token)).code).toBe('OCCUPIED');
    expect((await call(other, 'viewer:ink', stroke)).code).toBe('OFFLINE');
    const blackState = event(controller, 'viewer:state'); host.emit('viewer:state', { ...viewer, black: true }); await blackState;
    expect((await call(controller, 'viewer:ink', stroke)).code).toBe('STALE_CONTENT');
    expect(calls).toBe(1);
  });
  it('admits only the first of two simultaneous claims', async () => {
    const host = await socket('control');
    const info = (await call<Credentials & { token: string }>(host, 'pair:create')).data!;
    const first = await socket('control'); const second = await socket('control');
    const replies = await Promise.all([call(first, 'pair:join', info.token), call(second, 'pair:join', info.token)]);
    expect(replies.filter((reply) => reply.ok)).toHaveLength(1);
    expect(replies.find((reply) => !reply.ok)?.code).toBe('OCCUPIED');
    expect(broker.pairCount).toBe(1);
  });
  it('rejects controller recovery without a private credential on an unclaimed host', async () => {
    const host = await socket('control');
    const info = (await call<Credentials & { token: string }>(host, 'pair:create')).data!;
    const other = await socket('control');
    expect((await call(other, 'pair:resume', { id: info.id, role: 'controller' })).code).toBe('EXPIRED');
  });
  it('permits recovery with the private credential, rejects duplicate active recovery', async () => {
    const { controller, controllerInfo } = await pair();
    const other = await socket('control');
    expect((await call(other, 'pair:resume', controllerInfo)).code).toBe('OCCUPIED');
    controller.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((await call(other, 'pair:resume', controllerInfo)).ok).toBe(true);
  });
  it('keeps the first controller reserved while choosing a file beyond normal disconnect grace', async () => {
    const { host, controller, hostInfo, controllerInfo } = await pair();
    controller.emit('pair:picker', true);
    await call(controller, 'pair:ready');
    const disconnected = event(host, 'pair:presence'); controller.disconnect();
    expect((await disconnected).selectingFile).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 230));
    expect(broker.pairCount).toBe(1);
    const other = await socket('control');
    expect((await call(other, 'pair:join', hostInfo.token)).code).toBe('OCCUPIED');
    expect((await call(other, 'pair:resume', controllerInfo)).ok).toBe(true);
    expect((await call(other, 'pair:end')).ok).toBe(true);
    expect(broker.pairCount).toBe(0);
  });
  it('expires an abandoned picker reservation and revokes the private credential', async () => {
    const { host, controller, controllerInfo } = await pair();
    controller.emit('pair:picker', true); await call(controller, 'pair:ready');
    const ended = event(host, 'pair:ended'); controller.disconnect();
    await ended; expect(broker.pairCount).toBe(0);
    const other = await socket('control');
    expect((await call(other, 'pair:resume', controllerInfo)).code).toBe('EXPIRED');
  });
  it('allows only private-credential takeover of a stale transport during a picker reservation', async () => {
    const { controller, controllerInfo, hostInfo } = await pair();
    controller.emit('pair:picker', true); await call(controller, 'pair:ready');
    const other = await socket('control');
    expect((await call(other, 'pair:join', hostInfo.token)).code).toBe('OCCUPIED');
    expect((await call(other, 'pair:resume', { ...controllerInfo, key: 'forged' })).code).toBe('EXPIRED');
    const disconnected = event(controller, 'disconnect');
    expect((await call(other, 'pair:resume', controllerInfo)).ok).toBe(true);
    await disconnected; expect(controller.connected).toBe(false);
    expect((await call(other, 'pair:resume', controllerInfo)).ok).toBe(true);
    expect(broker.pairCount).toBe(1);
  });
  it('reports readiness only when both file channels are usable and recovers an idle channel without cancelling content', async () => {
    const { controller, hostInfo, controllerInfo } = await pair();
    expect((await call(controller, 'pair:ready')).data).toBe(false);
    const receiver = await socket('transfer', hostInfo);
    expect((await call(controller, 'pair:ready')).data).toBe(false);
    const sender = await socket('transfer', controllerInfo);
    expect((await call(controller, 'pair:ready')).data).toBe(true);
    let cancels = 0; sender.on('transfer:cancel', () => cancels++);
    const unavailable = event(controller, 'transfer:availability'); receiver.disconnect();
    expect(await unavailable).toBe(false);
    expect((await call(controller, 'pair:ready')).data).toBe(false);
    await socket('transfer', hostInfo);
    expect((await call(controller, 'pair:ready')).data).toBe(true); expect(cancels).toBe(0);
  });
  it('closes expired associations and rejects the previous QR', async () => {
    const { host, controller, hostInfo } = await pair();
    const ended = event(host, 'pair:ended'); controller.disconnect();
    await ended; expect(broker.pairCount).toBe(0);
    const next = await socket('control');
    expect((await call(next, 'pair:join', hostInfo.token)).ok).toBe(false);
  });
  it('ends explicitly, revokes both credentials and erases the association', async () => {
    const { host, controller, controllerInfo } = await pair();
    const ended = event(host, 'pair:ended');
    expect((await call(controller, 'pair:end')).ok).toBe(true);
    expect(await ended).toBe('Sesión terminada'); expect(broker.pairCount).toBe(0);
    const next = await socket('control'); expect((await call(next, 'pair:resume', controllerInfo)).code).toBe('EXPIRED');
  });
  it('relays exact binary data and rejects incomplete end and out-of-order chunks', async () => {
    const { hostInfo, controllerInfo } = await pair();
    const receiver = await socket('transfer', hostInfo); const sender = await socket('transfer', controllerInfo);
    let received = Buffer.alloc(0);
    receiver.on('transfer:begin', (_meta, ack) => ack({ ok: true }));
    receiver.on('transfer:chunk', (_id, _index, bytes, ack) => { received = Buffer.concat([received, bytes]); ack({ ok: true }); });
    const meta = { id: 'image', name: 'image.png', size: CHUNK_BYTES + 7, type: 'image/png', kind: 'image' };
    expect((await call(sender, 'transfer:begin', meta)).ok).toBe(true);
    expect((await call(sender, 'transfer:end', meta.id)).code).toBe('INCOMPLETE');
    expect((await call(sender, 'transfer:chunk', meta.id, 1, Buffer.alloc(7))).code).toBe('INVALID_CHUNK');
    const first = Buffer.alloc(CHUNK_BYTES, 42); const last = Buffer.from('Pronter');
    expect((await call(sender, 'transfer:chunk', meta.id, 0, first)).ok).toBe(true);
    expect((await call(sender, 'transfer:chunk', meta.id, 0, first)).ok).toBe(true);
    expect((await call(sender, 'transfer:chunk', meta.id, 1, last)).ok).toBe(true);
    expect((await call(sender, 'transfer:end', meta.id)).ok).toBe(true);
    expect(received.equals(Buffer.concat([first, last]))).toBe(true);
  });
  it('rejects stale commands and unauthorized controllers', async () => {
    const { host, controller } = await pair();
    host.emit('viewer:state', { ...emptyViewer(), assetId: 'current' });
    await event(controller, 'viewer:state');
    const command = { id: 'next', assetId: 'old', type: 'next' };
    expect((await call(controller, 'viewer:command', command)).code).toBe('STALE_CONTENT');
    const stranger = await socket('control'); expect((await call(stranger, 'viewer:command', command)).code).toBe('OFFLINE');
    const receive = event(host, 'viewer:command'); host.once('viewer:command', (_command, ack) => ack({ ok: true }));
    expect((await call(controller, 'viewer:command', { ...command, assetId: 'current' })).ok).toBe(true);
    expect((await receive).assetId).toBe('current');
  });
  it('rejects forged file-channel credentials', async () => {
    const { controllerInfo } = await pair();
    await expect(socket('transfer', { ...controllerInfo, key: 'forged' })).rejects.toThrow();
  });
  it('streams 1 GB through bounded windows without retaining a complete file', async () => {
    const { hostInfo, controllerInfo } = await pair();
    const receiver = await socket('transfer', hostInfo); const sender = await socket('transfer', controllerInfo);
    let count = 0;
    receiver.on('transfer:begin', (_meta, ack) => ack({ ok: true }));
    receiver.on('transfer:chunk', (_id, _index, bytes, ack) => { count += bytes.length; ack({ ok: true }); });
    const meta = { id: 'large', name: 'large.mp4', size: MAX_FILE_BYTES, type: 'video/mp4', kind: 'video' };
    expect((await call(sender, 'transfer:begin', meta)).ok).toBe(true);
    const chunk = Buffer.alloc(CHUNK_BYTES, 7);
    let pending: Promise<Reply>[] = [];
    for (let offset = 0, index = 0; offset < MAX_FILE_BYTES; offset += CHUNK_BYTES, index++) {
      pending.push(call(sender, 'transfer:chunk', meta.id, index, chunk.subarray(0, Math.min(CHUNK_BYTES, MAX_FILE_BYTES - offset))));
      if (pending.length === 4) { for (const reply of await Promise.all(pending)) expect(reply.ok).toBe(true); pending = []; }
    }
    for (const reply of await Promise.all(pending)) expect(reply.ok).toBe(true);
    expect(count).toBe(MAX_FILE_BYTES); expect((await call(sender, 'transfer:end', meta.id)).ok).toBe(true);
  }, 120000);
});
