/**
 * BINGO GAME STATE HELPERS
 * Card generation (75-ball rules), daub bookkeeping, pattern evaluation and the
 * win validator shared by the Phaser scene and the React dashboard.
 */

import { EventBus } from "./main";
import {
    COLUMN_LETTERS,
    COLUMN_RANGES,
    PATTERN_LABELS,
    PATTERN_MULTIPLIERS,
    PATTERN_RANK,
    type BingoPatternKey,
} from "./config";

export type { BingoPatternKey };

export type GamePhase =
    | "BOOT"
    | "MENU"
    | "COUNTDOWN"
    | "PLAYING"
    | "PAUSED"
    | "FINISHED"
    | "LEADERBOARD"
    | "WAITING"
    | "RUNNING"
    | "CLAIMING"
    | "GAMEOVER"
    | "VICTORY";

/** Phases that drive this bingo room. */
export type BingoPhase = "WAITING" | "COUNTDOWN" | "RUNNING" | "FINISHED";

export interface LeaderboardEntry {
    name: string;
    score: number;
    date: string;
}

export type BingoCell = number | "FREE";

export interface BingoCard {
    id: string;
    grid: BingoCell[][];
}

export interface PatternDef {
    key: BingoPatternKey;
    cells: Array<[number, number]>;
}

export interface BingoMatch {
    pattern: BingoPatternKey;
    label: string;
    cells: Array<[number, number]>;
    multiplier: number;
}

export interface ClaimCheck {
    valid: boolean;
    match: BingoMatch | null;
    reason?: string;
}

// ---------------------------------------------------------------------------
// Storage (iframe / private-mode safe)
// ---------------------------------------------------------------------------
export interface StorageAdapter {
    get<T>(key: string, fallback: T): T;
    set<T>(key: string, value: T): T;
    remove(key: string): void;
}

export function createStorage(namespace = "bingo75"): StorageAdapter {
    const prefix = `${namespace}:`;
    return {
        get<T>(key: string, fallback: T): T {
            if (typeof window === "undefined") return fallback;
            try {
                const raw = localStorage.getItem(prefix + key);
                return raw === null ? fallback : (JSON.parse(raw) as T);
            } catch {
                return fallback;
            }
        },
        set<T>(key: string, value: T): T {
            if (typeof window === "undefined") return value;
            try {
                localStorage.setItem(prefix + key, JSON.stringify(value));
            } catch {
                /* storage blocked — ignore */
            }
            return value;
        },
        remove(key: string): void {
            if (typeof window === "undefined") return;
            try {
                localStorage.removeItem(prefix + key);
            } catch {
                /* ignore */
            }
        },
    };
}

export const gameStorage = createStorage();

// ---------------------------------------------------------------------------
// Card generation — deterministic 75-ball column rules
// ---------------------------------------------------------------------------
export function shuffle<T>(items: T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
    }
    return out;
}

function range(min: number, max: number): number[] {
    const out: number[] = [];
    for (let n = min; n <= max; n++) out.push(n);
    return out;
}

/**
 * Deterministic PRNG (mulberry32). A cartela serial must always produce the
 * same 5x5 layout so the lobby can show players the real card before it is
 * dealt; `variant` lets "new cartela" re-roll the numbers under the same serial.
 */
function seededRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function seededShuffle<T>(items: T[], rand: () => number): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
    }
    return out;
}

export function createBingoCard(serial?: number | null, variant = 0): BingoCard {
    const chosen = Number(serial);
    const pinned = Number.isFinite(chosen) && chosen > 0;

    // Pinned serials deal deterministically; unpinned cards stay random.
    const rand = pinned ? seededRandom(Math.floor(chosen) * 7919 + variant * 104729 + 1) : Math.random;

    const columns = COLUMN_LETTERS.map((letter) => {
        const [min, max] = COLUMN_RANGES[letter];
        return seededShuffle(range(min, max), rand).slice(0, 5);
    });

    const grid: BingoCell[][] = [];
    for (let r = 0; r < 5; r++) {
        const row: BingoCell[] = [];
        for (let c = 0; c < 5; c++) {
            row.push(columns[c][r]);
        }
        grid.push(row);
    }
    grid[2][2] = "FREE";

    const label = pinned
        ? String(Math.floor(chosen)).padStart(5, "0")
        : String(Math.floor(10000 + Math.random() * 89999));
    return { id: `BG-${label}`, grid };
}

export function createDaubGrid(): boolean[][] {
    return Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => false));
}

export function isCellDaubed(daubed: boolean[][], r: number, c: number): boolean {
    if (r === 2 && c === 2) return true; // FREE square is always marked
    return Boolean(daubed?.[r]?.[c]);
}

