/**
 * Contract interface for ES module lexers.
 *
 * Parses ES module import/export specifiers from source code.
 * Kept separate from {@link Bundler} because the surfaces are orthogonal:
 * a lexer only inspects specifier positions, while a bundler compiles and
 * emits output.
 *
 * Default implementation: `@veryfront/ext-esbuild` (backed by `es-module-lexer`).
 *
 * @module extensions/interfaces/module-lexer
 */

/**
 * A single import specifier position record, matching the shape produced by
 * `es-module-lexer`.
 */
export interface ImportSpecifier {
  /** Module specifier (e.g. "react"). Undefined when the specifier cannot be statically resolved (dynamic import with non-literal expression, or import.meta). */
  n: string | undefined;
  /** Start of module specifier. */
  s: number;
  /** End of module specifier. */
  e: number;
  /** Start of import statement. */
  ss: number;
  /** End of import statement. */
  se: number;
  /** Index of the dynamic import token in the source; -1 for static imports, -2 for import.meta. */
  d: number;
  /** Start position of the import attributes (with/assert) block in the source; -1 if none. */
  a: number;
}

/**
 * Module lexer contract interface.
 *
 * Implementations parse ES module import specifiers from source code and
 * return positional records suitable for further rewriting.
 */
export interface ModuleLexer {
  /** Optional async initialization (e.g., loading WASM). Called lazily by the default impl before first parse. */
  init?(): Promise<void>;
  /** Parse ES module import/export specifiers from source code. */
  parse(code: string): readonly ImportSpecifier[];
}
