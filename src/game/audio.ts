// @ts-ignore
import { zzfx } from 'zzfx';

/**
 * Procedural retro sound presets powered by ZzFX.
 * Zero external audio files required. Safe across all browsers.
 */
export const SFX_PRESETS = {
    jump: [1, 0.05, 300, 0.04, 0.1, 0.2, 1, 1.8],
    coin: [1, 0.05, 800, 0.02, 0.05, 0.1, 1, 2.5],
    hit: [1, 0.1, 120, 0.05, 0.15, 0.3, 3, 0.5],
    explosion: [2, 0.2, 80, 0.1, 0.4, 0.5, 4, 0.2],
    laser: [1, 0.05, 600, 0.01, 0.08, 0.2, 1, 0.2],
    powerup: [1, 0.05, 440, 0.05, 0.2, 0.4, 1, 3.0],
    win: [1, 0.05, 523, 0.1, 0.3, 0.6, 1, 1.5],
    gameover: [1, 0.1, 220, 0.15, 0.4, 0.6, 2, 0.3],
    // Bingo room presets
    ball: [1.1, 0.05, 180, 0.02, 0.08, 0.15, 1, 0.9],
    daub: [0.9, 0.04, 520, 0.01, 0.03, 0.1, 1, 1.7],
    tick: [0.8, 0.02, 880, 0.01, 0.02, 0.07, 1, 1.2],
    error: [1.2, 0.1, 140, 0.05, 0.15, 0.3, 3, 0.4],
    bingo: [1.3, 0.08, 660, 0.08, 0.3, 0.5, 1, 2.4],
} as const;

export type SFXName = keyof typeof SFX_PRESETS;

let soundMuted = false;

export function setSoundMuted(muted: boolean): void {
    soundMuted = muted;
}

export function isSoundMuted(): boolean {
    return soundMuted;
}

/**
 * Play a procedural sound effect.
 */
export function playSFX(name: SFXName, volume = 1.0): void {
    if (soundMuted || typeof window === 'undefined') return;
    const preset = SFX_PRESETS[name];
    if (!preset) return;

    try {
        const sound = [...preset] as number[];
        sound[0] = (sound[0] ?? 1) * volume;
        (zzfx as any)(...sound);
    } catch {
        // Silently handle autoplay restrictions before user gesture
    }
}