import type { InkColor, InkCommand, InkPoint, InkWidth } from '../../shared/protocol';
import { createId } from './id';

interface Gesture {
  assetId: string; page: number; strokeId: string; sequence: number;
  pending: InkPoint[]; failed: boolean; total: number; queued: number; closed: boolean; started: boolean;
}
export class InkGesture {
  private active?: Gesture;
  private timer?: ReturnType<typeof setTimeout>;
  private pending = new Set<Gesture>();
  private queued = 0;
  private inFlight = 0;
  private packets: { gesture: Gesture; command: InkCommand }[] = [];
  constructor(private send: (command: InkCommand) => Promise<unknown>, private onError: (message: string) => void) {}
  private enqueue(gesture: Gesture, command: InkCommand) {
    if (gesture.failed) return;
    if (this.queued >= 64) { gesture.failed = true; this.onError('La conexión va muy lenta para dibujar. Espera y empieza otro trazo.'); return; }
    gesture.queued++; this.queued++;
    this.packets.push({ gesture, command }); this.pump();
  }
  private completed(gesture: Gesture) {
    gesture.queued--; this.queued--;
    if (!gesture.queued && gesture.closed) this.pending.delete(gesture);
  }
  private pump() {
    // Socket.IO preserves emission order. Four acknowledged batches can travel in
    // parallel, so internet latency does not make every 40ms batch wait one RTT.
    while (this.inFlight < 4 && this.packets.length) {
      const { gesture, command } = this.packets[0];
      if (gesture.failed) { this.packets.shift(); this.completed(gesture); continue; }
      if (command.type !== 'begin' && !gesture.started) break;
      this.packets.shift(); this.inFlight++;
      void Promise.resolve().then(async () => {
        if (gesture.failed) return;
        await this.send(command);
        if (command.type === 'begin') gesture.started = true;
      }).catch((error: Error) => {
        const cancelled = gesture.failed; gesture.failed = true;
        if (!cancelled) this.onError(error.message || 'No se pudo dibujar. Vuelve a intentarlo.');
      }).finally(() => { this.completed(gesture); this.inFlight--; this.pump(); });
    }
  }
  begin(assetId: string, page: number, color: InkColor, width: InkWidth, point: InkPoint) {
    this.end();
    const gesture: Gesture = { assetId, page, strokeId: createId(), sequence: 0, pending: [], failed: false, total: 1, queued: 0, closed: false, started: false };
    this.active = gesture; this.pending.add(gesture);
    this.enqueue(gesture, { id: createId(), assetId, page, type: 'begin', strokeId: gesture.strokeId, color, width, point });
  }
  move(point: InkPoint) {
    const gesture = this.active;
    if (!gesture || gesture.failed) return;
    if (++gesture.total > 10000) { this.end(); this.onError('Este trazo es muy largo. Levanta el dedo para empezar otro.'); return; }
    gesture.pending.push(point);
    if (gesture.pending.length >= 32) this.flush(gesture);
    else if (!this.timer) this.timer = setTimeout(() => this.flush(gesture), 40);
  }
  private flush(gesture: Gesture) {
    clearTimeout(this.timer); this.timer = undefined;
    if (!gesture.pending.length) return;
    const points = gesture.pending.splice(0, 32);
    this.enqueue(gesture, { id: createId(), assetId: gesture.assetId, page: gesture.page, type: 'points', strokeId: gesture.strokeId, sequence: ++gesture.sequence, points });
  }
  end() {
    const gesture = this.active; this.active = undefined;
    clearTimeout(this.timer); this.timer = undefined;
    if (!gesture) return;
    this.flush(gesture);
    this.enqueue(gesture, { id: createId(), assetId: gesture.assetId, page: gesture.page, type: 'end', strokeId: gesture.strokeId });
    gesture.closed = true; if (!gesture.queued) this.pending.delete(gesture);
  }
  cancel() {
    for (const gesture of this.pending) gesture.failed = true;
    this.pending.clear();
    this.active = undefined; clearTimeout(this.timer); this.timer = undefined;
    this.pump();
  }
}
