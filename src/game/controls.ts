import Phaser from 'phaser';

export interface PlayerInput {
    left: boolean;
    right: boolean;
    up: boolean;
    down: boolean;
    jump: boolean;
    action: boolean;
    secondary: boolean;
    force: number;
    angle: number;
}

export interface ControlsOptions {
    joystickRadius?: number;
    joystickX?: number;
    joystickY?: number;
    hasActionButton?: boolean;
    actionButtonText?: string;
    hasJumpButton?: boolean;
    jumpButtonText?: string;
    hasSecondaryButton?: boolean;
    secondaryButtonText?: string;
    forceVisible?: boolean;
}

/**
 * Lightweight, zero-dependency Virtual Joystick for Phaser 4 ESM.
 * Replaces legacy phaser3-rex-plugins to eliminate runtime ReferenceErrors.
 */
class NativeVirtualJoystick {
    public base: any;
    public thumb: any;
    public radius: number;
    public force: number = 0;
    public angle: number = 0;
    public forceX: number = 0;
    public forceY: number = 0;
    public visible: boolean = true;
    public enable: boolean = true;
    private scene: Phaser.Scene;
    private pointer: Phaser.Input.Pointer | null = null;
    private cursors: {
        left: { isDown: boolean };
        right: { isDown: boolean };
        up: { isDown: boolean };
        down: { isDown: boolean };
    };

    constructor(scene: Phaser.Scene, config: {
        x: number;
        y: number;
        radius: number;
        base: any;
        thumb: any;
        dir?: string;
        fixed?: boolean;
        forceMin?: number;
    }) {
        this.scene = scene;
        this.radius = config.radius || 60;
        this.base = config.base;
        this.thumb = config.thumb;
        this.base.setPosition(config.x, config.y);
        this.thumb.setPosition(config.x, config.y);
        this.cursors = {
            left: { isDown: false },
            right: { isDown: false },
            up: { isDown: false },
            down: { isDown: false },
        };

        this.base.setInteractive(
            new Phaser.Geom.Circle(this.radius, this.radius, this.radius * 1.25),
            Phaser.Geom.Circle.Contains
        );

        this.base.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            if (!this.enable || this.pointer) return;
            this.pointer = pointer;
            this.updateFromPointer(pointer);
        });

        scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
            if (this.pointer === pointer) {
                this.updateFromPointer(pointer);
            }
        });

        const release = (pointer: Phaser.Input.Pointer) => {
            if (this.pointer === pointer) {
                this.pointer = null;
                this.reset();
            }
        };
        scene.input.on('pointerup', release);
        scene.input.on('pointerupoutside', release);
    }

    private updateFromPointer(pointer: Phaser.Input.Pointer) {
        const dx = pointer.x - this.base.x;
        const dy = pointer.y - this.base.y;
        const dist = Math.hypot(dx, dy);
        const clampedDist = Math.min(dist, this.radius);
        const rad = Math.atan2(dy, dx);

        this.thumb.setPosition(
            this.base.x + Math.cos(rad) * clampedDist,
            this.base.y + Math.sin(rad) * clampedDist
        );

        this.force = dist;
        this.forceX = dx;
        this.forceY = dy;
        this.angle = (rad * 180) / Math.PI;

        const threshold = 12;
        this.cursors.left.isDown = dx < -threshold;
        this.cursors.right.isDown = dx > threshold;
        this.cursors.up.isDown = dy < -threshold;
        this.cursors.down.isDown = dy > threshold;
    }

    private reset() {
        this.thumb.setPosition(this.base.x, this.base.y);
        this.force = 0;
        this.forceX = 0;
        this.forceY = 0;
        this.cursors.left.isDown = false;
        this.cursors.right.isDown = false;
        this.cursors.up.isDown = false;
        this.cursors.down.isDown = false;
    }

    public createCursorKeys() {
        return this.cursors;
    }

    public setVisible(v: boolean) {
        this.visible = v;
        if (this.base) this.base.setVisible(v);
        if (this.thumb) this.thumb.setVisible(v);
    }

    public setEnable(e: boolean) {
        this.enable = e;
        if (!e) this.reset();
    }

    public destroy() {
        this.reset();
        if (this.base) this.base.destroy();
        if (this.thumb) this.thumb.destroy();
    }
}

