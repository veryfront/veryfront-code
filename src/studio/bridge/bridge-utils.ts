/**
 * Bridge Utilities
 *
 * Small shared helpers used across bridge modules.
 */

// deno-lint-ignore no-explicit-any -- generic debounce must accept any function signature
export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // deno-lint-ignore no-explicit-any -- preserving original this/args for forwarding
  return function (this: any, ...args: any[]) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
    }, ms);
  } as unknown as T;
}
