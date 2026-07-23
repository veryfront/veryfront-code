/**
 * Inline implementation of the `clsx` class-name joining utility.
 *
 * API-compatible with the MIT-licensed `clsx` npm package — this is a
 * clean-room rewrite against the public API surface veryfront uses (named
 * `clsx` export and `ClassValue` type); no source was copied.
 *
 * Replaces the `clsx` npm dep per spec §8.3 (inline micro-utilities in core).
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
type PendingFrame = { value: Value } | { exit: ClassValue[] };

export function clsx(...args: Value[]): string {
  const out: string[] = [];
  const pending: PendingFrame[] = args.map((value) => ({ value })).reverse();
  const activeArrays = new WeakSet<ClassValue[]>();

  while (pending.length > 0) {
    const frame = pending.pop()!;
    if ("exit" in frame) {
      activeArrays.delete(frame.exit);
      continue;
    }

    const arg = frame.value;
    if (!arg) continue;
    if (typeof arg === "string" || typeof arg === "number") {
      out.push(String(arg));
    } else if (Array.isArray(arg)) {
      if (activeArrays.has(arg)) continue;
      activeArrays.add(arg);
      pending.push({ exit: arg });
      for (let index = arg.length - 1; index >= 0; index--) {
        pending.push({ value: arg[index] });
      }
    } else if (typeof arg === "object") {
      for (const [key, value] of Object.entries(arg)) {
        if (value) out.push(key);
      }
    }
  }
  return out.join(" ");
}
