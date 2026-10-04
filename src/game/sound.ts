import Phaser from "phaser";
import { EventBus } from "./main";
import { playSFX, setSoundMuted, isSoundMuted, SFX_PRESETS, SFXName } from "./audio";

export { playSFX, setSoundMuted, isSoundMuted, SFX_PRESETS };
export type { SFXName };

let currentBGM: Phaser.Sound.BaseSound | null = null;
let currentBGMKey: string | null = null;

/**
 * Play a looping background music track safely.
 * Automatically stops existing BGM to prevent audio layer leaking across scenes.
 */
export function playBGM(
    scene: Phaser.Scene,
    key: string,
    options: { volume?: number; loop?: boolean } = {}
): void {
    if (!scene || !scene.sound || !scene.cache.audio.exists(key)) return;

    if (currentBGMKey === key && currentBGM && currentBGM.isPlaying) {
        return; // Already playing this track
    }

    stopBGM();

    try {
        const bgm = scene.sound.add(key, {
            loop: options.loop ?? true,
            volume: options.volume ?? 0.5,
        });
        bgm.play();
        currentBGM = bgm;
        currentBGMKey = key;
    } catch {
        // Safe fallback for autoplay policy
    }
}

/**
 * Stop currently active background music.
 */
export function stopBGM(): void {
    if (currentBGM) {
        try {
            currentBGM.stop();
            currentBGM.destroy();
        } catch {}
        currentBGM = null;
        currentBGMKey = null;
    }
}

/**
 * Toggle audio mute across both procedural SFX and Phaser BGM tracks.
 * Emits "mute-toggled" with boolean flag.
 */
export function toggleMute(scene?: Phaser.Scene): boolean {
    const nextMuted = !isSoundMuted();
    setSoundMuted(nextMuted);

    if (scene && scene.sound) {
        scene.sound.setMute(nextMuted);
    }

    EventBus.emit("mute-toggled", nextMuted);
    return nextMuted;
}
