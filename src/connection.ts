import { io, type Socket } from 'socket.io-client';
import { useEffect, useState } from 'react';
import { ACK_TIMEOUT_MS, emptyDisplay, emptyViewer, type ConnectionStatus, type Credentials, type DisplayState, type PairPresence, type PairResponse, type PreviewView, type Reply, type Role, type ViewerState } from '../shared/protocol';

export class RequestError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

export function request<T = unknown>(socket: Socket, event: string, ...args: unknown[]): Promise<T> {
  if (!socket.connected) return Promise.reject(new Error('La conexión se interrumpió. Espera a que vuelva.'));
  return socket.timeout(ACK_TIMEOUT_MS).emitWithAck(event, ...args).then((reply: Reply<T>) => {
    if (!reply?.ok) throw new RequestError(reply?.error || 'No se pudo completar la operación.', reply?.code);
    return reply.data as T;
  }).catch((error: Error) => {
    if (error.message === 'operation has timed out') throw new RequestError('La pantalla no respondió a tiempo. Intenta de nuevo.', 'ACK_TIMEOUT');
    if (error.message === 'socket has been disconnected') throw new RequestError('La conexión se interrumpió. Espera a que vuelva.', 'OFFLINE');
    throw error;
  });
}

export interface ConnectionSnapshot {
  status: ConnectionStatus; token: string; error: string; publicUrl: string;
  viewer: ViewerState; dataReady: boolean; reconnectAt: number | null; graceMs: number;
  selectingFile: boolean; reconnectUntil: number | null;
  display: DisplayState; previewView: PreviewView | null;
}
type Listener = (...args: any[]) => void;
export class Connection {
  readonly control: Socket;
  data?: Socket;
  credentials?: Credentials;
  snapshot: ConnectionSnapshot = { status: 'connecting', token: '', error: '', publicUrl: '', viewer: emptyViewer(), dataReady: false, reconnectAt: null, graceMs: 20000, selectingFile: false, reconnectUntil: null, display: emptyDisplay(), previewView: null };
  private previewWatching = false;
  private subscribers = new Set<() => void>();
  private dataListeners = new Map<string, Set<Listener>>();
  private scannedToken: string;
  private disposed = false;
  private started = false;
  private associatedId?: string;
  private associatingId?: string;
  private associationRetry?: ReturnType<typeof setTimeout>;
  private dataRetry?: ReturnType<typeof setTimeout>;
  private peerReady = false;
  private hasPartner = false;
  private selectingFile = false;
  private wake = () => { if (document.visibilityState === 'visible') this.recover(true); };
  constructor(readonly role: Role) {
    this.scannedToken = role === 'controller' ? window.location.hash.slice(1) : '';
    this.control = io('/control', { transports: ['websocket'], autoConnect: false, reconnectionDelay: 500, reconnectionDelayMax: 2000 });
    this.control.on('connect', () => { void this.associate(); });
    this.control.on('disconnect', () => {
      this.associatedId = undefined; this.peerReady = false;
      clearTimeout(this.associationRetry); clearTimeout(this.dataRetry);
      this.data?.disconnect();
      if (!this.disposed && this.snapshot.status !== 'ended' && this.snapshot.status !== 'error') this.patch({ status: 'reconnecting', dataReady: false, reconnectAt: Date.now() });
    });
    this.control.on('connect_error', () => {
      if (!this.disposed && this.snapshot.status !== 'ended' && this.snapshot.status !== 'error') this.patch({ status: this.credentials ? 'reconnecting' : 'connecting', dataReady: false });
    });
    this.control.on('pair:status', (status: ConnectionStatus) => {
      if (status === 'connected') this.hasPartner = true;
      this.patch({ status, reconnectAt: status === 'reconnecting' ? this.snapshot.reconnectAt ?? Date.now() : null });
    });
    this.control.on('pair:presence', (presence: PairPresence) => this.patch(presence));
    this.control.on('transfer:availability', (ready: boolean) => { this.peerReady = ready; this.refreshDataReady(); });
    this.control.on('viewer:state', (viewer: ViewerState) => this.patch({ viewer }));
    this.control.on('display:state', (display: DisplayState) => this.patch({ display }));
    this.control.on('preview:view', (previewView: PreviewView) => this.patch({ previewView }));
    this.control.on('pair:ended', (reason: string) => this.finish(reason));
    document.addEventListener('visibilitychange', this.wake);
    window.addEventListener('pageshow', this.wake);
    window.addEventListener('focus', this.wake);
    window.addEventListener('online', this.wake);
  }
  patch(values: Partial<ConnectionSnapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...values };
    for (const callback of this.subscribers) callback();
  }
  subscribe(callback: () => void) { this.subscribers.add(callback); return () => { this.subscribers.delete(callback); }; }
  async start() {
    if (this.started) return;
    this.started = true;
    try {
      const response = await fetch('/api/config', { cache: 'no-store' });
      const config = await response.json() as { publicUrl: string; graceMs: number };
      this.patch(config);
    } catch { this.patch({ publicUrl: window.location.origin }); }
    if (!this.disposed) this.control.connect();
  }
  private async associate() {
    const socketId = this.control.id;
    if (!socketId || this.disposed || this.snapshot.status === 'ended' || this.associatingId === socketId || this.associatedId === socketId) return;
    this.associatingId = socketId;
    try {
      const pair = await (this.credentials
        ? request<PairResponse>(this.control, 'pair:resume', this.credentials)
        : this.role === 'host'
          ? request<PairResponse>(this.control, 'pair:create')
          : request<PairResponse>(this.control, 'pair:join', this.scannedToken));
      if (this.disposed || !this.control.connected || this.control.id !== socketId) return;
      this.associatedId = socketId;
      this.credentials = { id: pair.id, key: pair.key, role: pair.role };
      this.hasPartner ||= pair.connected;
      if (this.role === 'controller') { this.scannedToken = ''; window.history.replaceState(null, '', '/control'); }
      this.patch({ token: pair.token ?? this.snapshot.token, status: pair.connected ? 'connected' : this.hasPartner ? 'reconnecting' : 'waiting', error: '', reconnectAt: null });
      if (this.role === 'controller') this.control.emit('pair:picker', this.selectingFile);
      if (this.role === 'controller') this.control.emit('preview:watch', this.previewWatching);
      else this.control.emit('display:state', this.snapshot.display);
      this.openData();
    } catch (error) {
      if (this.disposed || !this.control.connected || this.control.id !== socketId) return;
      if (this.credentials && error instanceof RequestError && error.code === 'EXPIRED') this.finish('La asociación terminó. Escanea el nuevo QR.');
      else if (this.credentials || (error instanceof RequestError && error.code === 'ACK_TIMEOUT')) {
        this.patch({ status: this.credentials ? 'reconnecting' : 'connecting', dataReady: false });
        clearTimeout(this.associationRetry);
        this.associationRetry = setTimeout(() => { void this.associate(); }, 800);
      } else this.patch({ status: 'error', error: (error as Error).message });
    } finally { if (this.associatingId === socketId) this.associatingId = undefined; }
  }
  private refreshDataReady() { this.patch({ dataReady: !!this.data?.connected && this.peerReady }); }
  private retryData(socket: Socket) {
    clearTimeout(this.dataRetry);
    if (this.disposed || this.snapshot.status === 'ended' || !this.control.connected || this.associatedId !== this.control.id) return;
    this.dataRetry = setTimeout(() => { if (this.data === socket && this.control.connected && !socket.connected) socket.connect(); }, 700);
  }
  private openData() {
    this.data?.removeAllListeners();
    this.data?.disconnect();
    this.patch({ dataReady: false });
    // A separate Manager means a separate physical WebSocket, avoiding upload head-of-line blocking.
    const socket = io('/transfer', { transports: ['websocket'], forceNew: true, auth: this.credentials, autoConnect: false, reconnectionDelay: 700, reconnectionDelayMax: 2000 });
    this.data = socket;
    for (const [event, listeners] of this.dataListeners) for (const listener of listeners) socket.on(event, listener);
    socket.on('connect', () => { clearTimeout(this.dataRetry); this.refreshDataReady(); });
    socket.on('disconnect', (reason) => { this.patch({ dataReady: false }); if (reason === 'io server disconnect') this.retryData(socket); });
    // Namespace middleware rejection does not trigger Socket.IO's automatic reconnection.
    socket.on('connect_error', () => { this.patch({ dataReady: false }); this.retryData(socket); });
    socket.on('pair:ended', (reason: string) => this.finish(reason));
    socket.connect();
  }
  recover(restartPending = false) {
    if (!this.started || this.disposed || ['ended', 'error'].includes(this.snapshot.status)) return;
    if (!this.control.connected) {
      // A transport started while offline can still be waiting for its handshake.
      // Resume/online events must restart it instead of waiting through the reservation.
      if (restartPending) this.control.disconnect();
      if (restartPending || !this.control.active) this.control.connect();
      return;
    }
    if (this.associatedId !== this.control.id) { void this.associate(); return; }
    if (this.data && !this.data.connected) {
      if (restartPending) this.data.disconnect();
      if (restartPending || !this.data.active) this.data.connect();
    }
  }
  setFileSelection(selecting: boolean) {
    if (this.role !== 'controller') return;
    this.selectingFile = selecting;
    this.patch({ selectingFile: selecting });
    if (this.control.connected && this.associatedId === this.control.id) this.control.emit('pair:picker', selecting);
    if (!selecting) this.recover();
  }
  waitForReady(signal: AbortSignal, timeoutMs = 30000): Promise<Socket> {
    this.recover();
    return new Promise((resolve, reject) => {
      let probing = false;
      let settled = false;
      const cleanup = () => { settled = true; clearTimeout(timer); clearInterval(interval); unsubscribe(); signal.removeEventListener('abort', abort); };
      const abort = () => { cleanup(); reject(new DOMException('Envío cancelado', 'AbortError')); };
      const check = async () => {
        if (settled) return;
        if (signal.aborted) return abort();
        if (this.disposed) return abort();
        if (['ended', 'error'].includes(this.snapshot.status)) { cleanup(); reject(new Error(this.snapshot.error || 'La asociación terminó. Escanea el nuevo QR.')); return; }
        if (probing || !this.snapshot.dataReady || this.snapshot.status !== 'connected' || !this.data?.connected) return;
        probing = true;
        try {
          // A round trip verifies that sockets which appeared connected while the picker froze
          // the page are actually usable before the selected File is sent.
          const ready = await request<boolean>(this.control, 'pair:ready');
          if (!settled && ready && !signal.aborted && this.data?.connected && this.snapshot.dataReady) { cleanup(); resolve(this.data); }
        } catch (error) {
          if (!settled && !signal.aborted && error instanceof RequestError && error.code === 'ACK_TIMEOUT' && !this.disposed) { this.control.disconnect(); this.control.connect(); }
        } finally { probing = false; }
      };
      const unsubscribe = this.subscribe(() => { void check(); });
      const interval = setInterval(() => { this.recover(); void check(); }, 500);
      const timer = setTimeout(() => { cleanup(); reject(new Error('No pudimos recuperar el canal de archivos. Revisa la conexión y vuelve a elegir el archivo.')); }, timeoutMs);
      signal.addEventListener('abort', abort, { once: true });
      void check();
    });
  }
  onData(event: string, listener: Listener) {
    let listeners = this.dataListeners.get(event);
    if (!listeners) { listeners = new Set(); this.dataListeners.set(event, listeners); }
    listeners.add(listener);
    this.data?.on(event, listener);
    return () => { listeners.delete(listener); this.data?.off(event, listener); };
  }
  publish(viewer: ViewerState) {
    if (this.role !== 'host') return;
    this.patch({ viewer });
    if (this.control.connected && this.credentials) this.control.emit('viewer:state', viewer);
  }
  watchPreview(watch: boolean) { this.previewWatching = watch; if (this.control.connected) this.control.emit('preview:watch', watch); }
  publishDisplay(display: DisplayState) { this.patch({ display }); if (this.role === 'host' && this.control.connected) this.control.emit('display:state', display); }
  finish(reason = 'Sesión terminada') {
    if (this.snapshot.status === 'ended') return;
    this.credentials = undefined;
    clearTimeout(this.associationRetry); clearTimeout(this.dataRetry);
    this.previewWatching = false;
    this.patch({ status: 'ended', token: '', error: reason, dataReady: false, viewer: emptyViewer(), display: emptyDisplay(), previewView: null });
    this.data?.disconnect();
    this.control.disconnect();
  }
  retry() {
    if (this.credentials || !this.scannedToken) return;
    this.patch({ status: 'connecting', error: '' });
    if (this.control.connected) void this.associate(); else this.control.connect();
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.associationRetry); clearTimeout(this.dataRetry);
    document.removeEventListener('visibilitychange', this.wake);
    window.removeEventListener('pageshow', this.wake);
    window.removeEventListener('focus', this.wake);
    window.removeEventListener('online', this.wake);
    this.control.removeAllListeners();
    this.control.disconnect();
    this.data?.removeAllListeners();
    this.data?.disconnect();
    this.credentials = undefined;
    this.scannedToken = '';
    this.subscribers.clear();
    this.dataListeners.clear();
  }
}

export function useConnection(role: Role) {
  const [connection] = useState(() => new Connection(role));
  const [snapshot, setSnapshot] = useState(connection.snapshot);
  useEffect(() => {
    const unsubscribe = connection.subscribe(() => setSnapshot(connection.snapshot));
    void connection.start();
    return () => { unsubscribe(); connection.dispose(); };
  }, [connection]);
  return { connection, snapshot };
}
