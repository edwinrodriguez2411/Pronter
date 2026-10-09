import { MAX_PREVIEW_BYTES, type PreviewFrame, type ViewerState } from '../../shared/protocol';
import { request, type Connection } from '../connection';
import { contentGeometry } from './content-geometry';
import { createId } from './id';

const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob);
});

function cancellable<T>(task: Promise<T>, signal: AbortSignal, release?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    task.then((value) => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) release?.(value); else resolve(value);
    }, (error) => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

// SVG snapshots inline document resources temporarily. This prevents a rendering
// library's shared URL cache from retaining uploaded PowerPoint images.
async function isolatedContent(source: Element, signal: AbortSignal) {
  const clone = source.cloneNode(true) as HTMLElement;
  const originals = [source, ...source.querySelectorAll('*')], copies = [clone, ...clone.querySelectorAll('*')];
  for (let index = 0; index < originals.length; index++) {
    signal.throwIfAborted();
    // Large slides must leave time for control messages and a replacement upload.
    if (index && index % 64 === 0) await cancellable(new Promise<void>((resolve) => requestAnimationFrame(() => resolve())), signal);
    const original = originals[index], copy = copies[index] as SVGElement;
    const style = getComputedStyle(original);
    if (copy.style) for (const property of style) copy.style.setProperty(property, style.getPropertyValue(property));
    if (original instanceof SVGImageElement) {
      const url = original.href.baseVal;
      if (url.startsWith('blob:')) { const inline = await cancellable(dataUrl(await (await fetch(url, { signal })).blob()), signal); copy.setAttribute('href', inline); copy.setAttributeNS('http://www.w3.org/1999/xlink', 'href', inline); }
    }
    if (original instanceof HTMLImageElement && original.src.startsWith('blob:')) (copy as unknown as HTMLImageElement).src = await cancellable(dataUrl(await (await fetch(original.src, { signal })).blob()), signal);
    if (original instanceof HTMLVideoElement && original.readyState >= 2) {
      const canvas = document.createElement('canvas'); canvas.width = original.videoWidth; canvas.height = original.videoHeight;
      canvas.getContext('2d')!.drawImage(original, 0, 0); const image = new Image(); image.src = canvas.toDataURL(); image.style.cssText = (copy as unknown as HTMLElement).style.cssText; copy.replaceWith(image); canvas.width = canvas.height = 0;
    }
  }
  return clone;
}