export function findNumberCell(grid: BingoCell[][], value: number): [number, number] | null {
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            if (grid?.[r]?.[c] === value) return [r, c];
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Pattern evaluation
// ---------------------------------------------------------------------------
function buildPatterns(): PatternDef[] {
    const patterns: PatternDef[] = [];

    for (let r = 0; r < 5; r++) {
        patterns.push({ key: "horizontal", cells: Array.from({ length: 5 }, (_, c) => [r, c] as [number, number]) });
    }
    for (let c = 0; c < 5; c++) {
        patterns.push({ key: "vertical", cells: Array.from({ length: 5 }, (_, r) => [r, c] as [number, number]) });
    }
    patterns.push({ key: "diagonal", cells: Array.from({ length: 5 }, (_, i) => [i, i] as [number, number]) });
    patterns.push({ key: "diagonal", cells: Array.from({ length: 5 }, (_, i) => [i, 4 - i] as [number, number]) });
    patterns.push({ key: "corners", cells: [[0, 0], [0, 4], [4, 0], [4, 4]] });
    patterns.push({
        key: "blackout",
        cells: Array.from({ length: 25 }, (_, i) => [Math.floor(i / 5), i % 5] as [number, number]),
    });

    return patterns;
}

export const PATTERNS: PatternDef[] = buildPatterns();

/** Returns the most valuable completed pattern, or null when no line is complete. */
export function evaluateBingo(grid: BingoCell[][], daubed: boolean[][]): BingoMatch | null {
    if (!grid || grid.length === 0) return null;

    let best: BingoMatch | null = null;
    let bestRank = -1;

    for (const def of PATTERNS) {
        const complete = def.cells.every(([r, c]) => isCellDaubed(daubed, r, c));
        if (!complete) continue;
        const rank = PATTERN_RANK[def.key];
        if (rank > bestRank) {
            bestRank = rank;
            best = {
                pattern: def.key,
                label: PATTERN_LABELS[def.key],
                cells: def.cells,
                multiplier: PATTERN_MULTIPLIERS[def.key],
            };
        }
    }

    return best;
}

/** Full claim validation — pattern shape AND every daubed number genuinely called. */
export function validateBingoClaim(card: BingoCard, daubed: boolean[][], drawn: Set<number>): ClaimCheck {
    const match = evaluateBingo(card.grid, daubed);
    if (!match) {
        return { valid: false, match: null, reason: "Those daubs do not form a complete BINGO line yet." };
    }

    for (const [r, c] of match.cells) {
        const value = card.grid[r][c];
        if (value === "FREE") continue;
        if (!drawn.has(value)) {
            return { valid: false, match, reason: `Number ${value} has not been called yet — bogus BINGO!` };
        }
    }

    return { valid: true, match };
}

export function daubKeys(daubed: boolean[][]): string[] {
    const keys: string[] = [];
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            if (daubed?.[r]?.[c]) keys.push(`${r},${c}`);
        }
    }
    return keys;
}

export function daubedFromKeys(keys: string[]): boolean[][] {
    const grid = createDaubGrid();
    for (const key of keys ?? []) {
        const [r, c] = String(key).split(",").map((n) => Number(n));
        if (Number.isFinite(r) && Number.isFinite(c) && r >= 0 && r < 5 && c >= 0 && c < 5) {
            grid[r][c] = true;
        }
    }
    return grid;
}

/** Daub accuracy as a 0-100 percentage (mistakes are false marks). */
export function daubAccuracy(correct: number, mistakes: number): number {
    const total = correct + mistakes;
    if (total <= 0) return 100;
    return Math.max(0, Math.min(100, Math.round((correct / total) * 100)));
}

// ---------------------------------------------------------------------------
// Delta-time countdown (runs inside Scene update(time, delta))
// ---------------------------------------------------------------------------
export class CountdownTimer {
    private remainingMs = 0;
    private active = false;
    private lastTick = -1;
    private onCompleteCallback?: () => void;

    start(seconds = 3, onComplete?: () => void): void {
        const safeSeconds = Number.isFinite(seconds) ? Math.max(1, seconds) : 3;
        this.remainingMs = safeSeconds * 1000;
        this.active = true;
        this.lastTick = Math.ceil(safeSeconds);
        this.onCompleteCallback = onComplete;
        EventBus.emit("countdown-tick", this.lastTick);
    }

    stop(): void {
        this.active = false;
        this.remainingMs = 0;
    }

    get isRunning(): boolean {
        return this.active;
    }

    get secondsLeft(): number {
        return Math.max(0, Math.ceil(this.remainingMs / 1000));
    }

    update(deltaMs: number): boolean {
        if (!this.active) return false;

        this.remainingMs -= deltaMs;
        const currentSec = Math.max(0, Math.ceil(this.remainingMs / 1000));

        if (currentSec !== this.lastTick && currentSec > 0) {
            this.lastTick = currentSec;
            EventBus.emit("countdown-tick", currentSec);
        }

        if (this.remainingMs <= 0) {
            this.active = false;
            this.remainingMs = 0;
            EventBus.emit("countdown-tick", 0);
            const callback = this.onCompleteCallback;
            this.onCompleteCallback = undefined;
            if (callback) callback();
            return true;
        }

        return false;
    }
}

// ---------------------------------------------------------------------------
// Round scoring / session stats
// ---------------------------------------------------------------------------
export interface BingoStats {
    rounds: number;
    wins: number;
    best: number;
    daubs: number;
    mistakes: number;
}

export const DEFAULT_STATS: BingoStats = { rounds: 0, wins: 0, best: 0, daubs: 0, mistakes: 0 };