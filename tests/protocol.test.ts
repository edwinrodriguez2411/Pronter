import { describe, expect, it } from 'vitest';
import { commandSchema, fileMetaSchema, MAX_FILE_BYTES, emptyViewer, kindFromName, viewerSchema } from '../shared/protocol';
import { validateSignature, validatePowerpointZip, checkConversionSize } from '../src/lib/files';
import { pdfFixture, pptxFixture } from './fixtures';

describe('public input contracts', () => {
  it('admits 1 GB and rejects oversized or empty files', () => {
    const meta = { id: 'file', name: 'clip.mp4', type: 'video/mp4', size: MAX_FILE_BYTES, kind: 'video' };
    expect(fileMetaSchema.safeParse(meta).success).toBe(true);
    expect(fileMetaSchema.safeParse({ ...meta, size: MAX_FILE_BYTES + 1 }).success).toBe(false);
    expect(fileMetaSchema.safeParse({ ...meta, size: 0 }).success).toBe(false);
  });
  it('limits conversion independently from transfer', () => {
    expect(() => checkConversionSize(200_000_000)).not.toThrow();
    expect(() => checkConversionSize(200_000_001)).toThrow(/200 MB/);
  });
  it('rejects invalid command values and nonfinite viewer state', () => {
    const command = { id: 'command', assetId: null, type: 'volume', value: 1 };
    expect(commandSchema.safeParse(command).success).toBe(true);
    expect(commandSchema.safeParse({ ...command, value: 2 }).success).toBe(false);
    expect(commandSchema.safeParse({ ...command, type: 'zoom', value: NaN }).success).toBe(false);
    expect(commandSchema.safeParse({ ...command, type: 'page', value: 1.5 }).success).toBe(false);
    expect(viewerSchema.safeParse(emptyViewer()).success).toBe(true);
    expect(viewerSchema.safeParse({ ...emptyViewer(), duration: Infinity }).success).toBe(false);
  });
  it('recognizes all six content categories and legacy PowerPoint', () => {
    expect(['picture.HEIC', 'deck.PPT', 'deck.pptx', 'paper.pdf', 'song.flac', 'clip.mov', 'notes.md'].map(kindFromName)).toEqual(['image', 'powerpoint', 'powerpoint', 'pdf', 'audio', 'video', 'markdown']);
    expect(kindFromName('program.exe')).toBeNull();
  });
  it('rejects renamed non-PDF payloads before parsing', async () => {
    const meta = { id: 'file', name: 'paper.pdf', type: 'application/pdf', size: 4, kind: 'pdf' as const };
    await expect(validateSignature(new Blob(['oops']), meta)).rejects.toThrow(/no coincide/);
    await expect(validateSignature(new Blob([pdfFixture()]), meta)).resolves.toBeUndefined();
  });
  it('validates a PPTX central directory and rejects corrupted archives', async () => {
    await expect(validatePowerpointZip(new Blob([pptxFixture()]))).resolves.toBeUndefined();
    await expect(validatePowerpointZip(new Blob(['PK\x03\x04broken']))).rejects.toThrow(/ZIP/);
    const bytes = pptxFixture();
    const directory = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(1_600_000_000, directory + 24);
    await expect(validatePowerpointZip(new Blob([bytes]))).rejects.toThrow(/memoria/);
  });
});
