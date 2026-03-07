/**
 * Opaque dynamic import helper.
 *
 * Uses `new Function` to hide the `import()` call from static analysis
 * by bundlers and `deno compile`, preventing them from tracing into
 * the imported specifier.
 *
 * @module platform/compat
 */

export const dynamicImport = new Function("specifier", "return import(specifier)") as <
  T = unknown,
>(
  specifier: string,
) => Promise<T>;
