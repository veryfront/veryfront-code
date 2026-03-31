/**
 * Animation state for accessibility
 *
 * Controls whether CLI animations (spinners, progress bars) are disabled.
 * Set by --no-animation flag or when TERM=dumb.
 *
 * @module cli/shared/animation
 */

let _animationDisabled = false;

export function setAnimationDisabled(disabled: boolean): void {
  _animationDisabled = disabled;
}

export function isAnimationDisabled(): boolean {
  return _animationDisabled;
}
