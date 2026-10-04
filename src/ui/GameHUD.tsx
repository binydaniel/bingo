import type { GamePhase } from "../game/state";
import { BINGO_CONFIG, COLUMN_COLORS } from "../game/config";

export interface GameHUDProps {
    phase: GamePhase;
    room: string;
    players: number;
    balance: number;
    bet: number;
    onBetChange: (bet: number) => void;
    cardId: string;
    muted: boolean;
    onToggleMute: () => void;
    autoDaub: boolean;
    onToggleAutoDaub: () => void;
    onNewCard: () => void;
    canNewCard: boolean;
    onShowHelp: () => void;
    onShowRooms: () => void;
    wins: number;
    accuracy: number;
}

const PHASE_COPY: Record<string, string> = {
    WAITING: "Waiting for players",
    COUNTDOWN: "Round starting",
    RUNNING: "Draw running",
    FINISHED: "Round finished",
};

/**
 * Header / status panel of the bingo dashboard: live game state, seat count,
 * buy-in selector, cartela serial, daub mode and the audio toggle.
 */
export const GameHUD = ({
    phase,
    room,
    players,
    balance,
    bet,
    onBetChange,
    cardId,
    muted,
    onToggleMute,
    autoDaub,
    onToggleAutoDaub,
    onNewCard,
    canNewCard,
    onShowHelp,
    onShowRooms,
    wins,
    accuracy,
}: GameHUDProps) => {
    const phaseKey = String(phase).toLowerCase();

    return (
        <header className="bingo-header">
            <div className="header-group">
                <button type="button" className="chip room-chip" onClick={onShowRooms} title="Switch room">
                    <span className="chip-label">ROOM</span>
                    <span className="chip-value">{room}</span>
                </button>

                <div className={`phase-badge ${phaseKey}`}>
                    <span className="phase-dot" />
                    <span className="chip-value">{PHASE_COPY[String(phase)] ?? String(phase)}</span>
                </div>

                <div className="chip">
                    <span className="chip-label">PLAYERS</span>
                    <span className="chip-value">{players}</span>
                </div>
            </div>

            <div className="header-group">
                <div className="chip">
                    <span className="chip-label">CARTELA</span>
                    <span className="chip-value mono">{cardId}</span>
                </div>

                <div className="chip">
                    <span className="chip-label">BALANCE</span>
                    <span className="chip-value mono">${balance}</span>
                </div>

                <div className="chip">
                    <span className="chip-label">WINS</span>
                    <span className="chip-value mono">
                        {wins} · {accuracy}%
                    </span>
                </div>
            </div>

            <div className="header-group header-actions">
                <div className="bet-group">
                    <span className="chip-label">BUY-IN</span>
                    {BINGO_CONFIG.betOptions.map((amount) => (
                        <button
                            key={amount}
                            type="button"
                            className={`bet-btn ${amount === bet ? "active" : ""}`}
                            onClick={() => onBetChange(amount)}
                            disabled={phase !== "WAITING"}
                        >
                            ${amount}
                        </button>
                    ))}
                </div>

                <button
                    type="button"
                    className={`toggle-btn ${autoDaub ? "on" : "off"}`}
                    onClick={onToggleAutoDaub}
                    title="Toggle automatic daubing"
                >
                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                        <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
                        {autoDaub && <circle cx="12" cy="12" r="4" fill={COLUMN_COLORS.N} />}
                    </svg>
                    <span>AUTO-DAUB {autoDaub ? "ON" : "OFF"}</span>
                </button>

                <button type="button" className="icon-btn" onClick={onNewCard} disabled={!canNewCard} title="New cartela">
                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                        <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
                        <path d="M8 9h8M8 13h8M8 17h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                </button>

                <button type="button" className="icon-btn" onClick={onShowHelp} title="How to play">
                    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
                        <path d="M12 17v.01M9.6 9a2.4 2.4 0 1 1 3.3 2.2c-.6.3-.9.8-.9 1.4v.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                </button>

                <button type="button" className="icon-btn" onClick={onToggleMute} title={muted ? "Unmute" : "Mute"}>
                    {muted ? (
                        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                            <path d="M4 9h3l4-3v12l-4-3H4z" fill="currentColor" />
                            <path d="M15 9l6 6M21 9l-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                    ) : (
                        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                            <path d="M4 9h3l4-3v12l-4-3H4z" fill="currentColor" />
                            <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                    )}
                </button>
            </div>
        </header>
    );
};