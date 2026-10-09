import { describe, expect, it, vi } from 'vitest';
import { inkSchema, type InkCommand, type InkPoint } from '../shared/protocol';
import { InkStore } from '../src/lib/ink-store';
import { intersect } from '../src/lib/content-geometry';
import { InkGesture } from '../src/lib/ink-gesture';

const begin = (page = 1, strokeId = 'stroke'): InkCommand => ({ id: `begin-${strokeId}`, assetId: 'asset', page, strokeId, type: 'begin', color: 'coral', width: 0.006, point: { x: 0.25, y: 0.5 } });
describe('ephemeral drawing contracts and coordinates', () => {
  it('pipelines up to four ordered point batches after the host accepts the stroke', async () => {
    const commands: InkCommand[] = [];
    const releases: (() => void)[] = [];
    const gesture = new InkGesture((command) => {
      commands.push(command); return new Promise<void>((resolve) => releases.push(resolve));
    }, () => {});
    gesture.begin('asset', 1, 'coral', 0.006, { x: 0, y: 0 });
    for (let index = 0; index < 160; index++) gesture.move({ x: index / 160, y: 0.5 });
    gesture.end(); await Promise.resolve();
    expect(commands.map((command) => command.type)).toEqual(['begin']);
    releases.shift()!(); await new Promise((resolve) => setImmediate(resolve));
    expect(commands.filter((command) => command.type === 'points').map((command) => command.sequence)).toEqual([1, 2, 3, 4]);
    releases.shift()!(); await new Promise((resolve) => setImmediate(resolve));
    expect(commands.filter((command) => command.type === 'points').map((command) => command.sequence)).toEqual([1, 2, 3, 4, 5]);
    releases.shift()!(); await new Promise((resolve) => setImmediate(resolve));
    expect(commands.at(-1)?.type).toBe('end');
    for (const release of releases.splice(0)) release();
    await new Promise((resolve) => setImmediate(resolve));
  });
  it('cancels pending batches and suppresses late errors when a finished gesture disconnects', async () => {
    let rejectSend!: (error: Error) => void;
    const send = vi.fn(() => new Promise((_, reject) => { rejectSend = reject; }));
    const onError = vi.fn();
    const gesture = new InkGesture(send, onError);
    gesture.begin('asset', 1, 'coral', 0.006, { x: 0, y: 0 }); gesture.move({ x: 1, y: 1 }); gesture.end();
    await Promise.resolve(); expect(send).toHaveBeenCalledTimes(1);
    gesture.cancel(); rejectSend(new Error('socket has been disconnected'));
    await new Promise((resolve) => setImmediate(resolve));
    expect(send).toHaveBeenCalledTimes(1); expect(onError).not.toHaveBeenCalled();
  });
  it('starts drawing on a new file without waiting for acknowledgements from cancelled batches', async () => {
    const commands: InkCommand[] = [], releases: (() => void)[] = [];
    const onError = vi.fn();
    const gesture = new InkGesture((command) => {
      commands.push(command);
      return command.assetId === 'old' ? new Promise<void>((resolve) => releases.push(resolve)) : Promise.resolve();
    }, onError);
    gesture.begin('old', 1, 'blue', 0.006, { x: 0, y: 0 });
    for (let index = 0; index < 128; index++) gesture.move({ x: index / 128, y: 0.5 });
    gesture.end(); await new Promise((resolve) => setImmediate(resolve));
    releases.shift()!(); await new Promise((resolve) => setImmediate(resolve));
    expect(commands.filter((command) => command.type === 'points')).toHaveLength(4);
    gesture.cancel(); gesture.begin('new', 1, 'coral', 0.006, { x: 0.25, y: 0.5 }); gesture.move({ x: 0.5, y: 0.5 }); gesture.end();
    await new Promise((resolve) => setImmediate(resolve));
    expect(commands.filter((command) => command.assetId === 'new').map((command) => command.type)).toEqual(['begin', 'points', 'end']);
    for (const release of releases.splice(0)) release();
    await new Promise((resolve) => setImmediate(resolve)); expect(onError).not.toHaveBeenCalled();
  });
  it('rejects nonfinite points, oversized batches, arbitrary colors and stale page values', () => {
    expect(inkSchema.safeParse(begin()).success).toBe(true);
    expect(inkSchema.safeParse({ ...begin(), point: { x: NaN, y: 0 } }).success).toBe(false);
    expect(inkSchema.safeParse({ ...begin(), point: { x: Infinity, y: 0 } }).success).toBe(false);
    expect(inkSchema.safeParse({ ...begin(), color: 'url(evil)' }).success).toBe(false);
    expect(inkSchema.safeParse({ ...begin(), page: 1.5 }).success).toBe(false);
    expect(inkSchema.safeParse({ id: 'batch', assetId: 'asset', page: 1, type: 'points', strokeId: 'stroke', sequence: 1, points: Array(33).fill({ x: 0.5, y: 0.5 }) }).success).toBe(false);
  });
  it('anchors a stroke drawn on a clipped zoomed viewport to the original content', () => {
    const store = new InkStore();
    store.apply(begin(), { x: 0.2, y: 0.1, width: 0.4, height: 0.6 });
    expect(store.forPage(1)[0].points[0].x).toBeCloseTo(0.3);
    expect(store.forPage(1)[0].points[0].y).toBeCloseTo(0.4);
    store.apply({ id: 'batch', assetId: 'asset', page: 1, type: 'points', strokeId: 'stroke', sequence: 1, points: [{ x: 1, y: 1 }] });
    expect(store.forPage(1)[0].points[1].x).toBeCloseTo(0.6);
    expect(store.forPage(1)[0].points[1].y).toBeCloseTo(0.7);
    // A retry adds no points; a missing sequence cannot connect unrelated fragments.
    store.apply({ id: 'retry', assetId: 'asset', page: 1, type: 'points', strokeId: 'stroke', sequence: 1, points: [{ x: 1, y: 1 }] });
    expect(store.forPage(1)[0].points).toHaveLength(2);
    expect(() => store.apply({ id: 'gap', assetId: 'asset', page: 1, type: 'points', strokeId: 'stroke', sequence: 3, points: [{ x: 0, y: 0 }] })).toThrow(/interrumpió/);
    expect(intersect({ left: -100, top: -20, width: 400, height: 200 }, { left: 0, top: 0, width: 180, height: 150 })).toEqual({ left: 0, top: 0, width: 180, height: 150 });
  });
  it('keeps pages independent and releases data on undo, clear and file replacement', () => {
    const store = new InkStore(); store.apply(begin()); store.apply(begin(2, 'page-two'));
    store.apply({ id: 'clear-two', assetId: 'asset', page: 2, type: 'clear' });
    expect(store.forPage(2)).toHaveLength(0); expect(store.forPage(1)).toHaveLength(1);
    store.apply(begin(1, 'another')); store.apply({ id: 'undo', assetId: 'asset', page: 1, type: 'undo' });
    expect(store.forPage(1).map((stroke) => stroke.id)).toEqual(['stroke']);
    store.finish();
    expect(() => store.apply({ id: 'after-disconnect', assetId: 'asset', page: 1, type: 'points', strokeId: 'stroke', sequence: 1, points: [{ x: 1, y: 1 }] })).toThrow(/interrumpió/);
    store.reset(); expect(store.forPage(1)).toHaveLength(0); expect(store.forPage(2)).toHaveLength(0);
  });
  it('bounds drawing memory and allows drawing again after clearing', () => {
    const store = new InkStore();
    for (let index = 0; index < 250; index++) store.apply(begin(1, `s-${index}`));
    expect(() => store.apply(begin(1, 'overflow'))).toThrow(/demasiados/);
    store.apply({ id: 'clear', assetId: 'asset', page: 1, type: 'clear' });
    store.apply(begin());
    const points: InkPoint[] = Array.from({ length: 32 }, () => ({ x: 0.5, y: 0.5 }));
    for (let sequence = 1; sequence <= 312; sequence++) store.apply({ id: `batch-${sequence}`, assetId: 'asset', page: 1, type: 'points', strokeId: 'stroke', sequence, points });
    expect(() => store.apply({ id: 'too-long', assetId: 'asset', page: 1, type: 'points', strokeId: 'stroke', sequence: 313, points })).toThrow(/demasiados/);
  });
});
