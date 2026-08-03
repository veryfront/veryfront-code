import { isAbsolute, relative } from "../compat/path/index.ts";

/**
 * Test whether an absolute candidate is equal to or beneath an absolute root.
 *
 * The Veryfront path facade deliberately returns portable `/` separators on
 * every host, including Windows. Containment must therefore use the facade's
 * contract instead of the native runtime separator.
 */
export function isPathContainedBy(candidate: string, root: string): boolean {
  const relation = relative(root, candidate);
  return relation === "." ||
    (relation !== ".." && !relation.startsWith("../") && !isAbsolute(relation));
}
