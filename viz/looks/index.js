/**
 * The looks, by id.
 *
 * A look is `{ id, name, draw(ctx, sig, assets), init?(assets) }`. Adding one
 * means adding a file here and a name to the picker in the UI; nothing else in
 * the pipeline needs to know about it.
 *
 * Each has an intended background — `wake`/`bloodtide`, `pyre`/`emberstorm`,
 * `miasma`/`choke`, `chrome`/`smelt`, `totem`/`storm` — but the pairing is a
 * suggestion, not a constraint: every look composes over every background.
 * `wake` is the one that reads its partner, importing `HORIZON` from
 * `bloodtide` so the plate stands exactly on the waterline; over anything else
 * it puts its horizon at the same proportion and still stands up.
 */

import * as chrome from "./chrome.js";
import * as miasma from "./miasma.js";
import * as pyre from "./pyre.js";
import * as totem from "./totem.js";
import * as wake from "./wake.js";

export const LOOKS = {
  [wake.id]: wake,
  [pyre.id]: pyre,
  [miasma.id]: miasma,
  [chrome.id]: chrome,
  [totem.id]: totem,
};

// the one that leaves the artwork most nearly intact: no smoke eating it, no
// char, no silhouette pass, and the cheapest draw path of the five
export const DEFAULT_LOOK = chrome.id;
export const LOOK_IDS = Object.keys(LOOKS);
