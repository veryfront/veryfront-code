/**
 * Animation state for accessibility
 *
 * Controls whether CLI animations (spinners, progress bars) are disabled.
 * Set by --no-animation flag or when TERM=dumb.
 *
 * @module cli/shared/animation
 */

import { getEnv } from "veryfront/platform";

let _animationDisabled = false;

export function setAnimationDisabled(disabled: boolean): void {
  _animationDisabled = disabled;
}

export function isAnimationDisabled(): boolean {
  if (_animationDisabled) return true;
  return getEnv("TERM") === "dumb";
}
