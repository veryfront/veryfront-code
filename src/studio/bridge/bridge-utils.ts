/**
 * Bridge Utilities
 *
 * Small shared helpers used across bridge modules.
 */

export interface DebouncedFunction<This, Args extends unknown[]> {
  (this: This, ...args: Args): void;
  cancel(): void;
}

export function debounce<This, Args extends unknown[]>(
  fn: (this: This, ...args: Args) => void,
  ms: number,
): DebouncedFunction<This, Args> {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError("Debounce delay must be a finite non-negative number");
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const debounced = function (this: This, ...args: Args): void {
    cancel();
    timer = setTimeout(() => {
      timer = undefined;
      fn.apply(this, args);
    }, ms);
  };
  return Object.assign(debounced, { cancel });
}
