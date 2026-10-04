import Phaser from "phaser";

export type FXType = "spark" | "dust" | "explosion" | "collect" | "smoke" | "ring";

export interface FXOptions {
    count?: number;
    tint?: number;
    scale?: number;
    speed?: number;
    lifespan?: number;
}

const TEXTURES = {
    dust: "__fx_dust",
    spark: "__fx_spark",
    smoke: "__fx_smoke",
    star: "__fx_star",
};

/**
 * Initialize procedural particle textures if they don"t exist yet.
 * Call once inside Scene create() or preload(). Zero external image assets required.
 */
export function initFX(scene: Phaser.Scene): void {
    if (!scene || !scene.textures) return;

    if (!scene.textures.exists(TEXTURES.dust)) {
        const g = scene.make.graphics({ x: 0, y: 0 });
        g.fillStyle(0xffffff, 1);
        g.fillCircle(4, 4, 4);
        g.generateTexture(TEXTURES.dust, 8, 8);
        g.destroy();
    }

    if (!scene.textures.exists(TEXTURES.spark)) {
        const g = scene.make.graphics({ x: 0, y: 0 });
        g.fillStyle(0xffffff, 1);
        g.fillTriangle(4, 0, 8, 4, 0, 4);
        g.fillTriangle(4, 8, 8, 4, 0, 4);
        g.generateTexture(TEXTURES.spark, 8, 8);
        g.destroy();
    }

    if (!scene.textures.exists(TEXTURES.smoke)) {
        const g = scene.make.graphics({ x: 0, y: 0 });
        g.fillStyle(0xffffff, 0.8);
        g.fillCircle(8, 8, 8);
        g.generateTexture(TEXTURES.smoke, 16, 16);
        g.destroy();
    }

    if (!scene.textures.exists(TEXTURES.star)) {
        const g = scene.make.graphics({ x: 0, y: 0 });
        g.fillStyle(0xffffff, 1);
        g.fillRect(2, 0, 4, 8);
        g.fillRect(0, 2, 8, 4);
        g.generateTexture(TEXTURES.star, 8, 8);
        g.destroy();
    }
}

/**
 * Emit a particle burst at (x, y) with one line.
 * Automatically initializes textures and self-destroys the emitter after lifespan.
 */
export function emitFX(
    scene: Phaser.Scene,
    effect: FXType,
    x: number,
    y: number,
    options: FXOptions = {}
): void {
    if (!scene || !scene.add || !scene.textures) return;
    initFX(scene);

    const count = options.count ?? (effect === "explosion" ? 20 : effect === "collect" ? 12 : 8);
    const tint = options.tint ?? (
        effect === "explosion" ? 0xff6600 :
        effect === "collect" ? 0xffdd00 :
        effect === "spark" ? 0xffee88 :
        effect === "smoke" ? 0xaaaaaa : 0xffffff
    );
    const scale = options.scale ?? 1;
    const speed = options.speed ?? (effect === "explosion" ? 160 : 80);
    const lifespan = options.lifespan ?? (effect === "smoke" ? 600 : 400);

    const texture = effect === "spark" ? TEXTURES.spark :
                    effect === "smoke" ? TEXTURES.smoke :
                    effect === "collect" ? TEXTURES.star : TEXTURES.dust;

    try {
        const emitter = scene.add.particles(x, y, texture, {
            speed: { min: speed * 0.3, max: speed },
            scale: { start: scale, end: 0 },
            alpha: { start: 1, end: 0 },
            tint,
            lifespan,
            emitting: false,
        });
        emitter.setDepth(30);
        emitter.explode(count);

        scene.time.delayedCall(lifespan + 50, () => {
            if (emitter && emitter.destroy) emitter.destroy();
        });
    } catch {
        // Safe fallback if particles plugin is not available
    }
}
