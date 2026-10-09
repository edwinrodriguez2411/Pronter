import { parseInWorker, renderSlideToSvg, type Presentation } from '@web-ppt/core';
import { PresentationState, playGroup, playTransition, foreignObjectScalesCorrectly, type PlayHandle } from '@web-ppt/viewer-core';
import { sanitizeSvg } from '../lib/sanitize';
import { validatePowerpointZip } from '../lib/files';
import type { Command, FileMeta, ViewerState } from '../../shared/protocol';

export async function buildPowerpoint(blob: Blob, meta: FileMeta, container: HTMLElement, signal: AbortSignal, viewer: ViewerState, update: (values?: Partial<ViewerState>) => void) {
  let presentation: Presentation;
  let worker: Worker | undefined;
  const abort = () => worker?.terminate();
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (meta.name.toLowerCase().endsWith('.pptx')) {
      await validatePowerpointZip(blob);
    }
    signal.throwIfAborted();
    worker = new Worker(new URL('../workers/ppt.worker.ts', import.meta.url), { type: 'module' });
    // Terminating a Worker does not reject the library's pending promise; explicitly race cancellation.
    const bytes = await blob.arrayBuffer();
    signal.throwIfAborted();
    presentation = await new Promise<Presentation>((resolve, reject) => {
        const cleanup = () => { window.clearTimeout(timer); signal.removeEventListener('abort', cancel); worker?.removeEventListener('error', fail); };
        const cancel = () => { cleanup(); reject(new DOMException('Operación cancelada', 'AbortError')); };
        const fail = () => { cleanup(); reject(new Error('No se pudo leer el PowerPoint.')); };
        const timer = window.setTimeout(() => { cleanup(); reject(new Error('El PowerPoint tardó demasiado en abrirse.')); }, 120000);
        signal.addEventListener('abort', cancel, { once: true });
        worker!.addEventListener('error', fail, { once: true });
        parseInWorker(worker!, bytes).then(resolve, reject).finally(cleanup);
    });
    signal.throwIfAborted();
  } finally { signal.removeEventListener('abort', abort); worker?.terminate(); }
  if (!presentation.slides.length) { presentation.dispose?.(); throw new Error('El PowerPoint no tiene diapositivas visibles.'); }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state = new PresentationState(presentation, { animate: !reduced, autoAdvance: false, skipHidden: true });
  viewer.staticMode = reduced;
  viewer.pages = state.count;
  const fontFaces: FontFace[] = [];
  const abortFonts = () => { for (const face of fontFaces) document.fonts.delete(face); presentation.dispose?.(); };
  signal.addEventListener('abort', abortFonts, { once: true });
  for (const font of presentation.embeddedFonts || []) {
    if (!/^(blob:|data:)/.test(font.src)) continue;
    try {
      const face = new FontFace(font.family, `url(${JSON.stringify(font.src)})`, { weight: font.bold ? '700' : '400', style: font.italic ? 'italic' : 'normal' });
      await face.load(); signal.throwIfAborted(); document.fonts.add(face); fontFaces.push(face);
    } catch { /* Use the browser's substitute for unsupported embedded font encodings. */ }
  }
  signal.removeEventListener('abort', abortFonts);
  if (signal.aborted) { abortFonts(); signal.throwIfAborted(); }
  let playing: PlayHandle | undefined;
  let node: HTMLDivElement | undefined;
  let disposed = false;
  const textMode = foreignObjectScalesCorrectly(document) ? 'html' : 'svg';
  const stopMedia = () => container.querySelectorAll<HTMLMediaElement>('audio,video').forEach((element) => element.pause());
  const synchronize = () => update({ page: state.index + 1, pages: state.count, animationStep: state.animationDone, animationSteps: state.animationTotal, staticMode: !state.animate });
  const visibility = () => {
    for (const element of node?.querySelectorAll<HTMLElement>('[data-el]') || []) element.style.visibility = state.hiddenElementIds.has(Number(element.dataset.el)) ? 'hidden' : '';
  };
  const paint = (transition?: Parameters<typeof playTransition>[2]) => {
    playing?.cancel(); stopMedia();
    const previous = node;
    node = document.createElement('div'); node.className = 'ppt-slide';
    node.innerHTML = sanitizeSvg(renderSlideToSvg(presentation, state.slide, { media: 'player', textMode }));
    const svg = node.querySelector('svg');
    if (svg) { svg.style.width = '100%'; svg.style.height = '100%'; svg.style.maxWidth = 'none'; }
    container.append(node);
    visibility();
    if (transition && previous && !reduced && state.animate) void playTransition(previous, node, transition).catch(() => previous.remove());
    else previous?.remove();
    synchronize();
  };
  const unsubscribe = state.subscribe((change) => {
    if (disposed) return;
    if (change.type === 'slide') paint(change.transition);
    if (change.type === 'animation') {
      playing?.cancel();
      if (change.group && !reduced && node) playing = playGroup(node, change.group);
      visibility(); synchronize();
    }
  });
  const handleLink = (event: MouseEvent) => {
    const anchor = (event.target as Element).closest('[data-slide],a');
    if (!anchor) return;
    event.preventDefault();
    const target = anchor.getAttribute('data-slide');
    if (target) { const index = state.resolveLink(`slide:${target}`); if (index !== null) state.goTo(index); }
  };
  container.addEventListener('click', handleLink);
  paint();
  // Browser renderers approximate proprietary effects; this is intentionally visible to the presenter.
  update({ notice: 'Vista web: algunas fuentes y efectos de PowerPoint pueden variar.' });
  return {
    async command(command: Command) {
      if (command.type === 'next') state.next();
      if (command.type === 'previous') state.prev();
      if (command.type === 'page') state.goTo(Math.max(0, Math.min(state.count - 1, Number(command.value) - 1)));
      if (command.type === 'static') { state.setAnimate(!command.value && !reduced); paint(); }
      synchronize();
    },
    async activate() {
      const elements = [...container.querySelectorAll<HTMLMediaElement>('audio,video')];
      if (elements.length) await Promise.all(elements.map((element) => element.play()));
    },
    destroy() {
      disposed = true; playing?.cancel(); unsubscribe(); state.destroy(); stopMedia();
      container.removeEventListener('click', handleLink);
      for (const face of fontFaces) document.fonts.delete(face);
      presentation.dispose?.(); container.replaceChildren();
    },
  };
}
