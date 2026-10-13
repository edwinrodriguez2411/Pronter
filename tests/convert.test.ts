import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONVERSION_TIMEOUT_MS, MAX_CONVERTED_BYTES, type FileMeta } from '../shared/protocol';

const codec = vi.hoisted(() => ({ load: vi.fn(), exec: vi.fn(), writeFile: vi.fn(), readFile: vi.fn(), terminate: vi.fn(), created: vi.fn() }));
vi.mock('@ffmpeg/ffmpeg', () => ({ FFmpeg: class {
  constructor() { codec.created(); }
  load = codec.load; exec = codec.exec; writeFile = codec.writeFile; readFile = codec.readFile; terminate = codec.terminate;
  on() {}
} }));
import { convertMedia } from '../src/lib/convert';
const meta: FileMeta = { id: 'convert', name: 'clip.avi', kind: 'video', type: 'video/x-msvideo', size: 1 };
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.stubGlobal('location', { origin: 'https://pronter.example' });
  codec.load.mockResolvedValue(true); codec.exec.mockResolvedValue(0); codec.writeFile.mockResolvedValue(undefined); codec.readFile.mockResolvedValue(new Uint8Array([1]));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('bounded browser conversion', () => {
  it('rejects a large incompatible input before starting a worker', async () => {
    await expect(convertMedia(new Blob([new Uint8Array(25_000_001)]), meta, new AbortController().signal, () => {})).rejects.toThrow(/25 MB/);
    expect(codec.created).not.toHaveBeenCalled();
  });
  it('terminates a worker whose core never finishes loading within 60 seconds', async () => {
    codec.load.mockImplementation(() => new Promise(() => {}));
    const result = convertMedia(new Blob(['x']), meta, new AbortController().signal, () => {}).catch(error => error);
    await vi.advanceTimersByTimeAsync(CONVERSION_TIMEOUT_MS);
    expect(await result).toMatchObject({ name: 'TimeoutError' });
    expect(codec.terminate).toHaveBeenCalled(); expect(codec.exec).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('terminates stalled execution at the overall deadline', async () => {
    codec.exec.mockImplementation(() => new Promise(() => {}));
    const result = convertMedia(new Blob(['x']), meta, new AbortController().signal, () => {}).catch(error => error);
    await vi.advanceTimersByTimeAsync(CONVERSION_TIMEOUT_MS);
    expect(await result).toMatchObject({ name: 'TimeoutError' });
    expect(codec.exec).toHaveBeenCalled(); expect(codec.terminate).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels preparation promptly while the worker is loading', async () => {
    codec.load.mockImplementation(() => new Promise(() => {}));
    const abort = new AbortController(); const result = convertMedia(new Blob(['x']), meta, abort.signal, () => {}).catch(error => error);
    await vi.advanceTimersByTimeAsync(1); abort.abort();
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(codec.terminate).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects oversized output instead of publishing a truncated video', async () => {
    codec.readFile.mockResolvedValue({ byteLength: MAX_CONVERTED_BYTES + 1 });
    const result = convertMedia(new Blob(['x']), meta, new AbortController().signal, () => {}).catch(error => error);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBeInstanceOf(Error); expect((await result).message).toMatch(/memoria/);
    expect(codec.terminate).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
