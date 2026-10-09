export interface Rect { left: number; top: number; width: number; height: number }
export function intersect(a: Rect, b: Rect): Rect {
  const left = Math.max(a.left, b.left), top = Math.max(a.top, b.top);
  return { left, top, width: Math.max(0, Math.min(a.left + a.width, b.left + b.width) - left), height: Math.max(0, Math.min(a.top + a.height, b.top + b.height) - top) };
}

// Measure the actual picture/page, excluding video and slide letterboxing.
// The overlay is outside the viewer layer so it never becomes its own target.
export function contentGeometry(slot: HTMLElement) {
  const layer = slot.querySelector('.viewer-layer:not(.is-candidate)');
  const element = layer?.querySelector('.content-frame > img, .content-frame > canvas, .content-frame > video, article')
    || [...layer?.querySelectorAll('.ppt-slide > svg') || []].at(-1);
  if (!element) return;
  const stage = slot.getBoundingClientRect();
  const bounds = element.getBoundingClientRect();
  let content: Rect = { left: bounds.left - stage.left, top: bounds.top - stage.top, width: bounds.width, height: bounds.height };
  const ratio = element instanceof HTMLVideoElement ? element.videoWidth / element.videoHeight
    : element instanceof SVGSVGElement ? element.viewBox.baseVal.width / element.viewBox.baseVal.height : 0;
  if (Number.isFinite(ratio) && ratio > 0) {
    const width = Math.min(content.width, content.height * ratio), height = width / ratio;
    content = { left: content.left + (content.width - width) / 2, top: content.top + (content.height - height) / 2, width, height };
  }
  let visible = intersect(content, { left: 0, top: 0, width: stage.width, height: stage.height });
  // A zoomed Markdown scroll container clips its article before the stage does.
  const scroll = element.closest('.document-scroll');
  if (scroll) {
    const clip = scroll.getBoundingClientRect();
    visible = intersect(visible, { left: clip.left - stage.left, top: clip.top - stage.top, width: clip.width, height: clip.height });
  }
  if (content.width <= 0 || content.height <= 0 || visible.width <= 0 || visible.height <= 0) return;
  return { content, visible, stage, crop: { x: (visible.left - content.left) / content.width, y: (visible.top - content.top) / content.height, width: visible.width / content.width, height: visible.height / content.height } };
}
