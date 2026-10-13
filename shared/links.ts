import { z } from 'zod';
import type { LinkSource } from './protocol';

export const linkRequestSchema = z.object({ id: z.string().min(1).max(100), url: z.string().min(1).max(2048) }).strict();
export function normalizeLink(raw: string, id: string, appOrigin?: string): LinkSource {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error('Escribe un enlace HTTP o HTTPS válido.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) throw new Error('Escribe un enlace HTTP o HTTPS válido, sin contraseñas.');
  if (appOrigin && url.origin === appOrigin) throw new Error('Elige un enlace externo a Pronter.');
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'youtu.be'].includes(host)) {
    const mediaId = host === 'youtu.be' ? url.pathname.split('/')[1] : url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
    if (!mediaId || !/^[\w-]{11}$/.test(mediaId)) throw new Error('Este enlace de YouTube no identifica un vídeo válido.');
    const time = url.searchParams.get('t') || url.searchParams.get('start') || '';
    const start = /^\d+$/.test(time) ? Number(time) : [...time.matchAll(/(\d+)(h|m|s)/g)].reduce((seconds, match) => seconds + Number(match[1]) * ({ h: 3600, m: 60, s: 1 }[match[2]] || 0), 0);
    return { id, provider: 'youtube', url: `https://www.youtube.com/watch?v=${mediaId}`, mediaId, start: Math.min(start, 864000) };
  }
  if (['vimeo.com', 'player.vimeo.com'].includes(host)) {
    const match = url.pathname.match(/\/(\d+)(?:\/([a-zA-Z0-9]+))?\/?$/);
    if (!match) throw new Error('Este enlace de Vimeo no identifica un vídeo válido.');
    const hash = url.searchParams.get('h') || match[2];
    if (hash && !/^[a-zA-Z0-9]{1,100}$/.test(hash)) throw new Error('Este enlace de Vimeo no identifica un vídeo válido.');
    return { id, provider: 'vimeo', mediaId: match[1], ...(hash ? { hash } : {}), url: `https://vimeo.com/${match[1]}${hash ? `/${hash}` : ''}` };
  }
  const ext = url.pathname.split('.').at(-1)?.toLowerCase();
  const provider = ['mp4', 'webm', 'mov'].includes(ext || '') ? 'video' : ['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac', 'opus'].includes(ext || '') ? 'audio' : 'web';
  return { id, url: url.href, provider };
}
