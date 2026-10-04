import * as Phaser from 'phaser';
import { AUTO, Events, Game as PhaserGame, Scale, Scene } from 'phaser';

// Ensure global Phaser is available for plugins and runtime expressions
if (typeof window !== 'undefined') {
    (window as any).Phaser = Phaser;
}

import {
    BALL_TEXTURE,
    BINGO_CONFIG,
    BOT_NAMES,
    COLORS,
    COLUMN_COLORS,
    COLUMN_COLOR_HEX,
    GAME_HEIGHT,
    GAME_WIDTH,
    PATTERN_LABELS,
    ROOM_NAMES,
    ballLetter,
    type BingoPatternKey,
} from './config';
import {
    CountdownTimer,
    createBingoCard,
    daubedFromKeys,
    shuffle,
    validateBingoClaim,
    type BingoCard,
    type BingoPhase,
} from './state';

export { GAME_CONFIG, GAME_WIDTH, GAME_HEIGHT, COLORS } from './config';

// ---------------------------------------------------------------------------
// EVENT BUS — shared React <-> Phaser bridge (named export).
// The blower scene emits, the React dashboard listens (and vice-versa).
// Keep the event-name strings here so both sides can't drift.
// ---------------------------------------------------------------------------
export const EventBus = new Events.EventEmitter();

/**
 * Cartela serial picked on the lobby screen. The React shell stores it here
 * before booting Phaser so the very first card the scene deals already carries
 * the identity the player chose. Null means "deal a random serial".
 */
let pendingCartelaSerial: number | null = null;

export function setPendingCartelaSerial(serial: number | null): void {
    pendingCartelaSerial = Number.isFinite(serial as number) && (serial as number) > 0
        ? Math.floor(serial as number)
        : null;
}

export function getPendingCartelaSerial(): number | null {
    return pendingCartelaSerial;
}

export const EVENTS = {
    PHASE: 'phase-changed',
    BALL: 'ball-drawn',
    COUNTDOWN: 'countdown-tick',
    CLAIM: 'claim-bingo',
    RESULT: 'bingo-result',
    NEW_CARD: 'request-new-card',
    CARD: 'card-generated',
    AUTO_DAUB: 'auto-daub-toggled',
    READY: 'player-ready',
    BET: 'bet-changed',
    RIVAL: 'rival-bingo',
    SUMMARY: 'round-summary',
    LOBBY: 'lobby-updated',
} as const;

const BALLS_PER_CHAMBER = 7;

interface ChamberGeom {
    x: number;
    y: number;
    w: number;
    h: number;
}

interface StageGeom {
    width: number;
    height: number;
    left: ChamberGeom;
    right: ChamberGeom;
    center: { x: number; y: number };
    ballSize: number;
}

interface ClaimPayload {
    cardId?: string;
    daubs?: string[];
}

interface SummaryPayload {
    winner: string | null;
    pattern?: string;
    prize?: number;
    message: string;
    drawn?: number;
    prizePool?: number;
}

const RIVAL_PATTERNS: BingoPatternKey[] = ['horizontal', 'vertical', 'diagonal', 'corners'];

const StartGame = (parent: string) =>
{
    const config: Phaser.Types.Core.GameConfig = {
        type: AUTO,
        parent,
        backgroundColor: '#0b0f19',
        scale: {
            mode: Scale.RESIZE,
            autoCenter: Scale.NO_CENTER,
            width: '100%',
            height: '100%',
        },
        input: {
            activePointers: 3,
        },
        physics: {
            default: 'arcade',
            arcade: {
                gravity: { x: 0, y: 240 },
                fps: 60,
                fixedStep: true,
            },
        },

        scene: [Game],
    };

    const game = new PhaserGame(config);
    if (typeof window !== 'undefined') {
        (window as any).__PHASER_GAME__ = game;
        (window as any).__PHASER_EVENT_BUS__ = EventBus;
    }
    return game;
};

// ---------------------------------------------------------------------------
// THE GAME SCENE — lottery blower machine + authoritative round engine.
// All layout derives from the live viewport (Scale.RESIZE) so the machine stays
// locked to the dashboard's transparent stage band on any screen.
// ---------------------------------------------------------------------------
export class Game extends Scene
{
    private phase: BingoPhase = 'WAITING';
    private card!: BingoCard;
    private cartelaSerial: number | null = null;
    private deck: number[] = [];
    private drawn: number[] = [];
    private drawnSet: Set<number> = new Set();

