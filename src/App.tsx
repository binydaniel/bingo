import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import StartGame, { EventBus, setPendingCartelaSerial } from "./game/main";
import {
    BINGO_CONFIG,
    COLUMN_COLORS,
    COLUMN_LETTERS,
    COLUMN_RANGES,
    PATTERN_LABELS,
    ROOM_NAMES,
} from "./game/config";
import {
    DEFAULT_STATS,
    createBingoCard,
    createDaubGrid,
    daubAccuracy,
    daubKeys,
    evaluateBingo,
    findNumberCell,
    gameStorage,
    type BingoCard,
    type BingoStats,
    type GamePhase,
} from "./game/state";
import { CartelaLobby } from "./ui/CartelaLobby";
import { GameHUD } from "./ui/GameHUD";
import { GameModal } from "./ui/GameModal";

export interface IRefPhaserGame {
    game: Phaser.Game | null;
    scene: Phaser.Scene | null;
}

interface BallInfo {
    number: number;
    letter: string;
    color: string;
}

interface RoundSummary {
    winner: string | null;
    pattern?: string;
    prize: number;
    message: string;
    drawn: number;
    prizePool: number;
}

interface ClaimResult {
    valid: boolean;
    message: string;
    patternName?: string;
    prize?: number;
}

const MATRIX_COLUMNS = COLUMN_LETTERS.map((letter) => {
    const [min, max] = COLUMN_RANGES[letter];
    const nums: number[] = [];
    for (let n = min; n <= max; n++) nums.push(n);
    return { letter, nums };
});

/** "B-07" style label used by the compact stage bar. */
function ballLabel(n: number): string {
    const letter = MATRIX_COLUMNS.find((col) => col.nums.includes(n))?.letter ?? "B";
    return `${letter}-${String(n).padStart(2, "0")}`;
}

