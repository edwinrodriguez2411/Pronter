import { describe, expect, it } from 'vitest';
import { linkRequestSchema, normalizeLink } from '../shared/links';
import { catalog, describeMessage, formatMessage, translateText } from '../shared/messages';

describe('external content and language contracts', () => {
  it('normalizes supported YouTube links and start positions without trusting supplied providers', () => {
    for (const url of ['https://youtu.be/M7lc1UVf-VE', 'https://www.youtube.com/watch?v=M7lc1UVf-VE', 'https://www.youtube.com/shorts/M7lc1UVf-VE']) expect(normalizeLink(url, 'link').mediaId).toBe('M7lc1UVf-VE');
    expect(normalizeLink('https://youtu.be/M7lc1UVf-VE?t=1m30s', 'link').start).toBe(90);
    expect(normalizeLink('https://youtube.com.evil.example/watch?v=M7lc1UVf-VE', 'link').provider).toBe('web');
    expect(linkRequestSchema.safeParse({ id: 'link', url: 'https://example.com', provider: 'youtube' }).success).toBe(false);
  });
  it('preserves Vimeo privacy hashes and streams direct media without downloading it', () => {
    expect(normalizeLink('https://vimeo.com/76979871/abc123', 'link')).toMatchObject({ provider: 'vimeo', mediaId: '76979871', hash: 'abc123' });
    expect(normalizeLink('https://player.vimeo.com/video/76979871?h=abc123', 'link').hash).toBe('abc123');
    expect(normalizeLink('https://example.com/file.mp4?token=abc', 'link').provider).toBe('video');
    expect(normalizeLink('https://example.com/file.mp3', 'link').provider).toBe('audio');
  });
  it('rejects executable, credential-bearing, recursive, malformed and oversized links', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///C:/file', 'https://user:secret@example.com', 'not a URL', 'https://example.com/' + 'x'.repeat(2048)]) expect(() => normalizeLink(url, 'link')).toThrow();
    expect(() => normalizeLink('https://pronter.onrender.com/control', 'link', 'https://pronter.onrender.com')).toThrow(/externo/);
    expect(() => normalizeLink('https://youtu.be/invalid', 'link')).toThrow(/YouTube/);
  });
  it('provides all four languages and renders structured error messages and parameters', () => {
    for (const messages of Object.values(catalog)) for (const locale of ['es', 'en', 'pt', 'fr'] as const) expect(messages[locale].trim()).not.toBe('');
    expect(formatMessage(describeMessage('Elige un archivo no vacío de hasta 100 MB.'), 'en')).toContain('100 MB');
    expect(formatMessage(describeMessage('Reconectando · 12s'), 'fr')).toBe('Reconnexion · 12s');
    expect(translateText('Color azul', 'en')).toBe('Color blue');
    expect(translateText('Sesión terminada.', 'es')).toBe('Sesión terminada.');
    expect(translateText('Enviar un archivo', 'pt')).toBe('Enviar um arquivo');
    expect(formatMessage({ code: 'unknown' }, 'fr')).toBe(catalog.generic.fr);
  });
});
