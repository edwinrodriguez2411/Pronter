import type { Connection } from './connection';
import { CHUNK_BYTES, emptyViewer, type Ack, type Command, type FileMeta, type InkColor, type InkCommand, type InkWidth, type PointerPosition, type ViewerState } from '../shared/protocol';
import { createViewer, type ViewerEngine } from './viewers/engine';
import { contentGeometry } from './lib/content-geometry';
import { AnnotationLayer } from './viewers/annotation-layer';
import { HostPreview } from './lib/host-preview';

export class Presenter {
  private incoming?: { meta: FileMeta; parts: BlobPart[]; bytes: number; next: number };
  private engine?: ViewerEngine;
  private candidate?: ViewerEngine;
  private pending?: AbortController;
  private generation = 0;
  private removers: (() => void)[] = [];
  private pointerTimer?: ReturnType<typeof setTimeout>;
  private receivedCommands = new Set<string>();
  private state = emptyViewer();
  private pendingId?: string;
  private destroyed = false;
  private ink: AnnotationLayer;
  private receivedInk = new Set<string>();
  private preview: HostPreview;
  constructor(private connection: Connection, private slot: HTMLElement, private pointer: HTMLElement) {
    this.ink = new AnnotationLayer(slot, () => this.publish({}), (notice) => this.publish({ notice }));
    this.preview = new HostPreview(connection, slot, () => this.state);
    this.removers.push(connection.onData('transfer:begin', (meta: FileMeta, ack: Ack) => {
      this.cancelPending();
      this.pendingId = meta.id;
      this.incoming = { meta, parts: [], bytes: 0, next: 0 };
      this.publish({ phase: 'receiving', progress: 0, notice: '' });
      ack({ ok: true });
    }));
    this.removers.push(connection.onData('transfer:chunk', (id: string, index: number, bytes: ArrayBuffer, ack: Ack) => {
      const transfer = this.incoming;
      if (!transfer || transfer.meta.id !== id || transfer.next !== index || bytes.byteLength > CHUNK_BYTES) return ack({ ok: false });
      transfer.parts.push(bytes);
      transfer.bytes += bytes.byteLength; transfer.next++;
      this.publish({ progress: Math.min(1, transfer.bytes / transfer.meta.size) });
      ack({ ok: true });
    }));
    this.removers.push(connection.onData('transfer:end', (id: string) => {
      const transfer = this.incoming;
      if (!transfer || transfer.meta.id !== id || transfer.bytes !== transfer.meta.size) return;
      const blob = new Blob(transfer.parts, { type: transfer.meta.type });
      transfer.parts.length = 0; this.incoming = undefined;
      void this.prepare(blob, transfer.meta);
    }));
    this.removers.push(connection.onData('transfer:cancel', ({ id, reason }: { id?: string; reason: string }) => {
      if (!id || id === this.pendingId) { this.cancelPending(); this.publish({ phase: 'idle', progress: 0, notice: reason }); }
    }));
    const commandHandler = (command: Command, ack: Ack) => {
      if (command.assetId !== this.state.assetId) return ack({ ok: false, error: 'El contenido cambió.' });
      if (this.receivedCommands.has(command.id)) return ack({ ok: true });
      this.receivedCommands.add(command.id);
      if (this.receivedCommands.size > 128) this.receivedCommands.delete(this.receivedCommands.values().next().value!);
      this.command(command).then(() => ack({ ok: true }), (error: Error) => { this.receivedCommands.delete(command.id); ack({ ok: false, error: error.message }); });
    };
    const pointerHandler = (position: PointerPosition) => {
      clearTimeout(this.pointerTimer);
      if (position.assetId !== this.state.assetId || !position.visible || this.state.black || !this.state.capabilities.includes('laser')) { pointer.style.opacity = '0'; return; }
      const geometry = contentGeometry(slot);
      if (!geometry) { pointer.style.opacity = '0'; return; }
      const { visible } = geometry;
      pointer.style.transform = `translate(${visible.left + position.x * visible.width}px, ${visible.top + position.y * visible.height}px)`;
      pointer.style.opacity = '1';
      this.pointerTimer = setTimeout(() => { pointer.style.opacity = '0'; }, 600);
    };
    const cancelHandler = (id: string) => { if (id === this.pendingId) { this.cancelPending(); this.publish({ phase: 'idle', progress: 0, notice: 'Envío cancelado.' }); } };
    const connectHandler = () => setTimeout(() => { if (!this.destroyed) connection.publish({ ...this.state }); }, 150);
    const statusHandler = (status: string) => { if (status !== 'connected') { pointer.style.opacity = '0'; this.ink.finish(); } };
    const inkHandler = (command: InkCommand, ack: Ack) => {
      try { this.draw(command); ack({ ok: true }); }
      catch (error) { ack({ ok: false, error: (error as Error).message }); }
    };
    connection.control.on('viewer:command', commandHandler);
    connection.control.on('viewer:pointer', pointerHandler);
    connection.control.on('asset:cancel', cancelHandler);
    connection.control.on('connect', connectHandler);
    connection.control.on('pair:status', statusHandler);
    connection.control.on('viewer:ink', inkHandler);
    this.removers.push(() => {
      connection.control.off('viewer:command', commandHandler); connection.control.off('viewer:pointer', pointerHandler); connection.control.off('asset:cancel', cancelHandler); connection.control.off('connect', connectHandler); connection.control.off('pair:status', statusHandler);
      connection.control.off('viewer:ink', inkHandler);
    });
  }
  private publish(values: Partial<ViewerState>) {
    Object.assign(this.state, values);
    this.ink.sync(this.state);
    this.state.inkCount = this.ink.count;
    this.slot.classList.toggle('is-black', this.state.black);
    if (this.state.black) this.pointer.style.opacity = '0';
    if (!this.destroyed) this.connection.publish({ ...this.state });
    this.preview?.changed();
  }
  private cancelPending() {
    this.generation++;
    this.pending?.abort(); this.pending = undefined;
    this.candidate?.destroy(); this.candidate = undefined;
    if (this.incoming) this.incoming.parts.length = 0;
    this.incoming = undefined; this.pendingId = undefined;
  }
  private async prepare(blob: Blob, meta: FileMeta) {
    const generation = this.generation;
    this.pending = new AbortController();
    const controller = this.pending;
    const layer = document.createElement('div'); layer.className = 'viewer-layer is-candidate';
    this.slot.append(layer);
    let latest = emptyViewer();
    let committed = false;
    this.publish({ phase: 'preparing', progress: 0 });
    try {
      const engine = await createViewer(blob, meta, layer, controller.signal, (values) => {
        latest = values;
        if (committed && !this.destroyed && this.engine?.state.assetId === meta.id) this.publish({ ...values, notice: this.state.notice || values.notice, phase: this.state.phase, progress: this.state.progress });
      }, (phase, progress) => { if (generation === this.generation) this.publish({ phase, progress }); });
      this.candidate = engine;
      if (generation !== this.generation || this.destroyed) { engine.destroy(); return; }
      this.engine?.destroy(); this.engine = engine; this.candidate = undefined;
      layer.classList.remove('is-candidate');
      committed = true; this.pending = undefined; this.pendingId = undefined;
      this.receivedCommands.clear();
      this.receivedInk.clear();
      this.publish({ ...latest, phase: 'idle', progress: 1 });
      this.pointer.style.opacity = '0';
    } catch (error) {
      layer.remove();
      if (generation === this.generation && !this.destroyed) this.publish({ phase: 'idle', progress: 0, notice: (error as Error).name === 'AbortError' ? '' : friendlyError(error) });
    }
  }
  async command(command: Command) {
    if (command.type === 'black' && !this.engine) { this.publish({ black: Boolean(command.value) }); return; }
    const movesView = ['next', 'previous', 'page', 'zoom', 'fit', 'pan', 'scroll', 'static'].includes(command.type);
    if (movesView) this.ink.suspend(true);
    try { await this.engine?.command(command); }
    finally { if (movesView) { this.ink.suspend(false); this.preview.refreshView(); this.preview.changed(); } }
  }
  setDrawing(enabled: boolean, color: InkColor, width: InkWidth) { this.ink.configure(enabled, color, width); }
  refreshPreview() { this.preview.refreshView(true); this.preview.changed(); }
  draw(command: InkCommand) {
    if (this.destroyed) throw new Error('La presentación terminó.');
    if (this.receivedInk.has(command.id)) return;
    if (command.type === 'begin' && command.viewId && !this.preview.matches(command.viewId)) throw new Error('La vista cambió. Espera la vista actual antes de dibujar.');
    this.ink.apply(command); this.receivedInk.add(command.id);
    this.preview.changed();
    if (this.receivedInk.size > 256) this.receivedInk.delete(this.receivedInk.values().next().value!);
  }
  async activate() { await this.engine?.activate(); }
  destroy() {
    this.destroyed = true; this.cancelPending(); this.engine?.destroy(); this.engine = undefined;
    this.preview.destroy(); this.ink.destroy(); this.receivedInk.clear();
    this.state = emptyViewer(); this.receivedCommands.clear(); clearTimeout(this.pointerTimer); this.pointer.style.opacity = '0';
    for (const remove of this.removers) remove(); this.removers.length = 0;
  }
}
function friendlyError(error: unknown) {
  const message = (error as Error)?.message || '';
  if (/password|encrypted|contraseña|加密/i.test(message)) return 'Este archivo está protegido con contraseña. Envía una copia sin protección.';
  if (/memory|allocation|out of bounds/i.test(message)) return 'El visor no tiene memoria suficiente. Envía una versión más ligera.';
  if (/^[\x20-\x7E\u00C0-\u024F\s«»]+$/.test(message) && message) return message.slice(0, 500);
  return 'No se pudo abrir este archivo. Puede estar dañado o incluir elementos incompatibles.';
}
