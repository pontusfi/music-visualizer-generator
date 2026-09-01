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
 *
 * All five are built from the baked sheets in `viz/fields.js` — plume, cloud
 * and ray sheets that wrap, particle tables with analytic motion, and
 * midpoint-displacement bolts seeded from the frame index of the strike. The
 * expensive half runs once in `init`; a frame costs a handful of blits.
 */
import * as bloodtide from "./bloodtide.js";
import * as choke from "./choke.js";
import * as emberstorm from "./emberstorm.js";
import * as smelt from "./smelt.js";
import * as storm from "./storm.js";

export const BACKGROUNDS = {
  [bloodtide.id]: bloodtide,
  [emberstorm.id]: emberstorm,
  [choke.id]: choke,
  [smelt.id]: smelt,
  [storm.id]: storm,
};

// the partner of DEFAULT_LOOK: `chrome` hangs the record over a mirror pool,
// and Smelt is the field that puts something under it worth reflecting
export const DEFAULT_BACKGROUND = smelt.id;
export const BACKGROUND_IDS = Object.keys(BACKGROUNDS);
