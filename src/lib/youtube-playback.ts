import type { ViewerState } from '../../shared/protocol';

export interface YouTubePlaybackApi {
  playVideo(): void; pauseVideo(): void; getPlayerState(): number;
  mute(): void; unMute(): void; isMuted(): boolean; getVolume(): number; setVolume(value: number): void;
}
export const YOUTUBE_PLAY_TIMEOUT_MS = 8000;
const audioHint = 'Se inicia sin sonido porque el navegador requiere un clic en el PC. Pulsa «Activar audio» para escucharlo.';
const blockedHint = 'Toca «Activar audio» en la pantalla del computador y vuelve a reproducir.';

/** YouTube playVideo returns void; only the player's state confirms playback. */
export class YouTubePlayback {
  private pending = false;
  private requested = false;
  private fallback = false;
  private silentForPermission = false;
  private audioEnabled = false;
  private disposed = false;
  private notice = '';
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private player: YouTubePlaybackApi, private publish: (state: Partial<ViewerState>) => void, private audioAllowed: () => boolean) {}
  private clear() { clearTimeout(this.timer); this.timer = undefined; }
  play(fromHost = false) {
    if (this.disposed || this.pending && !fromHost) return;
    this.clear(); this.requested = true; this.pending = true; this.fallback = false;
    if (fromHost) { this.player.unMute(); this.silentForPermission = false; this.audioEnabled = true; }
    else if (!this.audioEnabled && !this.audioAllowed()) { this.player.mute(); this.silentForPermission = true; this.fallback = true; }
    else if (this.silentForPermission) { this.player.unMute(); this.silentForPermission = false; }
    this.notice = this.silentForPermission ? audioHint : '';
    this.timer = setTimeout(() => {
      if (this.player.getPlayerState() === 1) { this.sync(); return; }
      this.pending = false; this.requested = false; this.clear(); this.player.pauseVideo();
      this.notice = 'El reproductor no respondió. Intenta de nuevo.'; this.sync();
    }, YOUTUBE_PLAY_TIMEOUT_MS);
    this.player.playVideo(); this.sync();
  }
  blocked() {
    if (this.disposed || !this.requested) return;
    if (this.player.getPlayerState() === 1) { this.sync(); return; }
    this.silentForPermission = true;
    this.audioEnabled = false;
    if (!this.fallback) {
      this.fallback = true; this.notice = audioHint; this.player.mute(); this.player.playVideo();
    } else {
      this.pending = false; this.requested = false; this.clear(); this.notice = blockedHint;
    }
    this.sync();
  }
  pause() {
    if (this.disposed) return;
    this.pending = false; this.requested = false; this.clear(); this.player.pauseVideo(); this.sync();
  }
  setVolume(value: number) {
    if (this.disposed) return;
    if (value > 0 && !this.audioEnabled && !this.audioAllowed()) { this.notice = audioHint; this.silentForPermission = true; this.sync(); throw new Error(blockedHint); }
    this.player.setVolume(value * 100);
    if (value > 0) this.player.unMute(); else this.player.mute();
    this.silentForPermission = false; this.notice = ''; this.sync();
  }
  sync() {
    if (this.disposed) return;
    const playing = this.player.getPlayerState() === 1;
    const muted = this.player.isMuted();
    if (playing && this.pending) { this.pending = false; this.clear(); }
    if (playing && !muted && this.silentForPermission) {
      this.silentForPermission = false; this.audioEnabled = true;
      if (this.notice === audioHint || this.notice === blockedHint) this.notice = '';
    }
    this.publish({ paused: !playing, mediaPending: this.pending, needsActivation: this.silentForPermission, notice: this.notice, volume: muted ? 0 : this.player.getVolume() / 100 });
  }
  destroy() { this.disposed = true; this.pending = false; this.requested = false; this.clear(); }
}