    private backplate?: Phaser.GameObjects.TileSprite;
    private machine?: Phaser.GameObjects.Graphics;
    private spotlight?: Phaser.GameObjects.Arc;
    private goalRing?: Phaser.GameObjects.Arc;
    private balls: Phaser.Physics.Arcade.Image[] = [];
    private walls!: Phaser.Physics.Arcade.StaticGroup;

    private countdown = new CountdownTimer();
    private drawTimer?: Phaser.Time.TimerEvent;
    private summaryTimer?: Phaser.Time.TimerEvent;
    private lobbyTimer?: Phaser.Time.TimerEvent;
    private stirTimer?: Phaser.Time.TimerEvent;
    private autoStartTimer?: Phaser.Time.TimerEvent;

    private rivals: Array<{ name: string; need: number; seen: number }> = [];
    private roundClaimed = false;
    private autoDaub = true;
    private bet: number = BINGO_CONFIG.defaultBet;
    private seats = 26;
    private room = ROOM_NAMES[0];
    private geom: StageGeom = {
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
        left: { x: 240, y: 110, w: 200, h: 170 },
        right: { x: GAME_WIDTH - 240, y: 110, w: 200, h: 170 },
        center: { x: GAME_WIDTH / 2, y: 130 },
        ballSize: 40,
    };

    constructor ()
    {
        super('Game');
    }

    preload ()
    {
        this.load.image('ball_red', 'assets/2D-assets/puzzle_game_gfx/Balls/ball_red_shaded.png');
        this.load.image('ball_yellow', 'assets/2D-assets/puzzle_game_gfx/Balls/ball_yellow_shaded.png');
        this.load.image('ball_blue', 'assets/2D-assets/puzzle_game_gfx/Balls/ball_blue_shaded.png');
        this.load.image('ball_green', 'assets/2D-assets/puzzle_game_gfx/Balls/ball_green_shaded.png');
        this.load.image('ball_purple', 'assets/2D-assets/puzzle_game_gfx/Balls/ball_purple_shaded.png');
        this.load.image('bg_tile', 'assets/2D-assets/Pixel_Adventure/Background/Blue.png');
    }

    create ()
    {
        this.cameras.main.setBackgroundColor(COLORS.BACKGROUND);

        // Parallax-free decorative tile pattern (kept far behind everything).
        this.backplate = this.add.tileSprite(0, 0, this.scale.width, this.scale.height, 'bg_tile')
            .setOrigin(0, 0)
            .setAlpha(0.09)
            .setTint(0x1e3a8a)
            .setDepth(-10);

        this.machine = this.add.graphics().setDepth(-5);
        this.walls = this.physics.add.staticGroup();

        // The ball array is (re)instantiated here BEFORE any collider captures it,
        // so Phaser never receives an undefined parent on frame 1.
        this.balls = [];
        this.spawnBalls();
        this.layout();
        this.physics.add.collider(this.balls, this.walls, undefined, undefined, this);

        // Persistent gold jackpot ring at the blower centre — every called ball
        // lands inside it. This is the round's win-goal marker (named 'goal').
        this.goalRing = this.add.circle(this.geom.center.x, this.geom.center.y, 56, 0xfbbf24, 0.07)
            .setStrokeStyle(2, 0xfbbf24, 0.32)
            .setDepth(-1)
            .setName('goal');

        this.scale.on('resize', this.onResize, this);

        // Air-blower stir keeps the chamber alive.
        this.stirTimer = this.time.addEvent({
            delay: 1300,
            loop: true,
            callback: this.stir,
            callbackScope: this,
        });

        // Room activity simulator (player count fluctuates 18-45).
        this.lobbyTimer = this.time.addEvent({
            delay: 2600,
            loop: true,
            callback: this.driftLobby,
            callbackScope: this,
        });

        // Commands from the React dashboard.
        EventBus.on(EVENTS.READY, this.onPlayerReady, this);
        EventBus.on(EVENTS.CLAIM, this.onClaim, this);
        EventBus.on(EVENTS.NEW_CARD, this.onNewCard, this);
        EventBus.on(EVENTS.AUTO_DAUB, this.onAutoDaub, this);
        EventBus.on(EVENTS.BET, this.onBet, this);

        // Deal the player a cartela straight away so the dashboard is never empty.
        this.cartelaSerial = getPendingCartelaSerial();
        this.card = createBingoCard(this.cartelaSerial);
        EventBus.emit(EVENTS.CARD, { grid: this.card.grid, cardId: this.card.id });
        EventBus.emit(EVENTS.LOBBY, { players: this.seats, room: this.room });
        this.setPhase('WAITING');

        // The room runs on a schedule: the blower starts shortly after boot even
        // if nobody presses READY (READY still jumps the gun during WAITING).
        this.autoStartTimer = this.time.addEvent({
            delay: 500,
            callback: () =>
            {
                if (this.phase === 'WAITING') this.startCountdown();
            },
            callbackScope: this,
        });

        EventBus.emit('current-scene-ready', this);

        this.events.once('shutdown', () =>
        {
            this.time.removeAllEvents();
            this.tweens.killAll();
            this.scale.off('resize', this.onResize, this);
            this.autoStartTimer?.remove();
            EventBus.off(EVENTS.READY, this.onPlayerReady, this);
            EventBus.off(EVENTS.CLAIM, this.onClaim, this);
            EventBus.off(EVENTS.NEW_CARD, this.onNewCard, this);
            EventBus.off(EVENTS.AUTO_DAUB, this.onAutoDaub, this);
            EventBus.off(EVENTS.BET, this.onBet, this);
            this.balls = [];
        });
    }

