/**
 * LEVEL DESIGN & ASCII LAYOUT MAPS
 * Keep level progression, ASCII matrices, and chunk layouts in this file.
 * Adding new levels or modifying terrain should edit this file directly.
 * Follow Kishōtenketsu pacing (Ki: safe intro -> Shō: develop -> Ten: twist -> Ketsu: goal).
 *
 * Legend:
 *   #  ground / solid wall (static collider: setDisplaySize(TILE, TILE).refreshBody())
 *   -  floating platform (static collider: setDisplaySize(TILE, 16).refreshBody())
 *   P  player spawn point (hitbox: body.setSize(w, h, true) centered)
 *   C  collectible item (coins / gems, allowGravity: false)
 *   S  hazard (spikes / saws)
 *   E  enemy spawn point
 *   F  level goal / flag / portal
 *   .  empty air (all lower rows under pits must be '.' down to kill plane)
 *
 * Ground Collision Tip: For flat ground runs '#', set `tile.body.checkCollision.left = false; tile.body.checkCollision.right = false;`
 * to prevent the player body from snagging on internal vertical tile seams.
 */

export const TILE = 32;

export const LEVEL_1: string[] = [
    "................................",
    "................................",
    ".......C...C....................",
    "......---.---...............F...",
    "..P...............C...S.........",
    "################################",
];

export const LEVEL_2: string[] = [
    "................................",
    "................C...............",
    "..........C...-----.............",
    ".....C...---.........C......F...",
    "..P..................S..E.......",
    "######...#####...###############",
];

export const LEVELS = [LEVEL_1, LEVEL_2];
export const LEVEL_MAP = LEVEL_1;
