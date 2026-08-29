/**
 * The backgrounds, by id.
 *
 * A background is `{ id, name, draw(ctx, sig, assets), init?(assets) }` — the
 * exact shape a look is, so `viz/main.js` resolves `?bg=` the same way it
 * resolves `?look=`. `draw` lays the ground fill itself; a look's opening
 * becomes `bg.draw(ctx, s, a)` in place of its own `fillRect`.
 *
 * There is no "flat" or "none" entry: every render is meant to come out on a
 * chosen field, never dead ground, so that option does not exist to pick.
 */
import * as drift from "./drift.js";
import * as dust from "./dust.js";
import * as grid from "./grid.js";
import * as nebula from "./nebula.js";
import * as rays from "./rays.js";

export const BACKGROUNDS = {
  [drift.id]: drift,
  [nebula.id]: nebula,
  [rays.id]: rays,
  [dust.id]: dust,
  [grid.id]: grid,
};

// the quietest of the five, so an existing render changes the least
export const DEFAULT_BACKGROUND = drift.id;
export const BACKGROUND_IDS = Object.keys(BACKGROUNDS);
