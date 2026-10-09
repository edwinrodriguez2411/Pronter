import type { FileMeta } from '../../shared/protocol';
import { checkConversionSize } from './files';

export async function convertMedia(blob: Blob, meta: FileMeta, signal: AbortSignal, onProgress: (progress: number) => void): Promise<Blob> {
  checkConversionSize(blob.size);
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ffmpeg = new FFmpeg();
  const cancel = () => ffmpeg.terminate();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    await ffmpeg.load({ coreURL: new URL('/vendor/ffmpeg/ffmpeg-core.js', location.origin).href, wasmURL: new URL('/vendor/ffmpeg/ffmpeg-core.wasm', location.origin).href }, { signal });
    ffmpeg.on('progress', ({ progress }) => onProgress(Math.min(0.99, Math.max(0, progress))));
    const input = `input.${meta.name.split('.').pop()?.toLowerCase() || 'bin'}`;
    const output = meta.kind === 'audio' ? 'output.mp3' : 'output.mp4';
    await ffmpeg.writeFile(input, new Uint8Array(await blob.arrayBuffer()), { signal });
    const args = meta.kind === 'audio'
      ? ['-i', input, '-vn', '-map', '0:a:0', '-c:a', 'libmp3lame', '-b:a', '192k', '-fs', '200000000', output]
      : ['-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-vf', "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-fs', '200000000', output];
    const result = await ffmpeg.exec(args, 600000, { signal });
    if (result !== 0) throw new Error('No se pudo convertir este archivo. Usa MP4 (H.264/AAC) o MP3.');
    const bytes = await ffmpeg.readFile(output, undefined, { signal });
    if (typeof bytes === 'string' || bytes.byteLength >= 200_000_000) throw new Error('La conversión supera el límite de memoria. Envía una versión más ligera.');
    signal.throwIfAborted();
    return new Blob([new Uint8Array(bytes)], { type: meta.kind === 'audio' ? 'audio/mpeg' : 'video/mp4' });
  } finally {
    signal.removeEventListener('abort', cancel);
    ffmpeg.terminate();
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
