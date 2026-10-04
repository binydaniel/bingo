import { useEffect, useState } from "react";

interface RoundSummaryData {
    winner: string | null;
    pattern?: string;
    prize: number;
    message: string;
    drawn: number;
    prizePool: number;
}

export interface GameModalProps {
    type: "HELP" | "SUMMARY" | "ROOMS";
    summary?: RoundSummaryData | null;
    rooms?: string[];
    activeRoom?: string;
    onSelectRoom?: (room: string) => void;
    onClose: () => void;
    onNextRound?: () => void;
    muted?: boolean;
    onToggleMute?: () => void;
}

const HELP_PAGES: Array<{ title: string; body: string }> = [
    {
        title: "1 · Take a cartela",
        body: "Every 75-ball cartela stacks the B column with 1-15, I with 16-30, N with 31-45, G with 46-60 and O with 61-75. The centre square is a FREE mark that already counts as daubed.",
    },
    {
        title: "2 · Daub the calls",
        body: "When the blower calls a ball, tap the matching square to daub it. Auto-Daub does it for you — but manual daubing keeps your daub accuracy at 100% and reads better on the scoreboard.",
    },
    {
        title: "3 · Call BINGO first",
        body: "Any complete line — horizontal, vertical, diagonal, the four corners or a full blackout — unlocks the BINGO! CLAIM button. Rival players are daubing at the same time, so claim before they do. Bogus claims lock you out for 5 seconds.",
    },
];

/**
 * Modal carousel used for the How-To-Play guide, the round summary and the
 * room switcher. Every index transition is clamped so rapid clicks can never
 * push the carousel past the end of its data.
 */
export const GameModal = ({
    type,
    summary,
    rooms = [],
    activeRoom,
    onSelectRoom,
    onClose,
    onNextRound,
    muted,
    onToggleMute,
}: GameModalProps) => {
    const [page, setPage] = useState(0);

    useEffect(() => {
        setPage(0);
    }, [type]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const safePage = Math.max(0, Math.min(page, HELP_PAGES.length - 1));
    const current = HELP_PAGES[safePage];
    const isLastPage = safePage === HELP_PAGES.length - 1;

    const nextPage = () => setPage((prev) => Math.min(prev + 1, HELP_PAGES.length - 1));
    const prevPage = () => setPage((prev) => Math.max(0, prev - 1));

    const won = summary?.winner === "You";

    return (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
            <div className="modal-card">
                {type === "HELP" && current && (
                    <>
                        <div className="modal-kicker">
                            HOW TO PLAY · PAGE {safePage + 1} / {HELP_PAGES.length}
                        </div>
                        <h3 className="modal-title">{current.title}</h3>
                        <p className="modal-body">{current.body}</p>
                        <div className="modal-row">
                            {safePage > 0 && (
                                <button type="button" className="btn ghost" onClick={prevPage}>
                                    BACK
                                </button>
                            )}
                            {!isLastPage ? (
                                <button type="button" className="btn primary" onClick={nextPage}>
                                    NEXT
                                </button>
                            ) : (
                                <button type="button" className="btn success" onClick={onClose}>
                                    START PLAYING
                                </button>
                            )}
                            <button type="button" className="btn ghost" onClick={onClose}>
                                CLOSE
                            </button>
                        </div>
                    </>
                )}

                {type === "SUMMARY" && (
                    <>
                        <div className={`modal-kicker ${won ? "good" : "bad"}`}>
                            {won ? "ROUND WON" : "ROUND CLOSED"}
                        </div>
                        <h3 className={`modal-title ${won ? "good" : ""}`}>
                            {won ? "BINGO! You took the pot" : summary?.winner ? `${summary.winner} took the pot` : "No winner this round"}
                        </h3>
                        <p className="modal-body">{summary?.message ?? "Round complete."}</p>
                        <div className="summary-grid">
                            <div className="summary-cell">
                                <span className="stat-label">PATTERN</span>
                                <span className="stat-value">{summary?.pattern ?? "—"}</span>
                            </div>
                            <div className="summary-cell">
                                <span className="stat-label">YOUR PAYOUT</span>
                                <span className="stat-value">${won ? (summary?.prize ?? 0) : 0}</span>
                            </div>
                            <div className="summary-cell">
                                <span className="stat-label">PRIZE POOL</span>
                                <span className="stat-value">${summary?.prizePool ?? 0}</span>
                            </div>
                            <div className="summary-cell">
                                <span className="stat-label">BALLS CALLED</span>
                                <span className="stat-value">{summary?.drawn ?? 0}</span>
                            </div>
                        </div>
                        <div className="modal-row">
                            <button type="button" className="btn success" onClick={onNextRound}>
                                NEXT ROUND
                            </button>
                            <button type="button" className="btn ghost" onClick={onClose}>
                                STAY IN LOBBY
                            </button>
                        </div>
                    </>
                )}

                {type === "ROOMS" && (
                    <>
                        <div className="modal-kicker">GAME ROOMS</div>
                        <h3 className="modal-title">Pick your hall</h3>
                        <div className="room-list">
                            {rooms.map((name, index) => (
                                <button
                                    key={name}
                                    type="button"
                                    className={`room-option ${name === activeRoom ? "active" : ""}`}
                                    onClick={() => onSelectRoom?.(name)}
                                >
                                    <span className="room-name">{name}</span>
                                    <span className="room-meta">
                                        {18 + index * 9} seats filled · ${10 + index * 15} avg buy-in
                                    </span>
                                </button>
                            ))}
                        </div>
                        <div className="modal-row">
                            <button type="button" className="btn ghost" onClick={onClose}>
                                BACK TO TABLE
                            </button>
                            {onToggleMute && (
                                <button type="button" className="btn ghost" onClick={onToggleMute}>
                                    {muted ? "SOUND: OFF" : "SOUND: ON"}
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};