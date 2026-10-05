import { useEffect, useMemo, useState } from "react";
import { COLUMN_COLORS, COLUMN_LETTERS } from "../game/config";
import { createBingoCard } from "../game/state";

/** Cartelas on sale in the lobby — buttons are numbered 1 to 200. */
export const CARTELA_COUNT = 200;

/** How long the "waiting for players" seat-hold lasts, in seconds. */
export const JOIN_SECONDS = 5;

const CARTELA_NUMBERS = Array.from({ length: CARTELA_COUNT }, (_, i) => i + 1);

/** Accent colour of a cartela button, cycled across the five BINGO columns. */
function serialColor(serial: number): string {
    return COLUMN_COLORS[COLUMN_LETTERS[serial % COLUMN_LETTERS.length]];
}

export interface CartelaLobbyProps {
    balance: number;
    bet: number;
    onSelect: (serial: number) => void;
}

/**
 * First screen of the session: the lobby. A grid of 1-200 cartela buttons.
 *
 * Hovering (or tapping, on touch devices) previews the real 5x5 card for that
 * serial — `createBingoCard` is deterministic per serial, so the preview is the
 * card you get. Taking a cartela holds the seat for {@link JOIN_SECONDS} while
 * the other players are seated before the room opens.
 */
export const CartelaLobby = ({ balance, bet, onSelect }: CartelaLobbyProps) => {
    const [hovered, setHovered] = useState<number | null>(null);
    const [picked, setPicked] = useState<number | null>(null);
    const [joining, setJoining] = useState<number | null>(null);
    const [secondsLeft, setSecondsLeft] = useState<number>(JOIN_SECONDS);

    // Touch devices have no hover, so a tap only previews and the explicit
    // button confirms. Hover devices can commit straight from the cell.
    const canHover = useMemo(
        () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches,
        [],
    );

    const preview = hovered ?? picked ?? CARTELA_NUMBERS[0];
    const previewCard = useMemo(() => createBingoCard(preview), [preview]);

    useEffect(() => {
        if (joining === null) return;

        setSecondsLeft(JOIN_SECONDS);
        const startedAt = Date.now();

        const id = window.setInterval(() => {
            const elapsed = Math.floor((Date.now() - startedAt) / 1000);
            const left = Math.max(0, JOIN_SECONDS - elapsed);
            setSecondsLeft(left);

            if (left === 0) {
                window.clearInterval(id);
                const serial = joining;
                setJoining(null);
                onSelect(serial);
            }
        }, 100);

        return () => window.clearInterval(id);
    }, [joining, onSelect]);

    const handleCell = (serial: number) => {
        if (canHover) setJoining(serial);
        else setPicked(serial);
    };

    const progress = ((JOIN_SECONDS - secondsLeft) / JOIN_SECONDS) * 100;

    return (
        <div id="lobby">
            <div className="lobby-top">
                <div className="lobby-picker">
                    <p className="lobby-hint">
                        {canHover
                            ? "Hover a number to preview its cartela, then click to take it."
                            : "Tap a number to preview its cartela, then take it."}
                    </p>

                    <div className="lobby-grid">
                        {CARTELA_NUMBERS.map((serial) => (
                            <button
                                key={serial}
                                type="button"
                                className={`lobby-cell ${preview === serial ? "previewing" : ""}`}
                                style={{ ["--cell-color" as string]: serialColor(serial) }}
                                onMouseEnter={() => setHovered(serial)}
                                onMouseLeave={() => setHovered((prev) => (prev === serial ? null : prev))}
                                onFocus={() => setHovered(serial)}
                                onBlur={() => setHovered((prev) => (prev === serial ? null : prev))}
                                onClick={() => handleCell(serial)}
                                title={`Cartela ${serial} · buy-in $${bet}`}
                                aria-label={`Select cartela ${serial}`}
                                aria-pressed={joining === serial || picked === serial}
                            >
                                {serial}
                            </button>
                        ))}
                    </div>
                </div>

                <aside className="lobby-preview" aria-live="polite">
                    <div className="lobby-preview-head">
                        <span className="lobby-preview-label">CARTELA</span>
                        <span className="lobby-preview-id">{previewCard.id}</span>
                    </div>

                    <div className="lobby-preview-grid">
                        {COLUMN_LETTERS.map((letter) => (
                            <span key={letter} style={{ color: COLUMN_COLORS[letter] }}>
                                {letter}
                            </span>
                        ))}
                        {previewCard.grid.flat().map((value, index) => (
                            <span
                                key={index}
                                className={`lobby-preview-cell ${
                                    value === "FREE"
                                        ? "free"
                                        : `col-${COLUMN_LETTERS[index % 5]}`
                                }`}
                            >
                                {value}
                            </span>
                        ))}
                    </div>

                    <div className="lobby-preview-meta">
                        <span>Cartela number {preview}</span>
                        <span>Buy-in ${bet}</span>
                    </div>

                    <button
                        type="button"
                        className="btn primary lobby-take"
                        onClick={() => setJoining(preview)}
                    >
                        TAKE CARTELA {preview}
                    </button>
                </aside>
            </div>

            {joining !== null && (
                <div className="lobby-waiting" role="status" aria-live="assertive">
                    <div className="lobby-waiting-card">
                        <div className="lobby-countdown" aria-hidden="true">
                            {secondsLeft}
                        </div>
                        <div className="lobby-kicker">GET READY!</div>
                        <p className="lobby-waiting-body">
                            Waiting for the other players to take their seats…
                        </p>
                        <div className="lobby-progress">
                            <div className="lobby-progress-fill" style={{ width: `${progress}%` }} />
                        </div>
                        <button type="button" className="btn ghost" onClick={() => setJoining(null)}>
                            CANCEL
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};