function App() {
    const phaserRef = useRef<IRefPhaserGame | null>(null);

    /** The session always opens on the lobby cartela picker. */
    const [screen, setScreen] = useState<"LOBBY" | "ROOM">("LOBBY");
    const [cartelaSerial, setCartelaSerial] = useState<number | null>(null);

    const [phase, setPhase] = useState<GamePhase>("WAITING");
    const [room, setRoom] = useState<string>(ROOM_NAMES[0]);
    const [players, setPlayers] = useState<number>(26);
    const [bet, setBet] = useState<number>(BINGO_CONFIG.defaultBet);
    const [balance, setBalance] = useState<number>(() => gameStorage.get("balance", BINGO_CONFIG.startingBalance));
    const [stats, setStats] = useState<BingoStats>(() => gameStorage.get("stats", DEFAULT_STATS));
    const [card, setCard] = useState<BingoCard>(() => createBingoCard());
    const [daubed, setDaubed] = useState<boolean[][]>(() => createDaubGrid());
    const [drawn, setDrawn] = useState<number[]>([]);
    const [lastBall, setLastBall] = useState<BallInfo | null>(null);
    const [autoDaub, setAutoDaub] = useState<boolean>(true);
    const [countdown, setCountdown] = useState<number | null>(null);
    const [result, setResult] = useState<ClaimResult | null>(null);
    const [locked, setLocked] = useState<boolean>(false);
    const [cooldown, setCooldown] = useState<number>(0);
    const [bogusFlash, setBogusFlash] = useState<boolean>(false);
    const [summary, setSummary] = useState<RoundSummary | null>(null);
    const [showHelp, setShowHelp] = useState<boolean>(false);
    const [showRooms, setShowRooms] = useState<boolean>(false);

    // Live snapshot for EventBus handlers registered once.
    const snap = useRef({ phase, card, daubed, drawn, autoDaub, bet, locked, cooldown, balance });
    useEffect(() => {
        snap.current = { phase, card, daubed, drawn, autoDaub, bet, locked, cooldown, balance };
    });

    //  Mount the Phaser game into #game-container exactly once and destroy it on
    //  unmount. DO NOT remove this effect or the #game-container div.
    //  Phaser only boots once a cartela has been picked in the lobby, and it is
    //  torn down again when the player returns to the lobby.
    useLayoutEffect(() => {
        if (screen !== "ROOM") return;

        // Hand the lobby pick to the scene before it deals its first card.
        setPendingCartelaSerial(cartelaSerial);

        if (phaserRef.current === null) {
            const game = StartGame("game-container");
            phaserRef.current = { game, scene: null };
        }

        const handler = (scene: Phaser.Scene) => {
            if (phaserRef.current) phaserRef.current.scene = scene;
        };
        EventBus.on("current-scene-ready", handler);

        return () => {
            EventBus.removeListener("current-scene-ready", handler);
            if (phaserRef.current) {
                phaserRef.current.game?.destroy(true);
                phaserRef.current = null;
            }
        };
    }, [screen, cartelaSerial]);

    // -----------------------------------------------------------------------
    // EventBus wiring — the blower scene owns the round loop, React mirrors it.
    // -----------------------------------------------------------------------
    useEffect(() => {
        const onPhase = (payload: { phase?: GamePhase } | GamePhase) => {
            const next = typeof payload === "string" ? payload : payload?.phase;
            if (!next) return;
            setPhase(next);
            if (next === "COUNTDOWN") {
                setDaubed(createDaubGrid());
                setDrawn([]);
                setLastBall(null);
                setResult(null);
                setSummary(null);
                setLocked(false);
                setCooldown(0);
            }
            if (next === "WAITING") {
                setSummary(null);
                setResult(null);
            }
        };

        const onCard = (payload: { grid?: BingoCard["grid"]; cardId?: string }) => {
            if (!payload?.grid) return;
            setCard({ id: payload.cardId ?? "BG-00000", grid: payload.grid });
            setDaubed(createDaubGrid());
        };

        const onBall = (payload: { number?: number; letter?: string; color?: string }) => {
            if (typeof payload?.number !== "number") return;
            const number = payload.number;
            const info: BallInfo = {
                number,
                letter: payload.letter ?? "B",
                color: payload.color ?? COLUMN_COLORS.B,
            };
            setLastBall(info);
            setDrawn((prev) => (prev.includes(number) ? prev : [...prev, number]));

            const { card: activeCard, autoDaub: auto } = snap.current;
            if (auto && activeCard) {
                const cell = findNumberCell(activeCard.grid, number);
                if (cell) {
                    const [r, c] = cell;
                    setDaubed((prev) => {
                        const next = prev.map((row) => row.slice());
                        next[r][c] = true;
                        return next;
                    });
                    setStats((prev) => ({ ...prev, daubs: prev.daubs + 1 }));
                }
            }
        };

        const onCountdown = (seconds: number) => {
            setCountdown(typeof seconds === "number" ? seconds : 0);
        };

        const onResult = (payload: ClaimResult) => {
            const valid = Boolean(payload?.valid);
            setResult({
                valid,
                message: payload?.message ?? "",
                patternName: payload?.patternName,
                prize: payload?.prize,
            });
            if (!valid) {
                setLocked(true);
                setBogusFlash(true);
                window.setTimeout(() => setLocked(false), BINGO_CONFIG.bogusLockMs);
                window.setTimeout(() => setBogusFlash(false), 900);
            }
        };

        const onSummary = (payload: {
            winner?: string | null;
            pattern?: string;
            prize?: number;
            message?: string;
            drawn?: number;
            prizePool?: number;
        }) => {
            const winner = payload?.winner ?? null;
            const won = winner === "You";
            const prize = Number(payload?.prize) || 0;

            setSummary({
                winner,
                pattern: payload?.pattern,
                prize,
                message: payload?.message ?? "Round complete.",
                drawn: Number(payload?.drawn) || 0,
                prizePool: Number(payload?.prizePool) || 0,
            });
            setStats((prev) => {
                const next: BingoStats = {
                    ...prev,
                    rounds: prev.rounds + 1,
                    wins: prev.wins + (won ? 1 : 0),
                    best: won && prize > prev.best ? prize : prev.best,
                };
                gameStorage.set("stats", next);
                return next;
            });
            if (won && prize > 0) {
                setBalance((prev) => {
                    const next = prev + prize;
                    gameStorage.set("balance", next);
                    return next;
                });
            }
            setCooldown(0);
        };

        const onLobby = (payload: { players?: number; room?: string }) => {
            if (typeof payload?.players === "number") setPlayers(payload.players);
            if (payload?.room) setRoom(payload.room);
        };

        EventBus.on("phase-changed", onPhase);
        EventBus.on("card-generated", onCard);
        EventBus.on("ball-drawn", onBall);
        EventBus.on("countdown-tick", onCountdown);
        EventBus.on("bingo-result", onResult);
        EventBus.on("round-summary", onSummary);
        EventBus.on("lobby-updated", onLobby);

        return () => {
            EventBus.removeListener("phase-changed", onPhase);
            EventBus.removeListener("card-generated", onCard);
            EventBus.removeListener("ball-drawn", onBall);
            EventBus.removeListener("countdown-tick", onCountdown);
            EventBus.removeListener("bingo-result", onResult);
            EventBus.removeListener("round-summary", onSummary);
            EventBus.removeListener("lobby-updated", onLobby);
        };
    }, []);

    // Claim debounce ticker.
    useEffect(() => {
        if (cooldown <= 0) return;
        const id = window.setInterval(() => {
            setCooldown((prev) => (prev <= 100 ? 0 : prev - 100));
        }, 100);
        return () => window.clearInterval(id);
    }, [cooldown]);

    // Reset the round result banner whenever a fresh round starts.
    useEffect(() => {
        if (phase === "COUNTDOWN") setResult(null);
    }, [phase]);

    const liveMatch = card ? evaluateBingo(card.grid, daubed) : null;
    const patternCells = new Set((liveMatch?.cells ?? []).map(([r, c]) => `${r},${c}`));
    const drawnSet = new Set(drawn);
    const accuracy = daubAccuracy(stats.daubs, stats.mistakes);
    const canClaim = phase === "RUNNING" && !locked && cooldown === 0 && liveMatch !== null;
    // Newest call first, rendered as plain text in the compact stage bar.
    const recentCalls = drawn
        .slice(-6)
        .reverse()
        .map(ballLabel)
        .join("  ·  ");

    // -----------------------------------------------------------------------
    // Player actions
    // -----------------------------------------------------------------------
    const handleCellClick = useCallback((r: number, c: number) => {
        const st = snap.current;
        if (st.phase !== "RUNNING" || st.locked) return;
        if (r === 2 && c === 2) return;

        const value = st.card.grid[r][c];
        const called = value !== "FREE" && st.drawn.includes(value);
        const isDaubed = st.daubed?.[r]?.[c];

        if (!isDaubed && !called) {
            setStats((prev) => ({ ...prev, mistakes: prev.mistakes + 1 }));
            return;
        }

        setDaubed((prev) => {
            const next = prev.map((row) => row.slice());
            next[r][c] = !next[r][c];
            return next;
        });
        setStats((prev) => (isDaubed ? { ...prev, daubs: Math.max(0, prev.daubs - 1) } : { ...prev, daubs: prev.daubs + 1 }));
    }, []);

    const handleClaim = useCallback(() => {
        const st = snap.current;
        if (st.phase !== "RUNNING") return;
        if (st.locked || st.cooldown > 0) return;

        const match = evaluateBingo(st.card.grid, st.daubed);
        if (!match) {
            setStats((prev) => ({ ...prev, mistakes: prev.mistakes + 1 }));
            return;
        }

        EventBus.emit("claim-bingo", { cardId: st.card.id, daubs: daubKeys(st.daubed) });
        setCooldown(BINGO_CONFIG.claimDebounceMs);
    }, []);

    const handleBetChange = useCallback((amount: number) => {
        setBet(amount);
        EventBus.emit("bet-changed", { amount });
    }, []);

    const handleNewCard = useCallback(() => {
        EventBus.emit("request-new-card");
    }, []);

    const handleToggleAutoDaub = useCallback(() => {
        setAutoDaub((prev) => {
            const next = !prev;
            EventBus.emit("auto-daub-toggled", { enabled: next });
            return next;
        });
    }, []);

    const handleSelectCartela = useCallback((serial: number) => {
        setCartelaSerial(serial);
        setScreen("ROOM");
    }, []);

    const handleShowLobby = useCallback(() => {
        setScreen("LOBBY");
    }, []);

    const handleSelectRoom = useCallback((name: string) => {
        setRoom(name);
        setShowRooms(false);
        setPlayers(BINGO_CONFIG.seatsRange[0] + Math.floor(Math.random() * 20));
    }, []);

    // Keyboard shortcuts: SPACE / B claim, ESC close modals.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.repeat) return;
            const key = e.key.toLowerCase();
            if (e.code === "Space" || key === "b") {
                e.preventDefault();
                handleClaim();
            } else if (e.key === "Escape") {
                setShowHelp(false);
                setShowRooms(false);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [handleClaim]);

    const potentialPrize = liveMatch ? bet * liveMatch.multiplier : 0;
    const cooldownPct = Math.round((cooldown / BINGO_CONFIG.claimDebounceMs) * 100);

    return (
        <div id="app">
            {/* The Phaser canvas mounts into #game-container (src/game/main.ts). */}
            <div id="game-container"></div>

            <div id="hud">
                <div className="bingo-shell">
                    {screen === "LOBBY" && (
                        <CartelaLobby balance={balance} bet={bet} onSelect={handleSelectCartela} />
                    )}

                    {screen === "ROOM" && (
                        <>
                            <GameHUD
                                phase={phase}
                                room={room}
                                players={players}
                                balance={balance}
                                bet={bet}
                                onBetChange={handleBetChange}
                                cardId={card?.id ?? "BG-00000"}
                                autoDaub={autoDaub}
                                onToggleAutoDaub={handleToggleAutoDaub}
                                onNewCard={handleNewCard}
                                canNewCard={phase === "WAITING"}
                                onShowHelp={() => setShowHelp(true)}
                                onShowRooms={() => setShowRooms(true)}
                                onShowLobby={handleShowLobby}
                                wins={stats.wins}
                                accuracy={accuracy}
                            />

                            {/* Compact bar — PREVIOUS CALLS with the numbers inline beside the label. */}
                            <div className="bingo-stage compact">
                                <div className="stage-line">
                                    <span className="stage-caption">PREVIOUS CALLS</span>
                                    <span className="stage-value stage-calls">
                                        {drawn.length === 0 ? "No balls drawn yet" : recentCalls}
                                    </span>
                                </div>

                                {phase === "COUNTDOWN" && countdown !== null && (
                                    <div className="countdown-banner">
                                        <span className="countdown-number">{countdown > 0 ? countdown : "GO!"}</span>
                                        <span className="countdown-label">Round begins</span>
                                    </div>
                                )}

                                {result && (
                                    <div className={`result-banner ${result.valid ? "good" : "bad"}`}>{result.message}</div>
                                )}
                            </div>

                            <div className="bingo-grid">
                                {/* CARTELA */}
                                <section className={`panel cartela-panel compact ${bogusFlash ? "shake" : ""}`}>
                                    <header className="panel-head">
                                        <h2>Your Cartela</h2>
                                        <span className="panel-tag">
                                            {card?.id} · {drawn.length} called
                                        </span>
                                    </header>

                                    <div className="cartela-head">
                                        {COLUMN_LETTERS.map((letter) => (
                                            <span key={letter} style={{ color: COLUMN_COLORS[letter] }}>
                                                {letter}
                                            </span>
                                        ))}
                                    </div>

                                    <div className="cartela">
                                        {(card?.grid ?? []).map((row, r) =>
                                            row.map((value, c) => {
                                                const isFree = value === "FREE";
                                                const isDaubed = isFree || Boolean(daubed?.[r]?.[c]);
                                                const isPattern = patternCells.has(`${r},${c}`);
                                                const letter = COLUMN_LETTERS[c];
                                                return (
                                                    <button
                                                        key={`${r}-${c}`}
                                                        type="button"
                                                        className={[
                                                            "cartela-cell",
                                                            isDaubed ? "daubed" : "",
                                                            isFree ? "free" : "",
                                                            isPattern ? "pattern" : "",
                                                        ]
                                                            .filter(Boolean)
                                                            .join(" ")}
                                                        style={{ ["--cell-color" as string]: COLUMN_COLORS[letter] }}
                                                        onClick={() => handleCellClick(r, c)}
                                                        aria-label={isFree ? "Free square" : `Cell ${String(value)}`}
                                                    >
                                                        {isFree ? "FREE" : value}
                                                    </button>
                                                );
                                            }),
                                        )}
                                    </div>


                                </section>

                                {/* 1-75 MATRIX */}
                                <section className="panel matrix-panel">
                                    <header className="panel-head">
                                        <h2>Master Board</h2>
                                        <span className="panel-tag">1 – 75 live calls</span>
                                    </header>

                                    <div className="matrix">
                                        {MATRIX_COLUMNS.map(({ letter, nums }) => (
                                            <div className="matrix-col" key={letter}>
                                                <span className="matrix-letter" style={{ color: COLUMN_COLORS[letter] }}>
                                                    {letter}
                                                </span>
                                                {nums.map((n) => {
                                                    const called = drawnSet.has(n);
                                                    const active = lastBall?.number === n;
                                                    return (
                                                        <span
                                                            key={n}
                                                            className={`matrix-cell ${called ? "called" : ""} ${active ? "active" : ""}`}
                                                            style={{ ["--cell-color" as string]: COLUMN_COLORS[letter] }}
                                                        >
                                                            {n}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            </div>

                            <div className="claim-bar">
                                <button
                                    type="button"
                                    className={`bingo-btn ${canClaim ? "ready" : ""}`}
                                    onClick={handleClaim}
                                    disabled={!canClaim}
                                >
                                    {liveMatch ? `BINGO $${potentialPrize}` : "BINGO!"}
                                </button>

                                <div className="cooldown-slot">
                                    {cooldown > 0 && (
                                        <div className="cooldown">
                                            <span>Claim cooldown</span>
                                            <div className="cooldown-track">
                                                <div className="cooldown-fill" style={{ width: `${cooldownPct}%` }} />
                                            </div>
                                        </div>
                                    )}
                                    {locked && <span className="claim-lock">Bogus BINGO lock — {(BINGO_CONFIG.bogusLockMs / 1000).toFixed(0)}s</span>}
                                    {!locked && cooldown === 0 && (
                                        <span className="claim-hint">
                                            {liveMatch
                                                ? `${PATTERN_LABELS[liveMatch.pattern]} complete — press BINGO!`
                                                : ""}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {showHelp && (
                    <GameModal
                        type="HELP"
                        onClose={() => setShowHelp(false)}
                    />
                )}

                {showRooms && (
                    <GameModal
                        type="ROOMS"
                        rooms={ROOM_NAMES.slice()}
                        activeRoom={room}
                        onSelectRoom={handleSelectRoom}
                        onClose={() => setShowRooms(false)}
                    />
                )}

                {summary && phase === "FINISHED" && (
                    <GameModal
                        type="SUMMARY"
                        summary={summary}
                        onClose={() => setSummary(null)}
                        onNextRound={() => setSummary(null)}
                    />
                )}
            </div>
        </div>
    );
}

export default App;
