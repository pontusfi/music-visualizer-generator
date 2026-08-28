/**
 * The looks, by id.
 *
 * A look is `{ id, name, draw(ctx, sig, assets), init?(assets) }`. Adding one
 * means adding a file here and a name to the picker in the UI; nothing else in
 * the pipeline needs to know about it.
 */

import * as burn from "./burn.js";
import * as orbit from "./orbit.js";
import * as shear from "./shear.js";

export const LOOKS = {
  [burn.id]: burn,
  [orbit.id]: orbit,
  [shear.id]: shear,
};

export const DEFAULT_LOOK = burn.id;
export const LOOK_IDS = Object.keys(LOOKS);
