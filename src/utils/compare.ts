/**
 * Stable comparators for explicit `Array.prototype.sort` calls.
 *
 * A bare `.sort()` sorts by UTF-16 code unit, which is deterministic but easy to
 * misread as accidental. `.sort(compareStrings)` states that intent, and orders
 * identically to a bare `.sort()` on a `string[]`.
 *
 * Prefer this over `String.prototype.localeCompare` anywhere the order reaches a
 * cache key, a content hash, a generated artifact, or a snapshot assertion:
 * `localeCompare` depends on the host's locale and ICU build, so the same input
 * can sort differently on a developer machine and in CI.
 */
export function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Compares by an extracted string key, using {@link compareStrings}.
 */
export function compareBy<T>(
  select: (value: T) => string,
): (left: T, right: T) => number {
  return (left, right) => compareStrings(select(left), select(right));
}
