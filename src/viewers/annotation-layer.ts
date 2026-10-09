import { INK_COLORS, type InkColor, type InkCommand, type InkWidth, type ViewerState } from '../../shared/protocol';
import { contentGeometry } from '../lib/content-geometry';
import { InkGesture } from '../lib/ink-gesture';
import { InkStore } from '../lib/ink-store';

export class AnnotationLayer {
  readonly canvas = document.createElement('canvas');
  private store = new InkStore();
  private state?: ViewerState;
  private frame = 0;
  private lastPaint = '';
  private dirty = true;
  private drawing = { enabled: false, color: 'coral' as InkColor, width: 0.006 as InkWidth };
  private gesture: InkGesture;
  private pointerId?: number;
  private suspended = false;
  private disposed = false;
  constructor(private slot: HTMLElement, private changed: () => void, private onError: (message: string) => void) {
    this.canvas.className = 'annotation-canvas';
    this.canvas.dataset.testid = 'annotation-canvas';
    this.canvas.dataset.strokes = '0';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.slot.append(this.canvas);
    this.gesture = new InkGesture(async (command) => this.apply(command), onError);
    this.canvas.addEventListener('pointerdown', this.down);
    this.canvas.addEventListener('pointermove', this.move);
    this.canvas.addEventListener('pointerup', this.up);
    this.canvas.addEventListener('pointercancel', this.up);
    this.canvas.addEventListener('lostpointercapture', this.up);
  }
  get count() { return this.store.forPage(this.state?.page || 1).length; }
  configure(enabled: boolean, color: InkColor, width: InkWidth) {
    if (!enabled) { this.gesture.end(); this.pointerId = undefined; }
    this.drawing = { enabled, color, width }; this.updateInput();
  }
  reset() { this.gesture.cancel(); this.pointerId = undefined; this.store.reset(); this.dirty = true; }
  sync(state: ViewerState) {
    if (state.assetId !== this.state?.assetId) this.reset();
    if (state.page !== this.state?.page || state.zoom !== this.state?.zoom || state.black && !this.state?.black || state.phase !== 'idle' && state.phase !== this.state?.phase) this.finish();
    this.state = { ...state }; this.updateInput();
    if (state.assetId) this.wake();
    else { cancelAnimationFrame(this.frame); this.frame = 0; this.canvas.width = this.canvas.height = 0; this.canvas.dataset.strokes = '0'; }
  }
  finish() { this.gesture.cancel(); this.pointerId = undefined; this.store.finish(); }
  suspend(value: boolean) { this.suspended = value; if (value) this.finish(); this.updateInput(); }
  private eligible() { return !!this.state?.assetId && this.state.capabilities.includes('draw') && this.state.phase === 'idle' && !this.state.black && !this.suspended; }
  private updateInput() { this.canvas.classList.toggle('is-drawing', this.drawing.enabled && this.eligible()); }
  apply(command: InkCommand) {
    if (!this.eligible() || command.assetId !== this.state!.assetId || command.page !== this.state!.page) throw new Error('La vista cambió. Vuelve a dibujar sobre la página actual.');
    const geometry = contentGeometry(this.slot);
    if (command.type === 'begin' && !geometry) throw new Error('Ajusta el contenido a pantalla antes de dibujar.');
    this.store.apply(command, geometry?.crop);
    this.dirty = true;
    this.wake();
    if (command.type !== 'points') this.changed();
  }
  private point(event: PointerEvent) {
    const geometry = contentGeometry(this.slot); if (!geometry) return;
    const { visible, stage } = geometry;
    return { x: Math.max(0, Math.min(1, (event.clientX - stage.left - visible.left) / visible.width)), y: Math.max(0, Math.min(1, (event.clientY - stage.top - visible.top) / visible.height)) };
  }
  private down = (event: PointerEvent) => {
    if (!this.drawing.enabled || !this.eligible() || this.pointerId !== undefined || event.button !== 0 || !event.isPrimary) return;
    const geometry = contentGeometry(this.slot); const point = this.point(event); if (!geometry || !point) return;
    const x = event.clientX - geometry.stage.left, y = event.clientY - geometry.stage.top;
    if (x < geometry.visible.left || x > geometry.visible.left + geometry.visible.width || y < geometry.visible.top || y > geometry.visible.top + geometry.visible.height) return;
    event.preventDefault(); this.pointerId = event.pointerId; this.canvas.setPointerCapture(event.pointerId);
    this.gesture.begin(this.state!.assetId!, this.state!.page, this.drawing.color, this.drawing.width, point);
  };
  private move = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    for (const sample of event.getCoalescedEvents?.().length ? event.getCoalescedEvents() : [event]) {
      const point = this.point(sample); if (point) this.gesture.move(point);
    }
  };
  private up = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    if (event.type === 'pointerup') { const point = this.point(event); if (point) this.gesture.move(point); }
    this.pointerId = undefined; this.gesture.end();
  };
  private wake() { if (!this.frame && !this.disposed) this.frame = requestAnimationFrame(this.paint); }
  private paint = () => {
    this.frame = 0;
    if (this.disposed) return;
    const geometry = contentGeometry(this.slot);
    const width = this.slot.clientWidth, height = this.slot.clientHeight, ratio = Math.min(2, window.devicePixelRatio || 1, Math.sqrt(16000000 / Math.max(1, width * height)));
    const key = JSON.stringify([geometry?.content, geometry?.visible, width, height, ratio, this.state?.page, this.state?.black]);
    if (this.dirty || key !== this.lastPaint) {
      this.dirty = false; this.lastPaint = key;
      if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
        this.canvas.width = Math.round(width * ratio); this.canvas.height = Math.round(height * ratio);
      }
      const context = this.canvas.getContext('2d');
      if (context) {
        context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
        if (geometry && !this.state?.black) {
          const { content, visible } = geometry;
          context.save(); context.beginPath(); context.rect(visible.left, visible.top, visible.width, visible.height); context.clip();
          context.lineCap = 'round'; context.lineJoin = 'round';
          for (const stroke of this.store.forPage(this.state?.page || 1)) {
            context.strokeStyle = context.fillStyle = INK_COLORS[stroke.color];
            context.lineWidth = stroke.width * Math.min(content.width, content.height);
            context.beginPath();
            stroke.points.forEach((point, index) => {
              const x = content.left + point.x * content.width, y = content.top + point.y * content.height;
              if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
            });
            if (stroke.points.length === 1) {
              const point = stroke.points[0]; context.arc(content.left + point.x * content.width, content.top + point.y * content.height, context.lineWidth / 2, 0, Math.PI * 2); context.fill();
            } else context.stroke();
          }
          context.restore();
        }
      }
      this.canvas.dataset.strokes = String(this.count);
    }
    if (this.count && !this.state?.black) this.wake();
  };
  destroy() {
    this.disposed = true; cancelAnimationFrame(this.frame); this.reset();
    this.canvas.removeEventListener('pointerdown', this.down); this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerup', this.up); this.canvas.removeEventListener('pointercancel', this.up); this.canvas.removeEventListener('lostpointercapture', this.up);
    this.canvas.width = this.canvas.height = 0; this.canvas.remove();
  }
}