    update (_time: number, delta: number)
    {
        if (this.countdown.isRunning) {
            this.countdown.update(delta);
        }
    }

    // -----------------------------------------------------------------------
    // VISUALS — blower machine layout (responsive, recomputed on resize)
    // -----------------------------------------------------------------------
    private computeGeom (): StageGeom
    {
        const width = Math.max(320, this.scale.width || GAME_WIDTH);
        const height = Math.max(320, this.scale.height || GAME_HEIGHT);

        const chamberW = Math.max(70, Math.min(width * 0.22, 280));
        const chamberH = Math.max(80, Math.min(height * 0.22, 220));
        const cy = Math.max(chamberH / 2 + 26, height * 0.16);
        const gap = Math.max(width * 0.28, chamberW * 0.95 + 60);

        return {
            width,
            height,
            left: { x: width / 2 - gap, y: cy, w: chamberW, h: chamberH },
            right: { x: width / 2 + gap, y: cy, w: chamberW, h: chamberH },
            center: { x: width / 2, y: cy },
            ballSize: Phaser.Math.Clamp(Math.min(chamberW, chamberH) * 0.24, 18, 52),
        };
    }

    private spawnBalls ()
    {
        const textures = Object.values(BALL_TEXTURE);
        for (let i = 0; i < BALLS_PER_CHAMBER * 2; i++) {
            const tex = textures[i % textures.length];
            const ball = this.physics.add.image(200 + i * 12, 120, tex);
            ball.setBounce(0.72, 0.72);
            ball.setDamping(false);
            ball.setDrag(0, 8);
            ball.setDepth(20);
            ball.setScale(0.08);
            const body = ball.body as Phaser.Physics.Arcade.Body;
            body.setCircle(250);
            ball.setData('chamber', i % 2 === 0 ? 0 : 1);
            this.balls.push(ball);
        }
    }

    private onResize ()
    {
        this.layout();
    }

