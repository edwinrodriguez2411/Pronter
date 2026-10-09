// Tiny deterministic browser fixtures. This generator is optional and only used by maintainers.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import createFFmpegCore from '@ffmpeg/core';
globalThis.self = { location: { href: import.meta.url } };
const core = await createFFmpegCore({ wasmBinary: readFileSync(fileURLToPath(import.meta.resolve('@ffmpeg/core/wasm'))) });
mkdirSync('tests/fixtures', { recursive: true });
for (const [name, codec] of [['sample.avi', 'mpeg4'], ['sample.mp4', 'libx264']]) {
  core.exec('-f', 'lavfi', '-i', 'color=c=0x2448e8:s=320x180:d=3:r=10', '-an', '-c:v', codec, '-pix_fmt', 'yuv420p', name);
  if (core.ret !== 0) throw new Error(`Could not generate ${name}`);
  writeFileSync(`tests/fixtures/${name}`, core.FS.readFile(name));
  core.FS.unlink(name); core.reset();
}
