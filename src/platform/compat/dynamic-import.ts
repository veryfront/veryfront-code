/**
 * Opaque dynamic import helper.
 *
 * The specifier is a runtime parameter, so bundlers and `deno compile` cannot
 * resolve it to a concrete module and will not trace into it. That opacity is
 * what this helper exists for.
 *
 * This deliberately does NOT use `new Function`. This module is reachable from
 * client bundles (`veryfront/chat`, `veryfront/mdx`, `veryfront/workflow` all
 * pull it in transitively), and the CSP served for project pages does not allow
 * `'unsafe-eval'`. A `new Function` here throws `EvalError` in the browser
 * before hydration can start, which blanks the page.
 *
 * @module platform/compat
 */

export const dynamicImport = <T = unknown>(specifier: string): Promise<T> =>
  import(specifier) as Promise<T>;