    private layout ()
    {
        this.geom = this.computeGeom();
        const { width, height, left, right, ballSize } = this.geom;

        this.backplate?.setSize(width, height);
        this.physics.world.setBounds(0, 0, width, height);
        this.goalRing?.setPosition(this.geom.center.x, this.geom.center.y);

        this.walls.clear(true, true);
        const thickness = 12;
        const addWall = (x: number, y: number, w: number, h: number) => {
            const rect = this.add.rectangle(x, y, w, h, 0x000000, 0);
            this.walls.add(rect);
            const body = rect.body as Phaser.Physics.Arcade.StaticBody;
            body.updateFromGameObject();
        };

        for (const chamber of [left, right]) {
            addWall(chamber.x, chamber.y - chamber.h / 2, chamber.w, thickness);
            addWall(chamber.x, chamber.y + chamber.h / 2, chamber.w, thickness);
            addWall(chamber.x - chamber.w / 2, chamber.y, thickness, chamber.h);
            addWall(chamber.x + chamber.w / 2, chamber.y, thickness, chamber.h);
        }

        // Machine chrome.
        const g = this.machine;
        if (g) {
            g.clear();
            for (const chamber of [left, right]) {
                g.fillStyle(0x0f172a, 0.72);
                g.fillRoundedRect(chamber.x - chamber.w / 2, chamber.y - chamber.h / 2, chamber.w, chamber.h, 18);
                g.lineStyle(2, 0x334155, 0.95);
                g.strokeRoundedRect(chamber.x - chamber.w / 2, chamber.y - chamber.h / 2, chamber.w, chamber.h, 18);
                g.lineStyle(1, 0x94a3b8, 0.18);
                g.strokeRoundedRect(chamber.x - chamber.w / 2 + 7, chamber.y - chamber.h / 2 + 7, chamber.w - 14, chamber.h - 14, 14);
                g.fillStyle(0xfbbf24, 0.14);
                g.fillRoundedRect(chamber.x - chamber.w / 2 + 10, chamber.y + chamber.h / 2 - 26, chamber.w - 20, 12, 6);
            }
            // Vent bridge between both chambers.
            g.fillStyle(0x1e293b, 0.5);
            g.fillRoundedRect(left.x + left.w / 2, this.geom.center.y - 12, right.x - right.w / 2 - (left.x + left.w / 2), 24, 12);
            g.lineStyle(1, 0x334155, 0.7);
            g.strokeRoundedRect(left.x + left.w / 2, this.geom.center.y - 12, right.x - right.w / 2 - (left.x + left.w / 2), 24, 12);
        }

        // Seat the balls inside their chambers.
        const scale = ballSize / 512;
        this.balls.forEach((ball, i) => {
            const chamber = ball.getData('chamber') === 1 ? right : left;
            const spreadX = Math.max(0, chamber.w / 2 - ballSize * 0.8);
            const spreadY = Math.max(0, chamber.h / 2 - ballSize * 0.8);
            ball.setScale(scale);
            (ball.body as Phaser.Physics.Arcade.Body).setCircle(250);
            ball.setPosition(
                chamber.x + Phaser.Math.Between(-spreadX, spreadX),
                chamber.y + Phaser.Math.Between(-spreadY, spreadY),
            );
            ball.setVelocity(Phaser.Math.Between(-70, 70), Phaser.Math.Between(-120, -40));
            void i;
        });
    }

    private stir ()
    {
        this.balls.forEach((ball) => {
            if (!ball.active) return;
            (ball.body as Phaser.Physics.Arcade.Body).setVelocity(
                Phaser.Math.Between(-90, 90),
                -Phaser.Math.Between(60, 170),
            );
        });
    }

    // -----------------------------------------------------------------------
    // ROUND ENGINE
    // -----------------------------------------------------------------------
    private setPhase (next: BingoPhase)
    {
        if (this.phase === next) return;
        this.phase = next;
        EventBus.emit(EVENTS.PHASE, { phase: next });
    }

    private get drawnNumbers (): Set<number>
    {
        return this.drawnSet;
    }

    private onPlayerReady ()
    {
        if (this.phase !== 'WAITING') return;
        this.startCountdown();
    }

    private startCountdown ()
    {
        this.roundClaimed = false;
        this.setPhase('COUNTDOWN');
        this.countdown.start(BINGO_CONFIG.countdownSeconds, () => this.beginRound());
    }

    private beginRound ()
    {
        if (this.phase !== 'COUNTDOWN') return;

        this.deck = shuffle(Array.from({ length: 75 }, (_, i) => i + 1));
        this.drawn = [];
        this.drawnSet.clear();
        this.rivals = this.pickRivals();

        this.setPhase('RUNNING');
        this.drawNext();

        this.drawTimer?.remove();
        this.drawTimer = this.time.addEvent({
            delay: BINGO_CONFIG.drawIntervalMs,
            loop: true,
            callback: this.drawNext,
            callbackScope: this,
        });
    }

    private pickRivals ()
    {
        const roster = shuffle(BOT_NAMES.slice()).slice(0, 5);
        const [min, max] = BINGO_CONFIG.rivalClaimRange;
        return roster.map((name) => ({
            name,
            need: Phaser.Math.Between(min, max),
            seen: 0,
        }));
    }

    private drawNext ()
    {
        if (this.phase !== 'RUNNING') return;

        if (this.deck.length === 0) {
            this.finishRound({
                winner: null,
                message: 'All 75 balls called — the house takes this round.',
                drawn: this.drawn.length,
            });
            return;
        }

        const number = this.deck.pop() as number;
        this.drawn.push(number);
        this.drawnSet.add(number);

        const letter = ballLetter(number);
        EventBus.emit(EVENTS.BALL, {
            number,
            letter,
            color: COLUMN_COLORS[letter],
            timestamp: Date.now(),
        });

        this.animateDrawnBall(number);

        for (const rival of this.rivals) {
            rival.seen += 1;
            if (rival.seen >= rival.need && !this.roundClaimed) {
                this.roundClaimed = true;
                const pattern = RIVAL_PATTERNS[Phaser.Math.Between(0, RIVAL_PATTERNS.length - 1)];
                EventBus.emit(EVENTS.RIVAL, { name: rival.name, pattern: PATTERN_LABELS[pattern] });
                this.finishRound({
                    winner: rival.name,
                    pattern: PATTERN_LABELS[pattern],
                    message: `${rival.name} shouted BINGO first with a ${PATTERN_LABELS[pattern]}!`,
                    drawn: this.drawn.length,
                });
                return;
            }
        }
    }

