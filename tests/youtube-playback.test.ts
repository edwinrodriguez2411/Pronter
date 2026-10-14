import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YouTubePlayback, YOUTUBE_PLAY_TIMEOUT_MS } from '../src/lib/youtube-playback';
import type { ViewerState } from '../shared/protocol';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function setup(allowed = false) {
  const state = { value: 2, muted: false, volume: 100 };
  const player = {
    playVideo: vi.fn(), pauseVideo: vi.fn(() => { state.value = 2; }), getPlayerState: () => state.value,
    mute: vi.fn(() => { state.muted = true; }), unMute: vi.fn(() => { state.muted = false; }),
    isMuted: () => state.muted, getVolume: () => state.volume, setVolume: (value: number) => { state.volume = value; },
  };
  const view: Partial<ViewerState> = {};
  const playback = new YouTubePlayback(player, values => Object.assign(view, values), () => allowed);
  return { state, player, view, playback };
}
describe('YouTube first remote playback', () => {
  it('starts muted without host interaction and confirms playback only from actual state', () => {
    const { playback, state, player, view } = setup();
    playback.play(); expect(player.mute).toHaveBeenCalled(); expect(view).toMatchObject({ mediaPending: true, paused: true, volume: 0, needsActivation: true });
    playback.play(); expect(player.playVideo).toHaveBeenCalledTimes(1);
    state.value = 1; playback.sync(); expect(view).toMatchObject({ mediaPending: false, paused: false, volume: 0 }); expect(vi.getTimerCount()).toBe(0);
  });
  it('retries a blocked audible request in silence once and stops repeated refusals', () => {
    const { playback, player, view } = setup(true);
    playback.play(); playback.blocked(); expect(player.playVideo).toHaveBeenCalledTimes(2); expect(view.needsActivation).toBe(true);
    playback.blocked(); expect(player.playVideo).toHaveBeenCalledTimes(2); expect(view.mediaPending).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  it('enables sound immediately in the host gesture and reflects actual muted volume', () => {
    const { playback, player, state, view } = setup();
    playback.play(); expect(() => playback.setVolume(1)).toThrow(/Activar audio/); expect(player.unMute).not.toHaveBeenCalled();
    playback.play(true); state.value = 1; playback.sync(); expect(player.unMute).toHaveBeenCalled(); expect(view).toMatchObject({ paused: false, volume: 1, needsActivation: false, notice: '' });
    playback.pause(); playback.play(); expect(view.needsActivation).toBe(false); expect(() => playback.setVolume(0.5)).not.toThrow();
  });
  it('stops a stalled startup after eight seconds and permits another attempt', () => {
    const { playback, player, view } = setup(); playback.play(); vi.advanceTimersByTime(YOUTUBE_PLAY_TIMEOUT_MS);
    expect(view).toMatchObject({ mediaPending: false, paused: true }); expect(view.notice).toMatch(/no respondió/); expect(player.pauseVideo).toHaveBeenCalled();
    playback.play(); expect(view.mediaPending).toBe(true); playback.destroy(); expect(vi.getTimerCount()).toBe(0);
  });
  it('clears the audio warning when the actual player is unmuted directly on the computer', () => {
    const { playback, state, view } = setup(); playback.play(); state.value = 1; state.muted = false; playback.sync();
    expect(view).toMatchObject({ volume: 1, needsActivation: false, notice: '' }); expect(() => playback.setVolume(0.5)).not.toThrow();
  });
  it('does not restart playback from a late blocked event after pause or replacement', () => {
    const { playback, player } = setup(); playback.play(); playback.pause(); playback.blocked(); expect(player.playVideo).toHaveBeenCalledTimes(1);
    playback.play(); playback.destroy(); playback.blocked(); vi.advanceTimersByTime(YOUTUBE_PLAY_TIMEOUT_MS); expect(player.playVideo).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
});
