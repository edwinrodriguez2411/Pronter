import type { InkColor, InkCommand, InkPoint, InkWidth } from '../../shared/protocol';

export interface InkCrop { x: number; y: number; width: number; height: number }
export interface InkStroke { id: string; color: InkColor; width: InkWidth; points: InkPoint[]; crop: InkCrop; sequence: number; active: boolean }
const whole: InkCrop = { x: 0, y: 0, width: 1, height: 1 };
export class InkStore {
  private pages = new Map<number, InkStroke[]>();
  private points = 0;
  private strokes = 0;
  forPage(page: number): readonly InkStroke[] { return this.pages.get(page) || []; }
  reset() { this.pages.clear(); this.points = 0; this.strokes = 0; }
  finish() { for (const strokes of this.pages.values()) for (const stroke of strokes) stroke.active = false; }
  apply(command: InkCommand, crop = whole) {
    let strokes = this.pages.get(command.page) || [];
    if (command.type === 'clear') {
      this.points -= strokes.reduce((sum, stroke) => sum + stroke.points.length, 0); this.strokes -= strokes.length;
      this.pages.delete(command.page); return;
    }
    if (command.type === 'undo') {
      const removed = strokes.pop(); if (removed) { this.points -= removed.points.length; this.strokes--; }
      if (!strokes.length) this.pages.delete(command.page); return;
    }
    if (command.type === 'begin') {
      if (strokes.some((stroke) => stroke.id === command.strokeId)) return;
      if (this.strokes >= 1000 || strokes.length >= 250 || this.points >= 50000) throw new Error('Hay demasiados trazos. Borra algunos para seguir dibujando.');
      const stroke: InkStroke = { id: command.strokeId, color: command.color, width: command.width, points: [], crop, sequence: 0, active: true };
      this.add(stroke, [command.point]); strokes.push(stroke); this.strokes++;
      this.pages.set(command.page, strokes); return;
    }
    const stroke = strokes.find((stroke) => stroke.id === command.strokeId);
    if (!stroke) throw new Error('El trazo ya no está activo. Empieza otro.');
    if (command.type === 'end') { stroke.active = false; return; }
    if (command.sequence === stroke.sequence) return;
    if (!stroke.active || command.sequence !== stroke.sequence + 1) throw new Error('El trazo se interrumpió. Empieza otro.');
    if (this.points + command.points.length > 50000 || stroke.points.length + command.points.length > 10000) throw new Error('Hay demasiados puntos. Borra trazos para continuar.');
    this.add(stroke, command.points); stroke.sequence = command.sequence;
  }
  private add(stroke: InkStroke, points: InkPoint[]) {
    for (const point of points) stroke.points.push({ x: stroke.crop.x + point.x * stroke.crop.width, y: stroke.crop.y + point.y * stroke.crop.height });
    this.points += points.length;
  }
}