    private animateDrawnBall (number: number)
    {
        const { center, left, right } = this.geom;
        const start = Math.random() > 0.5 ? left : right;
        const tex = BALL_TEXTURE[ballLetter(number)];
        const target = this.add.image(start.x, start.y, tex).setDepth(30).setScale(0.02);

        this.tweens.add({
            targets: target,
            x: center.x,
            y: center.y,
            scale: 0.22,
            duration: 340,
            ease: 'Back.easeOut',
        });
        this.tweens.add({
            targets: target,
            scale: 0.02,
            alpha: 0,
            delay: 780,
            duration: 260,
            onComplete: () => target.destroy(),
        });

        // Called-ball glow behind the HTML caller card.
        this.spotlight?.destroy();
        const letter = ballLetter(number);
        this.spotlight = this.add.circle(center.x, center.y, Math.max(46, this.geom.ballSize * 1.9), COLUMN_COLOR_HEX[letter], 0.16)
            .setDepth(-2);
        this.tweens.add({
            targets: this.spotlight,
            alpha: 0.04,
            duration: 900,
            ease: 'Sine.easeOut',
        });
    }

    private onClaim (payload?: ClaimPayload)
    {
        if (this.phase !== 'RUNNING') {
            EventBus.emit(EVENTS.RESULT, {
                valid: false,
                message: 'No round in progress — wait for the next draw to start.',
            });
            return;
        }

        const daubed = daubedFromKeys(payload?.daubs ?? []);
        const check = validateBingoClaim(this.card, daubed, this.drawnNumbers);

        if (!check.valid || !check.match) {
            EventBus.emit(EVENTS.RESULT, {
                valid: false,
                message: check.reason ?? 'Bogus BINGO — that pattern is not complete.',
            });
            return;
        }

        const prize = Math.round(this.bet * check.match.multiplier);
        EventBus.emit(EVENTS.RESULT, {
            valid: true,
            patternName: check.match.label,
            prize,
            message: `Valid BINGO! ${check.match.label} — $${prize} paid out.`,
        });
        this.finishRound({
            winner: 'You',
            pattern: check.match.label,
            prize,
            message: `You called BINGO with a ${check.match.label}!`,
            drawn: this.drawn.length,
        });
    }

    private finishRound (result: SummaryPayload)
    {
        this.drawTimer?.remove();
        this.drawTimer = undefined;
        this.roundClaimed = true;
        this.countdown.stop();

        this.setPhase('FINISHED');

        EventBus.emit(EVENTS.SUMMARY, {
            ...result,
            drawn: result.drawn ?? this.drawn.length,
            prizePool: Math.round(Math.max(1, this.seats) * this.bet * 0.8),
        });

        this.summaryTimer?.remove();
        this.summaryTimer = this.time.addEvent({
            delay: BINGO_CONFIG.summarySeconds * 1000,
            callback: this.returnToLobby,
            callbackScope: this,
        });
    }

    private returnToLobby ()
    {
        this.drawn = [];
        this.drawnSet.clear();
        this.setPhase('WAITING');
    }

    private onNewCard ()
    {
        if (this.phase !== 'WAITING') return;
        this.card = createBingoCard(this.cartelaSerial);
        EventBus.emit(EVENTS.CARD, { grid: this.card.grid, cardId: this.card.id });
    }

    private onAutoDaub (payload?: { enabled?: boolean })
    {
        this.autoDaub = Boolean(payload?.enabled);
    }

    private onBet (payload?: { amount?: number })
    {
        const amount = Number(payload?.amount);
        if (Number.isFinite(amount) && amount > 0) this.bet = amount;
    }

    private driftLobby ()
    {
        const [min, max] = BINGO_CONFIG.seatsRange;
        this.seats = Phaser.Math.Clamp(this.seats + Phaser.Math.Between(-2, 3), min, max);
        EventBus.emit(EVENTS.LOBBY, { players: this.seats, room: this.room });
    }
}

export default StartGame;