export class HostPreview {
  private watching = false;
  private dirty = true;
  private busy = false;
  private disposed = false;
  private key = '';
  private viewId = '';
  private sequence = 0;
  private timer: ReturnType<typeof setInterval>;
  private observer: ResizeObserver;
  private unsubscribe: () => void;
  private fonts?: Promise<string>;
  private fontAsset?: string;
  private captureController?: AbortController;
  private watch = (enabled: boolean) => { this.watching = enabled; this.dirty = true; if (!enabled) this.captureController?.abort(); else { this.refreshView(true); void this.capture(); } };
  constructor(private connection: Connection, private slot: HTMLElement, private state: () => ViewerState) {
    connection.control.on('preview:watch', this.watch);
    this.unsubscribe = connection.subscribe(() => { if (connection.snapshot.status !== 'connected' || !connection.snapshot.dataReady || connection.snapshot.selectingFile) { this.dirty = true; this.captureController?.abort(); } });
    this.observer = new ResizeObserver(() => { this.refreshView(); this.dirty = true; }); this.observer.observe(slot);
    this.timer = setInterval(() => { this.refreshView(); void this.capture(); }, 600);
  }
  changed() { this.dirty = true; if (this.state().phase !== 'idle') this.captureController?.abort(); }
  invalidate() { this.key = ''; this.dirty = true; this.captureController?.abort(); this.refreshView(true); }
  refreshView(force = false) {
    const state = this.state(), geometry = contentGeometry(this.slot);
    if (!state.assetId || !geometry || state.phase !== 'idle') return;
    const key = JSON.stringify([state.assetId, state.page, state.zoom, state.animationStep, ...Object.values(geometry.content).map(Math.round), ...Object.values(geometry.visible).map(Math.round)]);
    if (key !== this.key) { this.captureController?.abort(); this.key = key; this.viewId = createId(); this.dirty = true; }
    if ((force || this.dirty) && this.watching && this.connection.control.connected) this.connection.control.emit('preview:view', { assetId: state.assetId, page: state.page, zoom: state.zoom, viewId: this.viewId });
  }
  matches(viewId: string) { this.refreshView(); return viewId === this.viewId; }
  private async capture() {
    const state = this.state();
    if (this.disposed || this.busy || !this.watching || !this.connection.snapshot.dataReady || this.connection.snapshot.selectingFile || this.connection.snapshot.status !== 'connected' || !state.assetId || state.phase !== 'idle' || state.black) return;
    if (!this.dirty && state.kind !== 'video' && state.kind !== 'powerpoint') return;
    const geometry = contentGeometry(this.slot); if (!geometry) return;
    this.refreshView(); this.busy = true; this.dirty = false;
    const viewId = this.viewId, assetId = state.assetId, page = state.page, zoom = state.zoom;
    const controller = new AbortController(); this.captureController = controller;
    const { signal } = controller;
    // Browser decoders, SVG resources and canvas export can otherwise leave the
    // single-flight preview permanently busy. This timeout does not cancel uploads.
    const timeout = setTimeout(() => controller.abort(new DOMException('Vista previa detenida', 'TimeoutError')), 4000);
    if (this.fontAsset !== assetId) { this.fontAsset = assetId; this.fonts = undefined; }
    const transport = this.connection.data!;
    const { element, visible, crop } = geometry;
    const scale = Math.min(1, 800 / Math.max(visible.width, visible.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(visible.width * scale)); canvas.height = Math.max(1, Math.round(visible.height * scale));
    const context = canvas.getContext('2d')!; context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
    try {
      if (element instanceof HTMLImageElement || element instanceof HTMLCanvasElement || element instanceof HTMLVideoElement) {
        const width = element instanceof HTMLImageElement ? element.naturalWidth : element instanceof HTMLVideoElement ? element.videoWidth : element.width;
        const height = element instanceof HTMLImageElement ? element.naturalHeight : element instanceof HTMLVideoElement ? element.videoHeight : element.height;
        context.drawImage(element, crop.x * width, crop.y * height, crop.width * width, crop.height * height, 0, 0, canvas.width, canvas.height);
      } else {
        const { toCanvas, getFontEmbedCSS } = await cancellable(import('html-to-image'), signal);
        this.fonts ??= getFontEmbedCSS(element as HTMLElement, { preferredFontFormat: 'woff2' });
        void this.fonts.catch(() => {}); // The clone can yield before we await font resources.
        const bounds = element.getBoundingClientRect();
        const localWidth = bounds.width / zoom, localHeight = bounds.height / zoom;
        const left = (visible.left - (bounds.left - geometry.stage.left)) / zoom, top = (visible.top - (bounds.top - geometry.stage.top)) / zoom;
        const target = await isolatedContent(element, signal);
        const holder = document.createElement('div');
        holder.style.cssText = `position:fixed;left:-100000px;top:0;width:${localWidth}px;height:${localHeight}px;pointer-events:none;`; holder.append(target); document.body.append(holder);
        try {
          const fontEmbedCSS = await cancellable(this.fonts, signal);
          const rendered = await cancellable(toCanvas(target as HTMLElement, {
            width: visible.width / zoom, height: visible.height / zoom, canvasWidth: canvas.width, canvasHeight: canvas.height, pixelRatio: 1,
            fontEmbedCSS, style: { width: `${localWidth}px`, height: `${localHeight}px`, margin: '0', transformOrigin: 'top left', transform: `translate(${-left}px, ${-top}px)` },
          }), signal, (late) => { late.width = late.height = 0; });
          context.drawImage(rendered, 0, 0, canvas.width, canvas.height); rendered.width = rendered.height = 0;
        } finally { holder.remove(); }
      }
      // The host's overlay is cropped with the same rectangle as the content.
      await cancellable(new Promise<void>((resolve) => requestAnimationFrame(() => resolve())), signal);
      const overlay = this.slot.querySelector<HTMLCanvasElement>('.annotation-canvas');
      if (overlay?.width) {
        const ratio = overlay.width / geometry.stage.width;
        context.drawImage(overlay, visible.left * ratio, visible.top * ratio, visible.width * ratio, visible.height * ratio, 0, 0, canvas.width, canvas.height);
      }
      this.refreshView();
      if (this.disposed || viewId !== this.viewId || assetId !== this.state().assetId || transport !== this.connection.data || !this.watching) { this.dirty = true; return; }
      let blob: Blob | null = null;
      for (const quality of [0.8, 0.6, 0.4]) { blob = await cancellable(new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality)), signal); if (blob && blob.size <= MAX_PREVIEW_BYTES) break; }
      if (!blob || blob.size > MAX_PREVIEW_BYTES) { this.dirty = true; return; }
      const meta: PreviewFrame = { assetId, page, zoom, viewId, sequence: ++this.sequence, width: canvas.width, height: canvas.height };
      const bytes = await cancellable(blob.arrayBuffer(), signal);
      signal.throwIfAborted();
      await cancellable(request(transport, 'preview:frame', meta, bytes), signal);
    } catch { if (!this.disposed) { this.dirty = true; this.fonts = undefined; } }
    finally { clearTimeout(timeout); canvas.width = canvas.height = 0; if (this.captureController === controller) this.captureController = undefined; this.busy = false; }
  }
  destroy() { this.disposed = true; this.captureController?.abort(); clearInterval(this.timer); this.observer.disconnect(); this.unsubscribe(); this.connection.control.off('preview:watch', this.watch); this.fonts = undefined; }
}
