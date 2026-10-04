import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import StartGame, { EventBus } from "./game/main";
import {
    BINGO_CONFIG,
    BOT_NAMES,
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
import { isSoundMuted, playSFX, toggleMute } from "./game/sound";
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

interface FeedItem {
    id: number;
    text: string;
    tone: "info" | "good" | "bad";
    time: string;
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

let feedCounter = 0;

function pushFeed(prev: FeedItem[], text: string, tone: FeedItem["tone"]): FeedItem[] {
    feedCounter += 1;
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return [{ id: feedCounter, text, tone, time }, ...prev].slice(0, 10);
}

function phaseLabel(phase: GamePhase): string {
    switch (phase) {
        case "WAITING":
            return "LOBBY · WAITING";
        case "COUNTDOWN":
            return "ROUND STARTING";
        case "RUNNING":
            return "LIVE DRAW";
        case "FINISHED":
            return "ROUND CLOSED";
        default:
            return String(phase);
    }
}

function App() {
    const phaserRef = useRef<IRefPhaserGame | null>(null);

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
    const [muted, setMuted] = useState<boolean>(() => isSoundMuted());
    const [countdown, setCountdown] = useState<number | null>(null);
    const [result, setResult] = useState<ClaimResult | null>(null);
    const [locked, setLocked] = useState<boolean>(false);
    const [cooldown, setCooldown] = useState<number>(0);
    const [bogusFlash, setBogusFlash] = useState<boolean>(false);
    const [summary, setSummary] = useState<RoundSummary | null>(null);
    const [feed, setFeed] = useState<FeedItem[]>([]);
    const [showHelp, setShowHelp] = useState<boolean>(false);
    const [showRooms, setShowRooms] = useState<boolean>(false);

    // Live snapshot for EventBus handlers registered once.
    const snap = useRef({ phase, card, daubed, drawn, autoDaub, bet, locked, cooldown, balance });
    useEffect(() => {
        snap.current = { phase, card, daubed, drawn, autoDaub, bet, locked, cooldown, balance };
    });

    //  Mount the Phaser game into #game-container exactly once and destroy it on
    //  unmount. DO NOT remove this effect or the #game-container div.
    useLayoutEffect(() => {
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
    }, []);

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
                setFeed((prev) => pushFeed(prev, `New round starting — $${snap.current.bet} buy-in locked in.`, "info"));
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
            playSFX("ball");

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
                    playSFX("daub", 0.7);
                }
            }
        };

        const onCountdown = (seconds: number) => {
            setCountdown(typeof seconds === "number" ? seconds : 0);
            if (seconds > 0) playSFX("tick", 0.5);
        };

        const onResult = (payload: ClaimResult) => {
            const valid = Boolean(payload?.valid);
            setResult({
                valid,
                message: payload?.message ?? "",
                patternName: payload?.patternName,
                prize: payload?.prize,
            });
            playSFX(valid ? "bingo" : "error");
            setFeed((prev) => pushFeed(prev, payload?.message ?? "BINGO call processed.", valid ? "good" : "bad"));
            if (!valid) {
                setLocked(true);
                setBogusFlash(true);
                window.setTimeout(() => setLocked(false), BINGO_CONFIG.bogusLockMs);
                window.setTimeout(() => setBogusFlash(false), 900);
            }
        };

        const onRival = (payload: { name?: string; pattern?: string }) => {
            setFeed((prev) => pushFeed(prev, `${payload?.name ?? "A rival"} shouted BINGO! (${payload?.pattern ?? "line"})`, "bad"));
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
            setFeed((prev) => pushFeed(prev, payload?.message ?? "Round complete.", won ? "good" : "info"));
            playSFX(won ? "win" : "gameover", 0.8);
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
        EventBus.on("rival-bingo", onRival);
        EventBus.on("round-summary", onSummary);
        EventBus.on("lobby-updated", onLobby);

        return () => {
            EventBus.removeListener("phase-changed", onPhase);
            EventBus.removeListener("card-generated", onCard);
            EventBus.removeListener("ball-drawn", onBall);
            EventBus.removeListener("countdown-tick", onCountdown);
            EventBus.removeListener("bingo-result", onResult);
            EventBus.removeListener("rival-bingo", onRival);
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
    const recent = drawn.slice(-6);

    // -----------------------------------------------------------------------
    // Player actions
    // -----------------------------------------------------------------------
    const handleCellClick = useCallback((r: number, c: number) => {
        const st = snap.current;
        if (st.phase !== "RUNNING" || st.locked) return;
        if (r === 2 && c === 2) {
            setFeed((prev) => pushFeed(prev, "The centre square is FREE — it is always marked.", "info"));
            return;
        }

        const value = st.card.grid[r][c];
        const called = value !== "FREE" && st.drawn.includes(value);
        const isDaubed = st.daubed?.[r]?.[c];

        if (!isDaubed && !called) {
            setStats((prev) => ({ ...prev, mistakes: prev.mistakes + 1 }));
            setFeed((prev) => pushFeed(prev, `${value} has not been called yet — careful!`, "bad"));
            playSFX("error", 0.7);
            return;
        }

        setDaubed((prev) => {
            const next = prev.map((row) => row.slice());
            next[r][c] = !next[r][c];
            return next;
        });
        setStats((prev) => (isDaubed ? { ...prev, daubs: Math.max(0, prev.daubs - 1) } : { ...prev, daubs: prev.daubs + 1 }));
        playSFX("daub");
    }, []);

    const handleClaim = useCallback(() => {
        const st = snap.current;
        if (st.phase !== "RUNNING") {
            setFeed((prev) => pushFeed(prev, "No live round yet — press READY to join the draw.", "info"));
            return;
        }
        if (st.locked || st.cooldown > 0) return;

        const match = evaluateBingo(st.card.grid, st.daubed);
        if (!match) {
            setStats((prev) => ({ ...prev, mistakes: prev.mistakes + 1 }));
            setFeed((prev) => pushFeed(prev, "No completed BINGO line yet — keep daubing!", "bad"));
            playSFX("error");
            return;
        }

        EventBus.emit("claim-bingo", { cardId: st.card.id, daubs: daubKeys(st.daubed) });
        setCooldown(BINGO_CONFIG.claimDebounceMs);
        playSFX("powerup");
    }, []);

    const handleReady = useCallback(() => {
        const st = snap.current;
        if (st.phase !== "WAITING") return;

        if (st.balance < st.bet) {
            setBalance(BINGO_CONFIG.startingBalance);
            gameStorage.set("balance", BINGO_CONFIG.startingBalance);
            setFeed((prev) => pushFeed(prev, "House bonus applied — balance topped up to $500.", "good"));
        } else {
            const next = st.balance - st.bet;
            setBalance(next);
            gameStorage.set("balance", next);
        }

        setFeed((prev) => pushFeed(prev, `Buy-in accepted ($${st.bet}). Waiting for the blower…`, "info"));
        EventBus.emit("player-ready");
    }, []);

    const handleBetChange = useCallback((amount: number) => {
        setBet(amount);
        EventBus.emit("bet-changed", { amount });
        playSFX("tick", 0.5);
    }, []);

    const handleNewCard = useCallback(() => {
        EventBus.emit("request-new-card");
        setFeed((prev) => pushFeed(prev, "Fresh cartela issued for the next round.", "info"));
    }, []);

    const handleToggleAutoDaub = useCallback(() => {
        setAutoDaub((prev) => {
            const next = !prev;
            EventBus.emit("auto-daub-toggled", { enabled: next });
            setFeed((feedPrev) => pushFeed(feedPrev, `Auto-Daub ${next ? "enabled" : "disabled"} (manual daubs pay a 1.5x style bonus).`, "info"));
            return next;
        });
    }, []);

    const handleToggleMute = useCallback(() => {
        const next = toggleMute();
        setMuted(next);
        EventBus.emit("sound-toggled", { muted: next });
    }, []);

    const handleSelectRoom = useCallback((name: string) => {
        setRoom(name);
        setShowRooms(false);
        setPlayers(BINGO_CONFIG.seatsRange[0] + Math.floor(Math.random() * 20));
        setFeed((prev) => pushFeed(prev, `Joined ${name}.`, "info"));
    }, []);

    // Keyboard shortcuts: SPACE / B claim, M mute, ENTER ready, ESC close modals.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.repeat) return;
            const key = e.key.toLowerCase();
            if (e.code === "Space" || key === "b") {
                e.preventDefault();
                handleClaim();
            } else if (key === "m") {
                handleToggleMute();
            } else if (e.key === "Enter" && snap.current.phase === "WAITING") {
                handleReady();
            } else if (e.key === "Escape") {
                setShowHelp(false);
                setShowRooms(false);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [handleClaim, handleReady, handleToggleMute]);

    const potentialPrize = liveMatch ? bet * liveMatch.multiplier : 0;
    const cooldownPct = Math.round((cooldown / BINGO_CONFIG.claimDebounceMs) * 100);

    return (
        <div id="app">
            {/* The Phaser canvas mounts into #game-container (src/game/main.ts). */}
            <div id="game-container"></div>

            <div id="hud">
                <div className="bingo-shell">
                    <GameHUD
                        phase={phase}
                        room={room}
                        players={players}
                        balance={balance}
                        bet={bet}
                        onBetChange={handleBetChange}
                        cardId={card?.id ?? "BG-00000"}
                        muted={muted}
                        onToggleMute={handleToggleMute}
                        autoDaub={autoDaub}
                        onToggleAutoDaub={handleToggleAutoDaub}
                        onNewCard={handleNewCard}
                        canNewCard={phase === "WAITING"}
                        onShowHelp={() => setShowHelp(true)}
                        onShowRooms={() => setShowRooms(true)}
                        wins={stats.wins}
                        accuracy={accuracy}
                    />

                    {/* Transparent stage band — the Phaser blower machine shows through here. */}
                    <div className="bingo-stage">
                        <div className="caller-column">
                            <span className="stage-caption">LAST BALL CALLED</span>
                            <div
                                className={`caller-ball ${lastBall ? "live" : ""}`}
                                style={{ ["--ball-color" as string]: lastBall?.color ?? "#334155" }}
                            >
                                {lastBall ? lastBall.number : "--"}
                            </div>
                            <span className="caller-letter" style={{ color: lastBall?.color ?? "#64748b" }}>
                                {lastBall ? `${lastBall.letter} · 75 BALL` : "AWAITING DRAW"}
                            </span>
                        </div>

                        <div className="history-column">
                            <span className="stage-caption">PREVIOUS CALLS</span>
                            <div className="history-ribbon">
                                {recent.length === 0 && <span className="history-empty">No balls drawn yet</span>}
                                {recent
                                    .slice()
                                    .reverse()
                                    .map((n, idx) => {
                                        const letter = MATRIX_COLUMNS.find((col) => col.nums.includes(n))?.letter ?? "B";
                                        return (
                                            <span
                                                key={`${n}-${idx}`}
                                                className="mini-ball"
                                                style={{
                                                    background: COLUMN_COLORS[letter],
                                                    opacity: idx === 0 ? 1 : Math.max(0.35, 1 - idx * 0.14),
                                                }}
                                            >
                                                {n}
                                            </span>
                                        );
                                    })}
                            </div>
                            <span className="stage-note">
                                {phase === "RUNNING"
                                    ? "Blower running — auto-daub keeps pace with the host."
                                    : phase === "WAITING"
                                      ? "Blower idle. Press READY to take your seat."
                                      : phaseLabel(phase)}
                            </span>
                        </div>

                        {phase === "COUNTDOWN" && countdown !== null && (
                            <div className="countdown-banner">
                                <span className="countdown-number">{countdown > 0 ? countdown : "GO!"}</span>
                                <span className="countdown-label">Round begins</span>
                            </div>
                        )}

                        {result && (
                            <div className={`result-banner ${result.valid ? "good" : "bad"}`}>
                                {result.message}
                            </div>
                        )}
                    </div>

                    <div className="bingo-grid">
                        {/* CARTELA */}
                        <section className={`panel cartela-panel ${bogusFlash ? "shake" : ""}`}>
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

                            <footer className="panel-foot">
                                <span>Daubed {daubed.flat().filter(Boolean).length + 1}/25</span>
                                <span>{autoDaub ? "Auto-Daub ON" : "Manual daubing"}</span>
                            </footer>
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

                        {/* ROOM FEED */}
                        <section className="panel feed-panel">
                            <header className="panel-head">
                                <h2>Room Activity</h2>
                                <span className="panel-tag">{players} online</span>
                            </header>

                            <div className="stat-row">
                                <div className="stat">
                                    <span className="stat-label">WINS</span>
                                    <span className="stat-value">{stats.wins}</span>
                                </div>
                                <div className="stat">
                                    <span className="stat-label">ROUNDS</span>
                                    <span className="stat-value">{stats.rounds}</span>
                                </div>
                                <div className="stat">
                                    <span className="stat-label">ACCURACY</span>
                                    <span className="stat-value">{accuracy}%</span>
                                </div>
                                <div className="stat">
                                    <span className="stat-label">BEST</span>
                                    <span className="stat-value">${stats.best}</span>
                                </div>
                            </div>

                            <div className="feed-list">
                                {feed.length === 0 && (
                                    <p className="feed-empty">Waiting for the room to fill up… {BOT_NAMES[0]} just sat down.</p>
                                )}
                                {feed.map((item) => (
                                    <p key={item.id} className={`feed-item ${item.tone}`}>
                                        <span className="feed-time">{item.time}</span>
                                        {item.text}
                                    </p>
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
                            {liveMatch ? `BINGO! CLAIM $${potentialPrize}` : "BINGO! CLAIM"}
                        </button>

                        <button
                            type="button"
                            className="ready-btn"
                            onClick={handleReady}
                            disabled={phase !== "WAITING"}
                        >
                            {phase === "WAITING" ? `READY · $${bet} BUY-IN` : phaseLabel(phase)}
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
                                        : "Tap cells to daub. SPACE or B calls BINGO."}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {showHelp && (
                    <GameModal
                        type="HELP"
                        onClose={() => setShowHelp(false)}
                        muted={muted}
                        onToggleMute={handleToggleMute}
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
                        onNextRound={() => {
                            setSummary(null);
                            handleReady();
                        }}
                    />
                )}
            </div>
        </div>
    );
}

export default App;