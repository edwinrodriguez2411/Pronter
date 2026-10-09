import { randomBytes, randomUUID } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { ACK_TIMEOUT_MS, CHUNK_BYTES, TRANSFER_WINDOW, FILE_PICKER_GRACE_MS, MAX_PREVIEW_BYTES, commandSchema, displaySchema, emptyViewer, fileMetaSchema, inkSchema, kindFromName, pointerSchema, previewFrameSchema, previewViewSchema, viewerSchema, type Ack, type Credentials, type FileMeta, type Role, type ViewerState } from '../shared/protocol.js';

interface Transfer { meta: FileMeta; next: number; bytes: number; pending: number; acknowledged: Set<number> }
interface Pair {
  id: string; token: string; hostKey: string; controllerKey?: string;
  host?: Socket; controller?: Socket; hostData?: Socket; controllerData?: Socket;
  hostTimer?: ReturnType<typeof setTimeout>; controllerTimer?: ReturnType<typeof setTimeout>;
  pickerUntil?: number; hostReconnectUntil?: number; controllerReconnectUntil?: number;
  recovery?: Socket;
  transfer?: Transfer; state: ViewerState; commands: Set<string>;
}
const key = () => randomBytes(32).toString('base64url');
const ok = (ack: unknown, data?: unknown) => { if (typeof ack === 'function') (ack as Ack)({ ok: true, data }); };
const fail = (ack: unknown, code: string, error: string) => { if (typeof ack === 'function') (ack as Ack)({ ok: false, code, error }); };

