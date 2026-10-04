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
    autoDaub: boolean;
    onToggleAutoDaub: () => void;
    onNewCard: () => void;
    canNewCard: boolean;
    onShowHelp: () => void;
    onShowRooms: () => void;
    onShowLobby: () => void;
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
 * buy-in selector, cartela serial and daub mode.
 */
export const GameHUD = ({
    phase,
    room,
    players,
    balance,
    bet,
onBetChange,
    cardId,
    autoDaub,
    onToggleAutoDaub,
    onNewCard,
    canNewCard,
    onShowHelp,
    onShowRooms,
    onShowLobby,
    wins,
    accuracy,
}: GameHUDProps) => {
    const phaseKey = String(phase).toLowerCase();

    return (
        <header className="bingo-header">


            <button
                type="button"
                className="toggle-btn"
                onClick={onShowLobby}
                title="Go back to the lobby and pick another cartela"
            >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path
                        d="M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v5H4zM13 14h7v5h-7z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinejoin="round"
                    />
                </svg>
                <span>CHANGE CARTELA</span>
            </button>
        </header>
    );
};