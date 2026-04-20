/**
 * Inline implementation of the `clsx` class-name joining utility.
 *
 * Matches the public surface veryfront uses from `clsx` (named `clsx` export
 * plus a `ClassValue` type and default export alias). Replaces the `clsx`
 * npm dep per spec §8.3 (inline micro-utilities in core).
 */

export type ClassValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Record<string, unknown>
  | ClassValue[];

type Value = ClassValue;

export function clsx(...args: Value[]): string {
  const out: string[] = [];
  for (const arg of args) {
    if (!arg) continue;
    if (typeof arg === "string" || typeof arg === "number") {
      out.push(String(arg));
    } else if (Array.isArray(arg)) {
      const inner = clsx(...arg);
      if (inner) out.push(inner);
    } else if (typeof arg === "object") {
      for (const [key, value] of Object.entries(arg)) {
        if (value) out.push(key);
      }
    }
  }
  return out.join(" ");
}

export default clsx;
