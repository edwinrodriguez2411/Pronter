import { emptyViewer, type Command, type LinkSource, type ViewerState } from '../../shared/protocol';
import type { ViewerEngine } from './engine';

interface YouTubePlayer {
  playVideo(): void; pauseVideo(): void; destroy(): void; seekTo(value: number, allow: boolean): void;
  getCurrentTime(): number; getDuration(): number; getVolume(): number; getPlayerState(): number;
  setVolume(value: number): void; getPlaybackRate(): number; setPlaybackRate(value: number): void;
  getAvailablePlaybackRates(): number[];
}
interface YouTubeApi { Player: new (element: HTMLElement, options: object) => YouTubePlayer }
declare global { interface Window { YT?: YouTubeApi; onYouTubeIframeAPIReady?: () => void } }
let youtubeApi: Promise<YouTubeApi> | undefined;
function loadYouTube() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return youtubeApi ??= new Promise<YouTubeApi>((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api'; script.referrerPolicy = 'strict-origin';
    const previous = window.onYouTubeIframeAPIReady;
    const timer = setTimeout(() => done(new Error('El reproductor no respondió. Intenta de nuevo.')), 15000);
    const done = (error?: Error) => {
      clearTimeout(timer); window.onYouTubeIframeAPIReady = previous;
      if (error || !window.YT?.Player) { script.remove(); youtubeApi = undefined; reject(error || new Error('El reproductor no respondió. Intenta de nuevo.')); }
      else resolve(window.YT);
    };
    window.onYouTubeIframeAPIReady = () => { previous?.(); done(); };
    script.onerror = () => done(new Error('No se pudo cargar el reproductor. Revisa la conexión.'));
    document.head.append(script);
  });
}

