import { MAX_CONVERSION_BYTES, kindFromName, type FileMeta } from '../../shared/protocol';

export async function validateSignature(blob: Blob, meta: FileMeta) {
  const bytes = new Uint8Array(await blob.slice(0, 1024).arrayBuffer());
  const starts = (...values: number[]) => values.every((value, i) => bytes[i] === value);
  const text = new TextDecoder().decode(bytes);
  let valid = true;
  if (meta.kind === 'pdf') valid = text.includes('%PDF-');
  if (meta.kind === 'powerpoint') valid = meta.name.toLowerCase().endsWith('.pptx') ? starts(80, 75, 3, 4) : starts(0xd0, 0xcf, 0x11, 0xe0);
  if (meta.kind === 'image') valid = starts(0xff, 0xd8, 0xff) || starts(0x89, 80, 78, 71) || text.startsWith('GIF8') || (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') || text.slice(4, 8) === 'ftyp' || /<svg[\s>]/i.test(text);
  if (meta.kind === 'markdown') valid = !starts(80, 75, 3, 4) && !bytes.includes(0);
  if (!valid || kindFromName(meta.name) !== meta.kind) throw new Error('El contenido del archivo no coincide con su formato o está dañado.');
}

export function checkConversionSize(bytes: number) {
  if (bytes > MAX_CONVERSION_BYTES) throw new Error('Este archivo no se reproduce directamente y supera los 200 MB permitidos para conversión. Envíalo en MP4 (H.264/AAC) o MP3.');
}

// Check ZIP's central directory before decompression; ZIP bombs must not allocate their declared expansion.
export async function validatePowerpointZip(blob: Blob) {
  const tailStart = Math.max(0, blob.size - 65557);
  const tail = new DataView(await blob.slice(tailStart).arrayBuffer());
  let end = tail.byteLength - 22;
  while (end >= 0 && tail.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('El PowerPoint no tiene una estructura ZIP válida.');
  const entries = tail.getUint16(end + 10, true);
  const directorySize = tail.getUint32(end + 12, true);
  const offset = tail.getUint32(end + 16, true);
  if (entries === 0xffff || offset === 0xffffffff || directorySize > 16 * 1024 * 1024 || offset + directorySize > blob.size) throw new Error('Este PowerPoint excede los límites seguros del visor.');
  const directory = new DataView(await blob.slice(offset, offset + directorySize).arrayBuffer());
  let cursor = 0;
  let expanded = 0;
  for (let i = 0; i < entries; i++) {
    if (cursor + 46 > directory.byteLength || directory.getUint32(cursor, true) !== 0x02014b50) throw new Error('El PowerPoint está dañado.');
    const compressed = directory.getUint32(cursor + 20, true);
    const size = directory.getUint32(cursor + 24, true);
    expanded += size;
    if (size > 600_000_000 || expanded > 1_500_000_000 || (size > 10_000_000 && size / Math.max(1, compressed) > 300)) throw new Error('El PowerPoint requiere demasiada memoria al descomprimirse. Exporta una versión más ligera.');
    cursor += 46 + directory.getUint16(cursor + 28, true) + directory.getUint16(cursor + 30, true) + directory.getUint16(cursor + 32, true);
  }
}
