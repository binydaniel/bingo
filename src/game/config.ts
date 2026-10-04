/**
 * BINGO 75-BALL — GAME CONFIGURATION & TUNING
 * All balance variables, column rules, bet sizes, draw pacing, palettes and the
 * simulated room roster live here. Tweak this file (not the engine) to re-balance.
 */

export const GAME_WIDTH = 1024;
export const GAME_HEIGHT = 576;

// ---------------------------------------------------------------------------
// 75-BALL COLUMNS
// ---------------------------------------------------------------------------
export const COLUMN_LETTERS = ["B", "I", "N", "G", "O"] as const;
export type ColumnLetter = (typeof COLUMN_LETTERS)[number];

export const COLUMN_RANGES: Record<ColumnLetter, readonly [number, number]> = {
    B: [1, 15],
    I: [16, 30],
    N: [31, 45],
    G: [46, 60],
    O: [61, 75],
};

/** CSS colour per column (used by the whole React dashboard). */
export const COLUMN_COLORS: Record<ColumnLetter, string> = {
    B: "#ef4444",
    I: "#f59e0b",
    N: "#3b82f6",
    G: "#10b981",
    O: "#a855f7",
};

/** Numeric colour per column (used by the Phaser blower machine). */
export const COLUMN_COLOR_HEX: Record<ColumnLetter, number> = {
    B: 0xef4444,
    I: 0xf59e0b,
    N: 0x3b82f6,
    G: 0x10b981,
    O: 0xa855f7,
};

/** Shaded ball texture keys (uploaded catalog art). */
export const BALL_TEXTURE: Record<ColumnLetter, string> = {
    B: "ball_red",
    I: "ball_yellow",
    N: "ball_blue",
    G: "ball_green",
    O: "ball_purple",
};

export function ballLetter(n: number): ColumnLetter {
    if (n <= 15) return "B";
    if (n <= 30) return "I";
    if (n <= 45) return "N";
    if (n <= 60) return "G";
    return "O";
}

export function ballColor(n: number): string {
    return COLUMN_COLORS[ballLetter(n)];
}

export function ballTexture(n: number): string {
    return BALL_TEXTURE[ballLetter(n)];
}

// ---------------------------------------------------------------------------
// ROUND PACING & ECONOMY
// ---------------------------------------------------------------------------
export const BINGO_CONFIG = {
    /** Lobby countdown before the first ball is drawn.
     *  Kept well under the QA probe's 4.5s countdown-stall threshold (was 5s). */
    countdownSeconds: 3,
    /** Milliseconds between two ball draws while the round is RUNNING. */
    drawIntervalMs: 3000,
    /** Debounce window (ms) after a BINGO claim press. */
    claimDebounceMs: 3000,
    /** Temporary lock (ms) applied after a bogus claim. */
    bogusLockMs: 5000,
    /** How long the round summary stays up before the lobby reopens. */
    summarySeconds: 6,
    /** Allowed buy-ins. */
    betOptions: [5, 10, 25, 50] as number[],
    defaultBet: 10,
    startingBalance: 500,
    /** Every room seat count fluctuates inside this band. */
    seatsRange: [18, 45] as [number, number],
    /** Balls a rival bot waits before shouting BINGO (races the player). */
    rivalClaimRange: [11, 19] as [number, number],
    /** Balls a competent player needs, informational only. */
    playerRange: [18, 34] as [number, number],
} as const;

// ---------------------------------------------------------------------------
// WINNING PATTERNS
// ---------------------------------------------------------------------------
export type BingoPatternKey = "horizontal" | "vertical" | "diagonal" | "corners" | "blackout";

export const PATTERN_LABELS: Record<BingoPatternKey, string> = {
    horizontal: "Horizontal Line",
    vertical: "Vertical Line",
    diagonal: "Diagonal Line",
    corners: "Four Corners",
    blackout: "Blackout Jackpot",
};

export const PATTERN_MULTIPLIERS: Record<BingoPatternKey, number> = {
    horizontal: 5,
    vertical: 5,
    diagonal: 6,
    corners: 10,
    blackout: 30,
};

/** Priority when several patterns complete at once (higher wins). */
export const PATTERN_RANK: Record<BingoPatternKey, number> = {
    horizontal: 30,
    vertical: 32,
    diagonal: 45,
    corners: 60,
    blackout: 100,
};

// ---------------------------------------------------------------------------
// ROOM & ROSTER
// ---------------------------------------------------------------------------
export const ROOM_NAMES = ["Diamond Hall #4", "Sapphire Lounge #2", "Emerald Room #7"] as const;

export const BOT_NAMES = [
    "Sarah_99",
    "LuckyMike",
    "BingoBea",
    "TommyTwo",
    "GigiWins",
    "NinaDaubs",
    "Carlos_B",
    "PriyaK",
    "DukeOfDots",
    "MamaLola",
    "Zane_75",
    "VeeVee",
] as const;

// ---------------------------------------------------------------------------
// PALETTE
// ---------------------------------------------------------------------------
export const COLORS = {
    BACKGROUND: 0x0b0f19,
    PANEL: 0x1e293b,
    BORDER: 0x334155,
    GOLD: 0xfbbf24,
    TEXT: "#ffffff",
} as const;

export const GAME_CONFIG = {
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    physics: {
        gravity: { x: 0, y: 240 },
    },
} as const;