/**
 * Universal Mobile & Desktop Controller.
 * Automatically unifies Keyboard (WASD + Arrows + Space) with Rex Virtual Joystick.
 * Guaranteed to work on mobile touchscreens and desktop browsers alike.
 */
export class GameControls {
    private scene: Phaser.Scene;
    private joystick: any = null;
    private joystickCursors: any = null;
    private keyboardKeys: any = null;
    private actionButton: Phaser.GameObjects.Container | null = null;
    private jumpButton: Phaser.GameObjects.Container | null = null;
    private secondaryButton: Phaser.GameObjects.Container | null = null;
    private isActionPressed: boolean = false;
    private isJumpPressed: boolean = false;
    private isSecondaryPressed: boolean = false;
    private visible: boolean = true;
    private touchRevealListener: ((pointer: Phaser.Input.Pointer) => void) | null = null;

    constructor(scene: Phaser.Scene, options: ControlsOptions = {}) {
        this.scene = scene;

        // Ensure multi-touch support for simultaneous movement and action/jump buttons
        const inputAny = scene.input as unknown as {
            pointersTotal?: number;
            addPointer?: (count: number) => void;
        };
        if (inputAny && (inputAny.pointersTotal ?? 1) < 3) {
            inputAny.addPointer?.(2);
        }

        // 1. Setup Desktop Keyboard
        if (scene.input && scene.input.keyboard) {
            this.keyboardKeys = scene.input.keyboard.addKeys({
                up: Phaser.Input.Keyboard.KeyCodes.UP,
                down: Phaser.Input.Keyboard.KeyCodes.DOWN,
                left: Phaser.Input.Keyboard.KeyCodes.LEFT,
                right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
                w: Phaser.Input.Keyboard.KeyCodes.W,
                s: Phaser.Input.Keyboard.KeyCodes.S,
                a: Phaser.Input.Keyboard.KeyCodes.A,
                d: Phaser.Input.Keyboard.KeyCodes.D,
                space: Phaser.Input.Keyboard.KeyCodes.SPACE,
                enter: Phaser.Input.Keyboard.KeyCodes.ENTER,
                shift: Phaser.Input.Keyboard.KeyCodes.SHIFT,
                j: Phaser.Input.Keyboard.KeyCodes.J,
                k: Phaser.Input.Keyboard.KeyCodes.K,
                l: Phaser.Input.Keyboard.KeyCodes.L,
                f: Phaser.Input.Keyboard.KeyCodes.F,
                x: Phaser.Input.Keyboard.KeyCodes.X,
                c: Phaser.Input.Keyboard.KeyCodes.C,
            });
        }

        // 2. Setup Mobile Touch Joystick
        const isTouch = 'ontouchstart' in window || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
        const width = scene.scale.width;
        const height = scene.scale.height;

        const radius = options.joystickRadius ?? 60;
        const jx = options.joystickX ?? radius + 30;
        const jy = options.joystickY ?? height - radius - 30;

        // Base & Thumb graphics
        const base = scene.add.circle(0, 0, radius, 0x888888, 0.4);
        base.setStrokeStyle(2, 0xffffff, 0.6);
        base.setScrollFactor(0);
        base.setDepth(9999);

        const thumb = scene.add.circle(0, 0, radius * 0.45, 0xcccccc, 0.8);
        thumb.setStrokeStyle(2, 0xffffff, 0.9);
        thumb.setScrollFactor(0);
        thumb.setDepth(10000);

        this.joystick = new NativeVirtualJoystick(scene, {
            x: jx,
            y: jy,
            radius,
            base,
            thumb,
            dir: '8dir',
            fixed: true,
            forceMin: 10,
        });

        this.joystickCursors = this.joystick.createCursorKeys();

        // 3. Optional Mobile Primary Action Button (Bottom-Right)
        const hasAction = options.hasActionButton ?? true;
        const hasJump = options.hasJumpButton ?? false;
        const hasSecondary = options.hasSecondaryButton ?? false;

        if (hasAction) {
            const btnRadius = 42;
            const btnX = width - btnRadius - 35;
            const btnY = height - btnRadius - 35;

            const btnBg = scene.add.circle(0, 0, btnRadius, 0x028af8, 0.6);
            btnBg.setStrokeStyle(2, 0xffffff, 0.8);

            const btnText = scene.add.text(0, 0, options.actionButtonText ?? 'A', {
                fontFamily: 'Arial',
                fontSize: (options.actionButtonText && options.actionButtonText.length > 5) ? '14px' : '18px',
                color: '#ffffff',
                fontStyle: 'bold',
            }).setOrigin(0.5);

            this.actionButton = scene.add.container(btnX, btnY, [btnBg, btnText]);
            this.actionButton.setScrollFactor(0);
            this.actionButton.setDepth(10000);
            this.actionButton.setSize(btnRadius * 2, btnRadius * 2);
            // In Phaser, Container origin is (0, 0) and children are centered at (0, 0).
            // Hit area circle must be centered at (0, 0) with touch padding:
            this.actionButton.setInteractive(
                new Phaser.Geom.Circle(0, 0, btnRadius * 1.25),
                Phaser.Geom.Circle.Contains
            );

            this.actionButton.on('pointerdown', () => {
                const isJumpOnly = !hasJump && /jump|up/i.test(options.actionButtonText ?? '');
                if (isJumpOnly) {
                    this.isJumpPressed = true;
                } else {
                    this.isActionPressed = true;
                }
                btnBg.setFillStyle(0x0ec3c9, 0.9);
            });

            const releaseAction = () => {
                this.isActionPressed = false;
                if (!hasJump) this.isJumpPressed = false;
                btnBg.setFillStyle(0x028af8, 0.6);
            };

            this.actionButton.on('pointerup', releaseAction);
            this.actionButton.on('pointerout', releaseAction);
        }

        // 4. Optional Dedicated Mobile Jump Button (Placed to the left of Action Button)
        if (hasJump) {
            const jbtnRadius = 42;
            const jbtnX = width - jbtnRadius - (hasAction ? 125 : 35);
            const jbtnY = height - jbtnRadius - 35;

            const jbtnBg = scene.add.circle(0, 0, jbtnRadius, 0x10b981, 0.6);
            jbtnBg.setStrokeStyle(2, 0xffffff, 0.8);

            const jbtnText = scene.add.text(0, 0, options.jumpButtonText ?? 'JUMP', {
                fontFamily: 'Arial',
                fontSize: (options.jumpButtonText && options.jumpButtonText.length > 5) ? '13px' : '16px',
                color: '#ffffff',
                fontStyle: 'bold',
            }).setOrigin(0.5);

            this.jumpButton = scene.add.container(jbtnX, jbtnY, [jbtnBg, jbtnText]);
            this.jumpButton.setScrollFactor(0);
            this.jumpButton.setDepth(10000);
            this.jumpButton.setSize(jbtnRadius * 2, jbtnRadius * 2);
            this.jumpButton.setInteractive(
                new Phaser.Geom.Circle(0, 0, jbtnRadius * 1.25),
                Phaser.Geom.Circle.Contains
            );

            this.jumpButton.on('pointerdown', () => {
                this.isJumpPressed = true;
                jbtnBg.setFillStyle(0x34d399, 0.9);
            });

            const releaseJump = () => {
                this.isJumpPressed = false;
                jbtnBg.setFillStyle(0x10b981, 0.6);
            };

            this.jumpButton.on('pointerup', releaseJump);
            this.jumpButton.on('pointerout', releaseJump);
        }

        // 5. Optional Dedicated Mobile Secondary Button (Placed above Jump/Action)
        if (hasSecondary) {
            const sbtnRadius = 38;
            const sbtnX = width - sbtnRadius - (hasAction && hasJump ? 80 : 35);
            const sbtnY = height - sbtnRadius - 120;

            const sbtnBg = scene.add.circle(0, 0, sbtnRadius, 0xeab308, 0.6);
            sbtnBg.setStrokeStyle(2, 0xffffff, 0.8);

            const sbtnText = scene.add.text(0, 0, options.secondaryButtonText ?? 'SPECIAL', {
                fontFamily: 'Arial',
                fontSize: (options.secondaryButtonText && options.secondaryButtonText.length > 5) ? '11px' : '14px',
                color: '#ffffff',
                fontStyle: 'bold',
            }).setOrigin(0.5);

            this.secondaryButton = scene.add.container(sbtnX, sbtnY, [sbtnBg, sbtnText]);
            this.secondaryButton.setScrollFactor(0);
            this.secondaryButton.setDepth(10000);
            this.secondaryButton.setSize(sbtnRadius * 2, sbtnRadius * 2);
            this.secondaryButton.setInteractive(
                new Phaser.Geom.Circle(0, 0, sbtnRadius * 1.25),
                Phaser.Geom.Circle.Contains
            );

            this.secondaryButton.on('pointerdown', () => {
                this.isSecondaryPressed = true;
                sbtnBg.setFillStyle(0xfacc15, 0.9);
            });

            const releaseSecondary = () => {
                this.isSecondaryPressed = false;
                sbtnBg.setFillStyle(0xeab308, 0.6);
            };

            this.secondaryButton.on('pointerup', releaseSecondary);
            this.secondaryButton.on('pointerout', releaseSecondary);
        }

        // Visibility: show if forced, touch device, or small screen
        const isSmallScreen = typeof window !== 'undefined' && window.innerWidth <= 820;
        const shouldShow = Boolean(options.forceVisible || isTouch || isSmallScreen);

        if (!shouldShow) {
            this.setVisible(false);
        }

        // Persistent touch reveal listener: if user ever touches screen, reveal mobile controls
        this.touchRevealListener = (pointer: Phaser.Input.Pointer) => {
            if (pointer.wasTouch && !this.visible) {
                this.setVisible(true);
            }
        };
        scene.input.on('pointerdown', this.touchRevealListener);

        // Auto cleanup on scene shutdown
        scene.events.once('shutdown', () => {
            this.destroy();
        });
    }

