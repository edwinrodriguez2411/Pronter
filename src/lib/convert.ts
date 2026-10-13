import type { FileMeta } from '../../shared/protocol';
import { checkConversionSize } from './files';
import { CONVERSION_TIMEOUT_MS, MAX_CONVERTED_BYTES } from '../../shared/protocol';

export async function convertMedia(blob: Blob, meta: FileMeta, signal: AbortSignal, onProgress: (progress: number) => void): Promise<Blob> {
  checkConversionSize(blob.size);
  const deadline = new AbortController();
  const relay = () => deadline.abort(signal.reason);
  signal.addEventListener('abort', relay, { once: true });
  const timer = setTimeout(() => deadline.abort(new DOMException('La conversión tardó más de 60 segundos. Envía MP4 (H.264/AAC) o MP3.', 'TimeoutError')), CONVERSION_TIMEOUT_MS);
  const conversionSignal = deadline.signal;
  let ffmpeg: import('@ffmpeg/ffmpeg').FFmpeg | undefined;
  const cancel = () => ffmpeg?.terminate();
  conversionSignal.addEventListener('abort', cancel, { once: true });
  const bounded = <T,>(task: Promise<T>) => new Promise<T>((resolve, reject) => {
    const abort = () => reject(conversionSignal.reason);
    if (conversionSignal.aborted) abort(); else conversionSignal.addEventListener('abort', abort, { once: true });
    task.then(resolve, reject).finally(() => conversionSignal.removeEventListener('abort', abort));
  });
  try {
    signal.throwIfAborted();
    const { FFmpeg } = await bounded(import('@ffmpeg/ffmpeg'));
    ffmpeg = new FFmpeg();
    signal.throwIfAborted();
    await bounded(ffmpeg.load({ coreURL: new URL('/vendor/ffmpeg/ffmpeg-core.js', location.origin).href, wasmURL: new URL('/vendor/ffmpeg/ffmpeg-core.wasm', location.origin).href }, { signal: conversionSignal }));
    ffmpeg.on('progress', ({ progress }) => onProgress(Math.min(0.99, Math.max(0, progress))));
    const input = `input.${meta.name.split('.').pop()?.toLowerCase() || 'bin'}`;
    const output = meta.kind === 'audio' ? 'output.mp3' : 'output.mp4';
    await bounded(ffmpeg.writeFile(input, new Uint8Array(await blob.arrayBuffer()), { signal: conversionSignal }));
    const args = meta.kind === 'audio'
      ? ['-i', input, '-vn', '-map', '0:a:0', '-c:a', 'libmp3lame', '-b:a', '192k', '-fs', String(MAX_CONVERTED_BYTES + 1), output]
      : ['-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-vf', "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-fs', String(MAX_CONVERTED_BYTES + 1), output];
    const result = await bounded(ffmpeg.exec(args, CONVERSION_TIMEOUT_MS, { signal: conversionSignal }));
    if (result !== 0) throw new Error('No se pudo convertir este archivo. Usa MP4 (H.264/AAC) o MP3.');
    const bytes = await bounded(ffmpeg.readFile(output, undefined, { signal: conversionSignal }));
    if (typeof bytes === 'string' || bytes.byteLength > MAX_CONVERTED_BYTES) throw new Error('La conversión supera el límite de memoria. Envía una versión más ligera.');
    conversionSignal.throwIfAborted();
    signal.throwIfAborted();
    return new Blob([new Uint8Array(bytes)], { type: meta.kind === 'audio' ? 'audio/mpeg' : 'video/mp4' });
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', relay); conversionSignal.removeEventListener('abort', cancel);
    ffmpeg?.terminate();
  }
}

export async function convertHeic(blob: Blob, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  const worker = new Worker(new URL('../workers/heic.worker.ts', import.meta.url), { type: 'module' });
  const stop = () => worker.terminate();
  try {
    const bytes = await blob.arrayBuffer();
    signal.throwIfAborted();
    return await new Promise<Blob>((resolve, reject) => {
      const abort = () => { stop(); reject(new DOMException('Conversión cancelada', 'AbortError')); };
      signal.addEventListener('abort', abort, { once: true });
      worker.onmessage = (event: MessageEvent<{ bytes?: Uint8Array; error?: string }>) => {
        signal.removeEventListener('abort', abort);
        if (event.data.error || !event.data.bytes) reject(new Error(event.data.error || 'No se pudo abrir la imagen HEIC.'));
        else resolve(new Blob([new Uint8Array(event.data.bytes)], { type: 'image/png' }));
      };
      worker.onerror = () => { signal.removeEventListener('abort', abort); reject(new Error('No se pudo convertir la imagen HEIC.')); };
      worker.postMessage(bytes, [bytes]);
    });
  } finally { stop(); }
}