export function createBroker(httpServer: HttpServer, { graceMs = 20000, pickerGraceMs = FILE_PICKER_GRACE_MS, publicOrigin }: { graceMs?: number; pickerGraceMs?: number; publicOrigin?: string } = {}) {
  const io = new Server(httpServer, {
    transports: ['websocket'], maxHttpBufferSize: CHUNK_BYTES + 8192,
    perMessageDeflate: false, pingInterval: 25000, pingTimeout: 60000,
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      const expected = publicOrigin || `${request.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${request.headers.host}`;
      callback(null, !origin || origin === expected);
    },
  });
  const control = io.of('/control');
  const data = io.of('/transfer');
  const pairs = new Map<string, Pair>();
  const tokens = new Map<string, string>();
  const forSocket = (socket: Socket) => pairs.get(socket.data.pairId as string);
  const presence = (pair: Pair) => {
    const values = { selectingFile: !!pair.pickerUntil && pair.pickerUntil > Date.now(), reconnectUntil: Math.max(pair.hostReconnectUntil || 0, pair.controllerReconnectUntil || 0) || null };
    pair.host?.emit('pair:presence', values); pair.controller?.emit('pair:presence', values);
  };
  const availability = (pair: Pair) => {
    const ready = !!(pair.host?.connected && pair.controller?.connected && pair.hostData?.connected && pair.controllerData?.connected);
    pair.host?.emit('transfer:availability', ready); pair.controller?.emit('transfer:availability', ready);
  };
  const status = (pair: Pair) => {
    const value = pair.host?.connected && pair.controller?.connected ? 'connected' : pair.controllerKey ? 'reconnecting' : 'waiting';
    pair.host?.emit('pair:status', value);
    pair.controller?.emit('pair:status', value);
    presence(pair); availability(pair);
  };
  const cancel = (pair: Pair, reason: string) => {
    if (!pair.transfer) return;
    const transferId = pair.transfer?.meta.id;
    pair.transfer = undefined;
    pair.hostData?.emit('transfer:cancel', { id: transferId, reason });
    pair.controllerData?.emit('transfer:cancel', { id: transferId, reason });
  };
  const end = (pair: Pair, reason: string) => {
    if (!pairs.has(pair.id)) return;
    pairs.delete(pair.id);
    tokens.delete(pair.token);
    clearTimeout(pair.hostTimer);
    clearTimeout(pair.controllerTimer);
    cancel(pair, reason);
    for (const socket of [pair.host, pair.controller, pair.hostData, pair.controllerData]) {
      socket?.emit('pair:ended', reason);
      if (socket) setTimeout(() => socket.disconnect(true), 50).unref();
    }
  };
  const bind = (socket: Socket, pair: Pair, role: Role) => {
    socket.data.pairId = pair.id;
    socket.data.role = role;
    if (role === 'host') { clearTimeout(pair.hostTimer); pair.hostTimer = undefined; pair.hostReconnectUntil = undefined; pair.host = socket; }
    else { clearTimeout(pair.controllerTimer); pair.controllerTimer = undefined; pair.controllerReconnectUntil = undefined; pair.controller = socket; }
  };

  control.on('connection', (socket) => {
    socket.on('pair:create', (ack: Ack) => {
      if (socket.data.pairId) {
        const existing = forSocket(socket);
        if (existing?.host === socket) return ok(ack, { id: existing.id, key: existing.hostKey, token: existing.token, role: 'host', connected: !!existing.controller?.connected });
        return fail(ack, 'ALREADY_BOUND', 'Esta conexión ya tiene una pantalla.');
      }
      if (pairs.size >= 1000) return fail(ack, 'CAPACITY', 'No hay capacidad disponible. Intenta de nuevo más tarde.');
      const pair: Pair = { id: randomUUID(), token: key(), hostKey: key(), state: emptyViewer(), commands: new Set() };
      pairs.set(pair.id, pair);
      tokens.set(pair.token, pair.id);
      bind(socket, pair, 'host');
      ok(ack, { id: pair.id, key: pair.hostKey, token: pair.token, role: 'host', connected: false });
    });
    socket.on('pair:join', (token: unknown, ack: Ack) => {
      if (socket.data.pairId) {
        const existing = forSocket(socket);
        if (existing?.controller === socket && token === existing.token) {
          ok(ack, { id: existing.id, key: existing.controllerKey, role: 'controller', connected: !!existing.host?.connected });
          socket.emit('viewer:state', existing.state); status(existing); return;
        }
        return fail(ack, 'ALREADY_BOUND', 'Este celular ya está conectado.');
      }
      if (typeof token !== 'string' || token.length > 100) return fail(ack, 'INVALID_QR', 'Este QR no es válido. Escanea el QR de la pantalla.');
      const pairId = tokens.get(token);
      const pair = pairId ? pairs.get(pairId) : undefined;
      // Claims are committed synchronously, before any asynchronous operation.
      if (!pair) return fail(ack, 'UNAVAILABLE', 'Este QR ya se usó o caducó. La pantalla puede tener otro celular conectado.');
      if (pair.controllerKey) return fail(ack, 'OCCUPIED', 'Esta pantalla ya tiene un celular conectado.');
      if (!pair.host?.connected) return fail(ack, 'HOST_OFFLINE', 'La pantalla está reconectando. Intenta de nuevo.');
      pair.controllerKey = key();
      // Keep the lookup until closure to explain rejection; controllerKey makes the token single-use.
      bind(socket, pair, 'controller');
      ok(ack, { id: pair.id, key: pair.controllerKey, role: 'controller', connected: true });
      socket.emit('viewer:state', pair.state);
      status(pair);
    });
    socket.on('pair:resume', async (credentials: Credentials, ack: Ack) => {
      const pair = credentials && pairs.get(credentials.id);
      const role = credentials?.role;
      if (!pair || !['host', 'controller'].includes(role) || typeof credentials.key !== 'string' || credentials.key !== (role === 'host' ? pair.hostKey : pair.controllerKey)) return fail(ack, 'EXPIRED', 'La asociación terminó. Escanea el nuevo QR.');
      const existing = role === 'host' ? pair.host : pair.controller;
      if (socket.data.pairId && existing !== socket) return fail(ack, 'ALREADY_BOUND', 'Esta conexión ya está asociada.');
      if (pair.recovery) return fail(ack, 'OCCUPIED', 'Se está recuperando la conexión anterior.');
      if (existing?.connected && existing !== socket) {
        const picker = role === 'controller' && !!pair.pickerUntil && pair.pickerUntil > Date.now();
        if (!picker) {
          // A proxy can keep the old server-side WebSocket open after the device
          // loses it. Probe it before refusing recovery by the same private key.
          pair.recovery = socket;
          const responsive = await new Promise<boolean>((resolve) => existing.timeout(1500).emit('pair:probe', (error: Error | null, reply: { ok: boolean }) => resolve(!error && reply?.ok === true)));
          if (pair.recovery === socket) pair.recovery = undefined;
          if (!socket.connected) return;
          if (pairs.get(pair.id) !== pair) return fail(ack, 'EXPIRED', 'La asociación terminó. Escanea el nuevo QR.');
          if (responsive || (role === 'host' ? pair.host : pair.controller) !== existing && (role === 'host' ? pair.host : pair.controller) !== undefined) return fail(ack, 'OCCUPIED', 'Este dispositivo ya tiene una conexión activa.');
        }
        // Invalid keys never reach this branch. Exactly one replacement is bound
        // before retiring the old socket, preserving QR admission exclusivity.
        cancel(pair, 'Se está recuperando el canal de archivos.');
        const oldData = role === 'host' ? pair.hostData : pair.controllerData;
        if (role === 'host') pair.hostData = undefined; else pair.controllerData = undefined;
        oldData?.disconnect(true);
      }
      bind(socket, pair, role);
      if (existing !== socket) existing?.disconnect(true);
      ok(ack, { ...credentials, token: role === 'host' && !pair.controllerKey ? pair.token : undefined, connected: !!pair.host?.connected && !!pair.controller?.connected });
      socket.emit('viewer:state', pair.state);
      status(pair);
    });
    socket.on('pair:ready', (ack: Ack) => {
      const pair = forSocket(socket);
      if (!pair || pair.controller !== socket && pair.host !== socket) return fail(ack, 'OFFLINE', 'La asociación está reconectando.');
      ok(ack, !!(pair.host?.connected && pair.controller?.connected && pair.hostData?.connected && pair.controllerData?.connected));
    });
    socket.on('pair:picker', (selecting: unknown) => {
      const pair = forSocket(socket);
      if (!pair || pair.controller !== socket || typeof selecting !== 'boolean') return;
      pair.pickerUntil = selecting ? Date.now() + pickerGraceMs : undefined;
      presence(pair);
    });
    socket.on('viewer:state', (raw: unknown) => {
      const pair = forSocket(socket);
      if (!pair || pair.host !== socket) return;
      const parsed = viewerSchema.safeParse(raw);
      if (!parsed.success) return;
      pair.state = parsed.data;
      pair.controller?.emit('viewer:state', pair.state);
    });
    socket.on('display:state', (raw: unknown) => {
      const pair = forSocket(socket); const parsed = displaySchema.safeParse(raw);
      if (pair?.host === socket && parsed.success) pair.controller?.emit('display:state', parsed.data);
    });
    socket.on('display:command', (expanded: unknown, ack: Ack) => {
      const pair = forSocket(socket);
      if (!pair || pair.controller !== socket || !pair.host?.connected || typeof expanded !== 'boolean') return fail(ack, 'OFFLINE', 'La pantalla no está conectada.');
      pair.host.timeout(5000).emit('display:command', expanded, (error: Error | null, reply: { ok: boolean }) => {
        if (error || !reply?.ok) fail(ack, 'DISPLAY_TIMEOUT', 'La pantalla no confirmó el cambio.'); else ok(ack);
      });
    });
    socket.on('preview:watch', (watch: unknown) => {
      const pair = forSocket(socket);
      if (pair?.controller === socket && typeof watch === 'boolean') pair.host?.emit('preview:watch', watch);
    });
    socket.on('preview:view', (raw: unknown) => {
      const pair = forSocket(socket); const parsed = previewViewSchema.safeParse(raw);
      if (pair?.host === socket && parsed.success && parsed.data.assetId === pair.state.assetId) pair.controller?.emit('preview:view', parsed.data);
    });
    socket.on('viewer:command', (raw: unknown, ack: Ack) => {
      const pair = forSocket(socket);
      if (!pair || pair.controller !== socket || !pair.host?.connected) return fail(ack, 'OFFLINE', 'La pantalla no está conectada.');
      const parsed = commandSchema.safeParse(raw);
      if (!parsed.success) return fail(ack, 'INVALID_COMMAND', 'El control recibido no es válido.');
      const command = parsed.data;
      if (command.assetId !== pair.state.assetId) return fail(ack, 'STALE_CONTENT', 'El contenido cambió. Vuelve a usar el control.');
      if (pair.commands.has(command.id)) return ok(ack);
      pair.host.timeout(5000).emit('viewer:command', command, (error: Error | null, reply: { ok: boolean; error?: string }) => {
        if (error) return fail(ack, 'COMMAND_TIMEOUT', 'La pantalla no respondió. Intenta de nuevo.');
        if (!reply?.ok) return fail(ack, 'COMMAND_FAILED', reply?.error || 'No se pudo aplicar el control.');
        pair.commands.add(command.id);
        if (pair.commands.size > 128) pair.commands.delete(pair.commands.values().next().value!);
        ok(ack);
      });
    });
    socket.on('viewer:pointer', (raw: unknown) => {
      const pair = forSocket(socket);
      if (!pair || pair.controller !== socket || !pair.host?.connected) return;
      const parsed = pointerSchema.safeParse(raw);
      if (parsed.success && parsed.data.assetId === pair.state.assetId) pair.host.volatile.emit('viewer:pointer', parsed.data);
    });
    socket.on('viewer:ink', (raw: unknown, ack: Ack) => {
      const pair = forSocket(socket);
      if (!pair || pair.controller !== socket || !pair.host?.connected) return fail(ack, 'OFFLINE', 'La pantalla no está conectada.');
      const parsed = inkSchema.safeParse(raw);
      if (!parsed.success) return fail(ack, 'INVALID_INK', 'El trazo recibido no es válido.');
      const command = parsed.data;
      if (command.assetId !== pair.state.assetId || command.page !== pair.state.page || !pair.state.capabilities.includes('draw') || pair.state.black || pair.state.phase !== 'idle') return fail(ack, 'STALE_CONTENT', 'La vista cambió. Vuelve a dibujar sobre la página actual.');
      // Reliable, bounded point batches. Drawings live only in the host browser.
      pair.host.timeout(5000).emit('viewer:ink', command, (error: Error | null, reply: { ok: boolean; error?: string }) => {
        if (error) return fail(ack, 'INK_TIMEOUT', 'La pantalla no respondió al marcador.');
        if (!reply?.ok) return fail(ack, 'INK_FAILED', reply?.error || 'No se pudo dibujar.');
        ok(ack);
      });
    });
    socket.on('asset:cancel', (id: unknown, ack: Ack) => {
      const pair = forSocket(socket);
      if (!pair || pair.controller !== socket || typeof id !== 'string') return fail(ack, 'UNAUTHORIZED', 'No se pudo cancelar.');
      if (pair.transfer?.meta.id === id) cancel(pair, 'Envío cancelado.');
      pair.host?.emit('asset:cancel', id);
      ok(ack);
    });
    socket.on('pair:end', (ack: Ack) => {
      const pair = forSocket(socket);
      if (!pair || pair.controller !== socket) return fail(ack, 'UNAUTHORIZED', 'No hay una asociación activa.');
      ok(ack);
      end(pair, 'Sesión terminada');
    });
    socket.on('disconnect', () => {
      const pair = forSocket(socket);
      if (!pair) return;
      const isHost = pair.host === socket;
      if (!isHost && pair.controller !== socket) return;
      cancel(pair, 'La conexión se interrumpió. Vuelve a enviar el archivo.');
      if (isHost) { pair.host = undefined; pair.hostData?.disconnect(true); pair.hostData = undefined; }
      else { pair.controller = undefined; pair.controllerData?.disconnect(true); pair.controllerData = undefined; pair.host?.emit('viewer:pointer', { x: 0, y: 0, visible: false, assetId: pair.state.assetId }); }
      const delay = isHost ? graceMs : Math.max(graceMs, (pair.pickerUntil || 0) - Date.now());
      if (isHost) pair.hostReconnectUntil = Date.now() + delay;
      else pair.controllerReconnectUntil = Date.now() + delay;
      status(pair);
      const timer = setTimeout(() => end(pair, 'La conexión no se recuperó. Sesión terminada'), delay);
      timer.unref();
      if (isHost) pair.hostTimer = timer; else pair.controllerTimer = timer;
    });
  });

  data.use((socket, next) => {
    const credentials = socket.handshake.auth as Credentials;
    const pair = credentials && pairs.get(credentials.id);
    const role = credentials?.role;
    if (!pair || !['host', 'controller'].includes(role) || typeof credentials.key !== 'string' || credentials.key !== (role === 'host' ? pair.hostKey : pair.controllerKey)) return next(new Error('Asociación inválida.'));
    if (!(role === 'host' ? pair.host : pair.controller)?.connected) return next(new Error('El mando debe conectarse primero.'));
    if ((role === 'host' ? pair.hostData : pair.controllerData)?.connected) return next(new Error('Ya existe un canal de archivos para este dispositivo.'));
    socket.data.pairId = pair.id;
    socket.data.role = role;
    next();
  });
  data.on('connection', (socket) => {
    const pair = forSocket(socket)!;
    if (socket.data.role === 'host') pair.hostData = socket;
    else pair.controllerData = socket;
    availability(pair);
    let previewInFlight = false;
    let lastPreview = 0;
    socket.on('preview:frame', (raw: unknown, bytes: unknown, ack: Ack) => {
      const current = forSocket(socket);
      if (!current || current.hostData !== socket || !current.controllerData?.connected || !current.host?.connected) return fail(ack, 'OFFLINE', 'El celular no está conectado.');
      const parsed = previewFrameSchema.safeParse(raw);
      if (!parsed.success || parsed.data.assetId !== current.state.assetId || parsed.data.page !== current.state.page || !Buffer.isBuffer(bytes) || bytes.length > MAX_PREVIEW_BYTES || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return fail(ack, 'INVALID_PREVIEW', 'Vista previa no válida.');
      if (previewInFlight || Date.now() - lastPreview < 450) return fail(ack, 'PREVIEW_BUSY', 'Espera la vista previa anterior.');
      previewInFlight = true; lastPreview = Date.now();
      current.controllerData.timeout(3000).emit('preview:frame', parsed.data, bytes, (error: Error | null, reply: { ok: boolean }) => {
        previewInFlight = false;
        if (error || !reply?.ok) fail(ack, 'PREVIEW_TIMEOUT', 'El celular no confirmó la vista previa.'); else ok(ack);
      });
    });
    socket.on('transfer:begin', (raw: unknown, ack: Ack) => {
      const current = forSocket(socket);
      if (!current || current.controllerData !== socket || !current.controller?.connected || !current.hostData?.connected) return fail(ack, 'OFFLINE', 'La pantalla aún no está lista para recibir.');
      const parsed = fileMetaSchema.safeParse(raw);
      if (!parsed.success || kindFromName(parsed.data.name) !== parsed.data.kind) return fail(ack, 'INVALID_FILE', 'Archivo vacío, formato incompatible o tamaño mayor de 1 GB.');
      if (current.transfer) cancel(current, 'Se está enviando un archivo nuevo.');
      const transfer: Transfer = { meta: parsed.data, next: 0, bytes: 0, pending: 0, acknowledged: new Set() };
      current.transfer = transfer;
      current.hostData.timeout(ACK_TIMEOUT_MS).emit('transfer:begin', transfer.meta, (error: Error | null, reply: { ok: boolean }) => {
        if (current.transfer !== transfer) return fail(ack, 'CANCELLED', 'Este envío se canceló.');
        if (error || !reply?.ok) { cancel(current, 'La pantalla no pudo recibir.'); return fail(ack, 'RECEIVER_TIMEOUT', 'La pantalla no pudo recibir. Intenta de nuevo.'); }
        ok(ack);
      });
    });
    socket.on('transfer:chunk', (id: unknown, index: unknown, bytes: unknown, ack: Ack) => {
      const current = forSocket(socket);
      const transfer = current?.transfer;
      if (!current || current.controllerData !== socket || !transfer || transfer.meta.id !== id || !current.hostData?.connected) return fail(ack, 'CANCELLED', 'Este envío ya no está activo.');
      if (!Number.isInteger(index) || typeof index !== 'number' || index < 0 || !Buffer.isBuffer(bytes)) return fail(ack, 'INVALID_CHUNK', 'Fragmento inválido.');
      if (transfer.acknowledged.has(index)) return ok(ack);
      if (index !== transfer.next || bytes.length !== Math.min(CHUNK_BYTES, transfer.meta.size - transfer.bytes) || transfer.pending >= TRANSFER_WINDOW) return fail(ack, 'INVALID_CHUNK', 'La secuencia o el tamaño del fragmento no es válido.');
      transfer.next++;
      transfer.bytes += bytes.length;
      transfer.pending++;
      current.hostData.timeout(ACK_TIMEOUT_MS).emit('transfer:chunk', id, index, bytes, (error: Error | null, reply: { ok: boolean }) => {
        transfer.pending--;
        if (current.transfer !== transfer) return fail(ack, 'CANCELLED', 'Este envío se canceló.');
        if (error || !reply?.ok) { cancel(current, 'La transferencia se interrumpió.'); return fail(ack, 'RECEIVER_TIMEOUT', 'La transferencia se interrumpió. Vuelve a enviar el archivo.'); }
        transfer.acknowledged.add(index);
        if (transfer.acknowledged.size > 16) transfer.acknowledged.delete(transfer.acknowledged.values().next().value!);
        ok(ack);
      });
    });
    socket.on('transfer:end', (id: unknown, ack: Ack) => {
      const current = forSocket(socket);
      const transfer = current?.transfer;
      if (!current || current.controllerData !== socket || !transfer || transfer.meta.id !== id || transfer.bytes !== transfer.meta.size || transfer.pending !== 0) return fail(ack, 'INCOMPLETE', 'El archivo no llegó completo.');
      current.hostData?.emit('transfer:end', id);
      current.transfer = undefined;
      ok(ack);
    });
    socket.on('disconnect', () => {
      const current = forSocket(socket);
      if (!current) return;
      if (current.hostData === socket) { current.hostData = undefined; cancel(current, 'Se interrumpió el canal de archivos.'); }
      if (current.controllerData === socket) { current.controllerData = undefined; cancel(current, 'Se interrumpió el canal de archivos.'); }
      availability(current);
    });
  });

  return {
    io,
    get pairCount() { return pairs.size; },
    async close() {
      for (const pair of [...pairs.values()]) end(pair, 'Servidor detenido');
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}
