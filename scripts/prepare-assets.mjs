import { cpSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const destination = resolve('public/vendor');
mkdirSync(destination, { recursive: true });
const pdf = dirname(require.resolve('pdfjs-dist/package.json'));
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) cpSync(resolve(pdf, directory), resolve(destination, 'pdfjs', directory), { recursive: true });
const ffmpeg = dirname(fileURLToPath(import.meta.resolve('@ffmpeg/core')));
cpSync(ffmpeg, resolve(destination, 'ffmpeg'), { recursive: true });
const licenses = resolve(destination, 'licenses');
mkdirSync(licenses, { recursive: true });
for (const name of ['react', 'react-dom', 'socket.io-client', 'pdfjs-dist', '@web-ppt/core', '@web-ppt/viewer-core', '@ffmpeg/ffmpeg', '@ffmpeg/core', 'libheif-js', 'dompurify', 'react-markdown', 'remark-gfm', 'rehype-sanitize', 'qrcode.react', 'lucide-react', '@fontsource-variable/bricolage-grotesque', '@fontsource-variable/dm-sans']) {
  const root = resolve('node_modules', name);
  for (const file of readdirSync(root).filter((file) => /^(licen[sc]e|copying|notice)(\.|$)/i.test(file))) {
    cpSync(resolve(root, file), resolve(licenses, `${name.replaceAll('/', '_')}-${file}`), { recursive: true });
  }
}
cpSync(resolve('node_modules/libheif-js/libheif-wasm/LICENSE'), resolve(licenses, 'libheif-engine-LICENSE'));
cpSync(resolve('THIRD_PARTY_NOTICES.md'), resolve(licenses, 'THIRD_PARTY_NOTICES.md'));
if (existsSync('third_party/GPL-2.0.txt')) cpSync(resolve('third_party/GPL-2.0.txt'), resolve(licenses, 'GPL-2.0.txt'));
