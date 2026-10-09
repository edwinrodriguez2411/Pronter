import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { emptyViewer, type Command, type FileMeta, type ViewerState } from '../../shared/protocol';
import { convertHeic, convertMedia } from '../lib/convert';
import { validatePowerpointZip, validateSignature } from '../lib/files';

export interface ViewerEngine {
  state: ViewerState;
  command(command: Command): Promise<void>;
  activate(): Promise<void>;
  destroy(): void;
}
export type Progress = (phase: 'preparing' | 'converting', progress: number) => void;
const abortError = () => new DOMException('Operación cancelada', 'AbortError');
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export async function createViewer(blob: Blob, meta: FileMeta, layer: HTMLElement, signal: AbortSignal, publish: (state: ViewerState) => void, progress: Progress): Promise<ViewerEngine> {
  await validateSignature(blob, meta);
  signal.throwIfAborted();
  const state: ViewerState = { ...emptyViewer(), assetId: meta.id, name: meta.name, kind: meta.kind };
  const resources: (() => void)[] = [];
  const objectUrl = (value: Blob) => { const url = URL.createObjectURL(value); resources.push(() => URL.revokeObjectURL(url)); return url; };
  let alive = true;
  let frame = document.createElement('div');
  frame.className = `content-frame content-${meta.kind}`;
  layer.append(frame);
  let pan = { x: 0, y: 0 };
  const update = (values: Partial<ViewerState> = {}) => { Object.assign(state, values); if (alive) publish({ ...state, capabilities: [...state.capabilities] }); };
  const transform = () => { frame.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${state.zoom})`; };
  let specific: (command: Command) => Promise<void> = async () => {};
  let activate = async () => {};
  const engine: ViewerEngine = {
    state,
    async command(command) {
      if (!alive) return;
      if (command.type === 'black') update({ black: Boolean(command.value) });
      else if (command.type === 'zoom' && state.capabilities.includes('zoom')) { state.zoom = Number(command.value); transform(); update(); }
      else if (command.type === 'fit') { state.zoom = 1; pan = { x: 0, y: 0 }; transform(); frame.scrollTop = 0; update(); }
      else if (command.type === 'pan' && state.capabilities.includes('pan') && typeof command.value === 'object') {
        pan.x = Math.max(-layer.clientWidth * 2, Math.min(layer.clientWidth * 2, pan.x + command.value.x * layer.clientWidth * 0.3));
        pan.y = Math.max(-layer.clientHeight * 2, Math.min(layer.clientHeight * 2, pan.y + command.value.y * layer.clientHeight * 0.3));
        transform();
      } else await specific(command);
    },
    async activate() { await activate(); },
    destroy() {
      // Async adapters can finish acquiring resources after cancellation; drain those too.
      alive = false;
      for (const resource of resources.reverse()) { try { resource(); } catch { /* continue releasing unrelated resources */ } }
      resources.length = 0;
      layer.remove();
    },
  };
  const onAbort = () => engine.destroy();
  signal.addEventListener('abort', onAbort, { once: true });
  resources.push(() => signal.removeEventListener('abort', onAbort));
  try {
    if (meta.kind === 'image') {
      let source = blob;
      if (/\.hei[cf]$/i.test(meta.name)) { progress('converting', 0); source = await convertHeic(blob, signal); }
      if (/\.svg$/i.test(meta.name)) {
        const { sanitizeSvg } = await import('../lib/sanitize');
        source = new Blob([sanitizeSvg(await blob.text())], { type: 'image/svg+xml' });
      }
      const image = new Image();
      image.alt = meta.name;
      image.src = objectUrl(source);
      frame.append(image);
      await image.decode().catch(() => { throw new Error('No se pudo abrir esta imagen. Comprueba su formato.'); });
      if (image.naturalWidth * image.naturalHeight > 50_000_000) throw new Error('La imagen supera los 50 megapíxeles del visor.');
      state.capabilities = ['zoom', 'pan', 'laser', 'draw'];
    } else if (meta.kind === 'pdf') {
      const pdfjs = await import('pdfjs-dist');
      const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const loading = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/', wasmUrl: '/vendor/pdfjs/wasm/' });
      resources.push(() => { void loading.destroy(); });
      const document: PDFDocumentProxy = await loading.promise;
      if (!document.numPages) throw new Error('El PDF no tiene páginas.');
      state.pages = document.numPages;
      state.capabilities = ['pages', 'zoom', 'pan', 'laser', 'draw'];
      const canvas = window.document.createElement('canvas');
      canvas.setAttribute('aria-label', `Página de ${meta.name}`);
      frame.append(canvas);
      let task: RenderTask | undefined;
      let renderGeneration = 0;
      const render = async () => {
        const generation = ++renderGeneration;
        const previous = task;
        previous?.cancel();
        if (previous) await previous.promise.catch(() => {});
        if (!alive || generation !== renderGeneration) return;
        const page = await document.getPage(state.page);
        if (!alive || generation !== renderGeneration) return;
        const natural = page.getViewport({ scale: 1 });
        const fit = Math.min(Math.max(120, layer.clientWidth - 36) / natural.width, Math.max(120, layer.clientHeight - 36) / natural.height);
        const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
        const scale = Math.min(fit * pixelRatio, Math.sqrt(16_000_000 / (natural.width * natural.height)));
        const viewport = page.getViewport({ scale });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${natural.width * fit}px`;
        canvas.style.height = `${natural.height * fit}px`;
        task = page.render({ canvas, viewport });
        await task.promise.catch((error: Error) => { if (error.name !== 'RenderingCancelledException') throw error; });
      };
      await render();
      let resizeTimer: ReturnType<typeof setTimeout>;
      const observer = new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { void render().catch(() => update({ notice: 'No se pudo redibujar esta página.' })); }, 120); });
      observer.observe(layer);
      resources.push(() => { clearTimeout(resizeTimer); observer.disconnect(); task?.cancel(); });
      specific = async (command) => {
        if (!['next', 'previous', 'page'].includes(command.type)) return;
        state.page = Math.max(1, Math.min(state.pages, command.type === 'page' ? Number(command.value) : state.page + (command.type === 'next' ? 1 : -1)));
        pan = { x: 0, y: 0 }; transform(); update();
        await render();
      };
    } else if (meta.kind === 'powerpoint') {
      const { buildPowerpoint } = await import('./powerpoint');
      const ppt = await buildPowerpoint(blob, meta, frame, signal, state, update);
      resources.push(() => ppt.destroy());
      specific = (command) => ppt.command(command);
      activate = () => ppt.activate();
      state.capabilities = ['pages', 'zoom', 'pan', 'laser', 'animations', 'draw'];
    } else if (meta.kind === 'markdown') {
      const { default: MarkdownContent } = await import('../components/MarkdownContent');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await blob.arrayBuffer());
      if (!text.trim()) throw new Error('El Markdown está vacío.');
      frame.classList.add('document-scroll');
      const root: Root = createRoot(frame);
      resources.push(() => root.unmount());
      flushSync(() => root.render(<MarkdownContent text={text} />));
      await nextFrame();
      state.capabilities = ['scroll', 'zoom', 'laser', 'draw'];
      specific = async (command) => { if (command.type === 'scroll') frame.scrollBy({ top: Number(command.value) * frame.clientHeight * 0.7, behavior: 'instant' }); };
    } else {
      const media = window.document.createElement(meta.kind === 'audio' ? 'audio' : 'video');
      media.controls = true;
      media.preload = 'auto';
      media.setAttribute('playsinline', '');
      media.setAttribute('aria-label', meta.name);
      if (meta.kind === 'audio') {
        const artwork = window.document.createElement('div');
        artwork.className = 'audio-artwork';
        artwork.innerHTML = '<div class="audio-record"><div class="record-label"><span>pronter</span><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M10 8v16l14-8z" fill="currentColor"/></svg></div></div><div class="audio-equalizer" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>';
        const title = window.document.createElement('h2'); title.textContent = meta.name;
        artwork.append(title); frame.append(artwork);
      }
      frame.append(media);
      resources.push(() => { media.pause(); media.removeAttribute('src'); media.load(); });
      const load = (source: Blob) => new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => done(new Error('Este códec no se reproduce directamente.')), 10000);
        const success = () => done();
        const error = () => done(new Error('Este códec no se reproduce directamente.'));
        const abort = () => done(abortError());
        const done = (failure?: Error) => {
          clearTimeout(timeout);
          media.removeEventListener('loadeddata', success); media.removeEventListener('error', error); signal.removeEventListener('abort', abort);
          failure ? reject(failure) : resolve();
        };
        media.addEventListener('loadeddata', success, { once: true }); media.addEventListener('error', error, { once: true }); signal.addEventListener('abort', abort, { once: true });
        media.src = objectUrl(source); media.load();
      });
      try { await load(blob); }
      catch (error) {
        signal.throwIfAborted();
        progress('converting', 0);
        const converted = await convertMedia(blob, meta, signal, (value) => progress('converting', value));
        await load(converted);
      }
      state.capabilities = meta.kind === 'video' ? ['media', 'zoom', 'pan', 'laser', 'draw'] : ['media'];
      const synchronize = () => {
        frame.classList.toggle('is-playing', !media.paused);
        update({ paused: media.paused, currentTime: Math.max(0, media.currentTime || 0), duration: Number.isFinite(media.duration) ? Math.max(0, media.duration) : 0, volume: media.muted ? 0 : media.volume, rate: media.playbackRate });
      };
      for (const event of ['play', 'pause', 'timeupdate', 'volumechange', 'ratechange', 'durationchange', 'ended']) media.addEventListener(event, synchronize);
      resources.push(() => { for (const event of ['play', 'pause', 'timeupdate', 'volumechange', 'ratechange', 'durationchange', 'ended']) media.removeEventListener(event, synchronize); });
      const play = async () => {
        try { await media.play(); update({ needsActivation: false }); }
        catch { update({ needsActivation: true, paused: true }); throw new Error('Toca «Activar audio» en la pantalla del computador y vuelve a reproducir.'); }
      };
      activate = play;
      specific = async (command) => {
        if (command.type === 'play') await play();
        if (command.type === 'pause') media.pause();
        if (command.type === 'volume') { media.muted = false; media.volume = Number(command.value); }
        if (command.type === 'seek') media.currentTime = Math.min(state.duration, Number(command.value));
        if (command.type === 'rate') media.playbackRate = Number(command.value);
        synchronize();
      };
      synchronize();
    }
    signal.throwIfAborted();
    update();
    return engine;
  } catch (error) { engine.destroy(); throw error; }
}