    /**
     * Poll unified input state. Call this inside your scene or entity update() loop.
     */
    public getInput(): PlayerInput {
        const k = this.keyboardKeys;
        const j = this.joystickCursors;

        const kLeft = (k?.left?.isDown || k?.a?.isDown) ?? false;
        const kRight = (k?.right?.isDown || k?.d?.isDown) ?? false;
        const kUp = (k?.up?.isDown || k?.w?.isDown) ?? false;
        const kDown = (k?.down?.isDown || k?.s?.isDown) ?? false;
        const kJump = (k?.space?.isDown || kUp || k?.k?.isDown) ?? false;
        const kAction = (k?.j?.isDown || k?.f?.isDown || k?.enter?.isDown || k?.shift?.isDown) ?? false;
        const kSecondary = (k?.l?.isDown || k?.c?.isDown || k?.x?.isDown) ?? false;

        const jLeft = j?.left?.isDown ?? false;
        const jRight = j?.right?.isDown ?? false;
        const jUp = j?.up?.isDown ?? false;
        const jDown = j?.down?.isDown ?? false;

        return {
            left: kLeft || jLeft,
            right: kRight || jRight,
            up: kUp || jUp,
            down: kDown || jDown,
            jump: kJump || this.isJumpPressed,
            action: kAction || this.isActionPressed,
            secondary: kSecondary || this.isSecondaryPressed,
            force: this.joystick?.force ?? 0,
            angle: this.joystick?.angle ?? 0,
        };
    }

    public setVisible(visible: boolean): void {
        this.visible = visible;
        if (this.joystick) {
            this.joystick.setVisible(visible);
            this.joystick.setEnable(visible);
        }
        if (this.actionButton) {
            this.actionButton.setVisible(visible);
        }
        if (this.jumpButton) {
            this.jumpButton.setVisible(visible);
        }
        if (this.secondaryButton) {
            this.secondaryButton.setVisible(visible);
        }
    }

    public destroy(): void {
        if (this.touchRevealListener && this.scene && this.scene.input) {
            this.scene.input.off('pointerdown', this.touchRevealListener);
            this.touchRevealListener = null;
        }
        if (this.joystick) {
            this.joystick.destroy();
            this.joystick = null;
            this.joystickCursors = null;
        }
        if (this.actionButton) {
            this.actionButton.destroy();
            this.actionButton = null;
        }
        if (this.jumpButton) {
            this.jumpButton.destroy();
            this.jumpButton = null;
        }
        if (this.secondaryButton) {
            this.secondaryButton.destroy();
            this.secondaryButton = null;
        }
        this.keyboardKeys = null;
    }
}