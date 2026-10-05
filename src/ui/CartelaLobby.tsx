import { COLUMN_COLORS, COLUMN_LETTERS } from "../game/config";

/** Cartelas on sale in the lobby — buttons are numbered 1 to 200. */
export const CARTELA_COUNT = 200;

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
 * First screen of the session: the lobby. A grid of 1-200 cartela buttons laid
 * out like the master board. Picking one boots the Phaser room and deals the
 * cartela under that serial.
 */
export const CartelaLobby = ({ balance, bet, onSelect }: CartelaLobbyProps) => (
    <div id="lobby">
        <p className="lobby-hint">Pick a cartela number to take your seat in the room.</p>

        <div className="lobby-grid">
            {CARTELA_NUMBERS.map((serial) => (
                <button
                    key={serial}
                    type="button"
                    className="lobby-cell"
                    style={{ ["--cell-color" as string]: serialColor(serial) }}
                    onClick={() => onSelect(serial)}
                    title={`Cartela ${serial} · buy-in $${bet}`}
                    aria-label={`Select cartela ${serial}`}
                >
                    {serial}
                </button>
            ))}
        </div>
    </div>
);