export async function createLinkViewer(source: LinkSource, layer: HTMLElement, signal: AbortSignal, publish: (state: ViewerState) => void): Promise<ViewerEngine> {
  const state = { ...emptyViewer(), assetId: source.id, name: source.provider === 'web' ? new URL(source.url).hostname : `${source.provider === 'youtube' ? 'YouTube' : source.provider === 'vimeo' ? 'Vimeo' : source.provider === 'audio' ? 'Audio' : 'Video'} · ${new URL(source.url).hostname}`, kind: source.provider === 'web' ? null : source.provider === 'audio' ? 'audio' : 'video', link: source } as ViewerState;
  let alive = true;
  const cleanups: (() => void)[] = [];
  const update = (values: Partial<ViewerState> = {}) => { if (alive) { Object.assign(state, values); publish({ ...state, capabilities: [...state.capabilities] }); } };
  const frame = document.createElement('div'); frame.className = `content-frame content-link ${source.provider === 'web' ? 'content-web' : ''}`; layer.append(frame);
  const timeout = new AbortController();
  const abort = () => timeout.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => timeout.abort(new Error('El reproductor no respondió. Intenta de nuevo.')), 15000);
  const bounded = <T,>(task: Promise<T>) => new Promise<T>((resolve, reject) => {
    const stop = () => reject(timeout.signal.reason);
    if (timeout.signal.aborted) stop(); else timeout.signal.addEventListener('abort', stop, { once: true });
    task.then(resolve, reject).finally(() => timeout.signal.removeEventListener('abort', stop));
  });
  const operation = <T,>(task: Promise<T>) => new Promise<T>((resolve, reject) => {
    const cleanup = () => { clearTimeout(clock); timeout.signal.removeEventListener('abort', stop); };
    const stop = () => { cleanup(); reject(timeout.signal.reason || new DOMException('Operación cancelada', 'AbortError')); };
    const clock = setTimeout(() => { cleanup(); reject(new Error('El reproductor no respondió. Intenta de nuevo.')); }, 10000);
    if (timeout.signal.aborted) { cleanup(); stop(); return; }
    timeout.signal.addEventListener('abort', stop, { once: true });
    task.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
  const unavailable = () => update({ notice: 'Este vídeo no está disponible o no permite incrustarse. Abre el enlace en el PC.', capabilities: [], mediaActions: [], paused: true, needsActivation: false });
  let specific: (command: Command) => Promise<void> = async () => {};
  let activate = async () => {};
  const engine: ViewerEngine = {
    state,
    async command(command) {
      if (!alive) return;
      if (command.type === 'black') { update({ black: Boolean(command.value) }); return; }
      if (['seek', 'volume', 'rate'].includes(command.type) && !state.mediaActions?.includes(command.type as 'seek' | 'volume' | 'rate')) throw new Error('Este reproductor no permite ese control.');
      await specific(command);
    },
    async activate() { await activate(); },
    destroy() { alive = false; clearTimeout(timer); timeout.abort(); signal.removeEventListener('abort', abort); signal.removeEventListener('abort', destroy); for (const cleanup of cleanups.splice(0).reverse()) { try { cleanup(); } catch {} } layer.remove(); },
  };
  const destroy = () => engine.destroy(); signal.addEventListener('abort', destroy, { once: true });
  if (signal.aborted) { engine.destroy(); signal.throwIfAborted(); }
  const playerFrame = (src: string) => {
    const iframe = document.createElement('iframe'); iframe.src = src; iframe.title = state.name; iframe.referrerPolicy = 'strict-origin';
    iframe.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups'); iframe.allowFullscreen = true; frame.append(iframe);
    return iframe;
  };
  try {
    if (source.provider === 'web') {
      if (source.url.startsWith('https:')) playerFrame(source.url);
      state.notice = 'Esta página se controla desde el PC. Si no aparece, pulsa «Abrir fuera». Pronter no controla pestañas externas.';
      update();
    } else if (source.provider === 'youtube') {
      const api = await bounded(loadYouTube()); signal.throwIfAborted();
      const iframe = playerFrame(`https://www.youtube-nocookie.com/embed/${source.mediaId}?enablejsapi=1&origin=${encodeURIComponent(location.origin)}&playsinline=1&start=${source.start || 0}&hl=${document.documentElement.lang}`);
      let player!: YouTubePlayer;
      await bounded(new Promise<void>((resolve, reject) => {
        player = new api.Player(iframe, { events: {
          onReady: () => resolve(),
          onError: () => { const error = new Error('Este vídeo no está disponible o no permite incrustarse. Abre el enlace en el PC.'); if (state.capabilities.includes('media')) unavailable(); reject(error); },
          onAutoplayBlocked: () => update({ needsActivation: true, paused: true, notice: 'Toca «Activar audio» en la pantalla del computador y vuelve a reproducir.' }),
        } });
        cleanups.push(() => player.destroy());
      }));
      state.capabilities = ['media']; state.mediaActions = ['seek', 'volume', ...(player.getAvailablePlaybackRates().length > 1 ? ['rate' as const] : [])];
      const sync = () => {
        if (!alive) return;
        const duration = player.getDuration() || 0;
        update({ duration: Number.isFinite(duration) ? duration : 0, currentTime: player.getCurrentTime() || 0, paused: player.getPlayerState() !== 1, volume: player.getVolume() / 100, rate: player.getPlaybackRate() || 1 });
      };
      const poll = setInterval(sync, 500); cleanups.push(() => clearInterval(poll));
      activate = async () => { player.playVideo(); update({ needsActivation: false, notice: '' }); };
      specific = async (command) => {
        if (command.type === 'play') await activate();
        if (command.type === 'pause') player.pauseVideo();
        if (command.type === 'seek') player.seekTo(Number(command.value), true);
        if (command.type === 'volume') player.setVolume(Number(command.value) * 100);
        if (command.type === 'rate') player.setPlaybackRate(Number(command.value));
        sync();
      }; sync();
    } else if (source.provider === 'vimeo') {
      const { default: Player } = await bounded(import('@vimeo/player')); signal.throwIfAborted();
      const iframe = playerFrame(`https://player.vimeo.com/video/${source.mediaId}?dnt=1${source.hash ? `&h=${source.hash}` : ''}`);
      const player = new Player(iframe); cleanups.push(() => { void player.destroy().catch(() => {}); });
      let prepared = false;
      const playerError = (error: { name?: string; method?: string }) => {
        if (error.name === 'NotAllowedError') update({ needsActivation: true, paused: true, notice: 'Toca «Activar audio» en la pantalla del computador y vuelve a reproducir.' });
        else if (error.method === 'setPlaybackRate' && error.name === 'UnsupportedError') update({ mediaActions: state.mediaActions?.filter(action => action !== 'rate') });
        else if (!error.method || error.method === 'play' || ['PrivacyError', 'PasswordError'].includes(error.name || '')) {
          if (!prepared) timeout.abort(new Error('Este vídeo no está disponible o no permite incrustarse. Abre el enlace en el PC.'));
          else unavailable();
        }
      };
      player.on('error', playerError); cleanups.push(() => player.off('error', playerError));
      await bounded(player.ready());
      state.capabilities = ['media']; state.mediaActions = ['seek', 'volume'];
      try { const rate = await bounded(player.getPlaybackRate()); await bounded(player.setPlaybackRate(rate)); state.mediaActions.push('rate'); } catch { timeout.signal.throwIfAborted(); }
      const sync = async () => {
        const [duration, currentTime, paused, volume, rate] = await operation(Promise.all([player.getDuration(), player.getCurrentTime(), player.getPaused(), player.getVolume(), player.getPlaybackRate().catch(() => 1)]));
        update({ duration: Number.isFinite(duration) ? duration : 0, currentTime, paused, volume, rate });
      };
      let polling = false;
      const poll = setInterval(() => {
        if (!polling && alive && state.capabilities.includes('media')) {
          polling = true;
          void sync().catch(() => update({ notice: 'El reproductor no respondió. Intenta de nuevo.', capabilities: [], mediaActions: [], needsActivation: false })).finally(() => { polling = false; });
        }
      }, 500); cleanups.push(() => clearInterval(poll));
      activate = async () => {
        try { await operation(player.play()); if (state.capabilities.includes('media')) update({ needsActivation: false, notice: '' }); }
        catch (error) {
          if (error instanceof Error && error.name === 'NotAllowedError') { update({ needsActivation: true, paused: true }); throw new Error('Toca «Activar audio» en la pantalla del computador y vuelve a reproducir.'); }
          if (error instanceof Error && error.message === 'El reproductor no respondió. Intenta de nuevo.') throw error;
          unavailable(); throw new Error(state.notice);
        }
      };
      specific = async (command) => {
        if (command.type === 'play') await activate();
        if (command.type === 'pause') await operation(player.pause());
        if (command.type === 'seek') await operation(player.setCurrentTime(Number(command.value)));
        if (command.type === 'volume') await operation(player.setVolume(Number(command.value)));
        if (command.type === 'rate') await operation(player.setPlaybackRate(Number(command.value)));
        await sync();
      }; await bounded(sync()); prepared = true;
    } else {
      if (!source.url.startsWith('https:') && location.protocol === 'https:') throw new Error('Este enlace necesita HTTPS para reproducirse aquí. Abre el enlace en el PC.');
      const media = document.createElement(source.provider === 'audio' ? 'audio' : 'video'); media.controls = true; media.preload = 'metadata'; media.setAttribute('playsinline', ''); frame.append(media);
      cleanups.push(() => { media.pause(); media.removeAttribute('src'); media.load(); });
      await bounded(new Promise<void>((resolve, reject) => {
        media.onloadedmetadata = () => resolve();
        media.onerror = () => {
          const error = new Error('No se pudo reproducir este enlace. Abre el enlace en el PC.');
          if (state.capabilities.includes('media')) update({ notice: error.message, capabilities: [], mediaActions: [], needsActivation: false });
          reject(error);
        };
        media.src = source.url;
      }));
      state.capabilities = ['media']; state.mediaActions = ['volume', 'rate', ...(Number.isFinite(media.duration) ? ['seek' as const] : [])];
      const sync = () => update({ duration: Number.isFinite(media.duration) ? media.duration : 0, currentTime: media.currentTime || 0, paused: media.paused, volume: media.muted ? 0 : media.volume, rate: media.playbackRate });
      for (const event of ['play', 'pause', 'timeupdate', 'volumechange', 'ratechange', 'durationchange']) media.addEventListener(event, sync);
      cleanups.push(() => { for (const event of ['play', 'pause', 'timeupdate', 'volumechange', 'ratechange', 'durationchange']) media.removeEventListener(event, sync); media.onloadedmetadata = media.onerror = null; });
      activate = async () => { try { await media.play(); update({ needsActivation: false, notice: '' }); } catch { update({ needsActivation: true }); throw new Error('Toca «Activar audio» en la pantalla del computador y vuelve a reproducir.'); } };
      specific = async (command) => { if (command.type === 'play') await activate(); if (command.type === 'pause') media.pause(); if (command.type === 'seek') media.currentTime = Number(command.value); if (command.type === 'volume') { media.muted = false; media.volume = Number(command.value); } if (command.type === 'rate') media.playbackRate = Number(command.value); sync(); }; sync();
    }
    signal.throwIfAborted(); update(); clearTimeout(timer); return engine;
  } catch (error) { engine.destroy(); throw error; }
}
