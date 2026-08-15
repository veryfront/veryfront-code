/**
 * Import specifier query/hash suffix splitting.
 *
 * @module transforms/shared/specifier-suffix
 */

const ReflectApply = Reflect.apply;
const StringIndexOf = String.prototype.indexOf;
const StringSlice = String.prototype.slice;

function stringIndexOf(value: string, search: string): number {
  return ReflectApply(StringIndexOf, value, [search]) as number;
}

function stringSlice(value: string, start: number, end?: number): string {
  return ReflectApply(StringSlice, value, end === undefined ? [start] : [start, end]) as string;
}

/** A specifier split into its path and its trailing `?query` / `#hash`. */
export interface SplitSpecifier {
  readonly path: string;
  readonly suffix: string;
}

/**
 * Split an import specifier into the path and everything from the first `?` or
 * `#` onward, whichever comes first.
 *
 * The cut is at whichever delimiter appears first, not at `?` by preference:
 * `@/a#b?c` is a hash whose fragment happens to contain a `?`, so the suffix is
 * `#b?c` and the path is `@/a`. Splitting on `?` there would leave `#b` stuck
 * on the path and no file would resolve.
 *
 * This is the single definition of that rule. It previously existed as three
 * separate copies across the alias, nested-import and HTTP-cache resolvers,
 * which agreed only by coincidence.
 */
export function splitSpecifierSuffix(specifier: string): SplitSpecifier {
  const queryStart = stringIndexOf(specifier, "?");
  const hashStart = stringIndexOf(specifier, "#");
  const suffixStart = queryStart === -1
    ? hashStart
    : hashStart === -1
    ? queryStart
    : Math.min(queryStart, hashStart);

  if (suffixStart === -1) return { path: specifier, suffix: "" };
  return {
    path: stringSlice(specifier, 0, suffixStart),
    suffix: stringSlice(specifier, suffixStart),
  };
}
