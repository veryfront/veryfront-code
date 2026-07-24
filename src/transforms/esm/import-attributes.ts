/**
 * Import attribute rewrites anchored to lexer-reported positions.
 *
 * Every edit here is bounded by a range es-module-lexer reported for a real
 * import statement, so module source embedded in a string literal (the
 * `#deno-config` stub, the generated RSC bundles) is never touched. A plain
 * regex over the module text cannot make that distinction.
 *
 * @module transforms/esm/import-attributes
 */

import { type ImportSpecifier, parseMaskedImports } from "./lexer.ts";

const ASSERT_KEYWORD = "assert";

/**
 * The legacy `assert` keyword following a static import specifier.
 *
 * es-module-lexer 2 no longer models assertions, so it ends the statement at
 * the specifier and the clause sits immediately after it. Matching is confined
 * to the specifier's own line, which is what the withdrawn grammar required.
 */
const STATIC_ASSERT_KEYWORD = /[^\S\r\n]*assert(?=[\s{])/y;

/** The legacy `assert` key opening the options argument of a dynamic import. */
const DYNAMIC_ASSERT_KEY = /^\s*,\s*\{\s*assert(?=\s*:)/;

/** A `with` clause on a static import, capturing the attribute object. */
const STATIC_WITH_CLAUSE = /^\s*with\s*(\{[^{}]*\})\s*$/;

/** The options argument of a dynamic import, capturing the attribute object. */
const DYNAMIC_WITH_ARGUMENT = /^\s*,\s*\{\s*with\s*:\s*(\{[^{}]*\})\s*,?\s*\}\s*$/;

/** An attribute object declaring a JSON module type and nothing else. */
const JSON_TYPE_ATTRIBUTE = /^\{\s*(["']?)type\1\s*:\s*(["'])json\2\s*,?\s*\}$/;

/**
 * The range holding everything a specifier declares after its own text: the
 * `with` clause of a static import, or the options argument of a dynamic one.
 *
 * The range is empty when the import declares no attributes.
 */
function attributeRange(imp: ImportSpecifier): { start: number; end: number } {
  // Static: `e` indexes the closing quote and `se` ends the statement before
  // any semicolon, so the clause and its keyword lie between them.
  if (imp.d === -1) return { start: imp.e + 1, end: imp.se };

  // Dynamic: `e` is already past the closing quote and `se` is past the
  // closing paren, so the comma and the options argument lie between them.
  return { start: imp.e, end: imp.se - 1 };
}

/** Whether the declared attributes are exactly a JSON module type. */
function declaresJsonTypeOnly(clause: string, isDynamic: boolean): boolean {
  const attributes = (isDynamic ? DYNAMIC_WITH_ARGUMENT : STATIC_WITH_CLAUSE).exec(clause)?.[1];
  return attributes !== undefined && JSON_TYPE_ATTRIBUTE.test(attributes);
}

/** Position of the legacy `assert` keyword this import uses, or `null`. */
function findAssertKeyword(masked: string, imp: ImportSpecifier): number | null {
  if (imp.d === -1) {
    STATIC_ASSERT_KEYWORD.lastIndex = imp.se;
    const match = STATIC_ASSERT_KEYWORD.exec(masked);
    return match === null ? null : STATIC_ASSERT_KEYWORD.lastIndex - ASSERT_KEYWORD.length;
  }

  const { start, end } = attributeRange(imp);
  if (start >= end) return null;

  const match = DYNAMIC_ASSERT_KEY.exec(masked.slice(start, end));
  return match === null ? null : start + match[0].length - ASSERT_KEYWORD.length;
}

/**
 * Rewrite the withdrawn `assert` spelling of an import attribute clause to
 * `with`, for both the static and the dynamic form.
 *
 * esbuild treats `import-assertions` as a feature separate from
 * `import-attributes` and drops the clause when the configured target does not
 * claim it, which turns a working JSON import into "Attempted to load JSON
 * module without specifying \"type\": \"json\"" at load time. Preserving the
 * clause verbatim is no better: Node 22 and Deno 2 removed the keyword, so the
 * only output that runs anywhere is `with`.
 */
export async function upgradeImportAssertions(code: string): Promise<string> {
  if (!code.includes(ASSERT_KEYWORD)) return code;

  const { masked, imports, unmask } = await parseMaskedImports(code);
  let result = masked;

  for (let i = imports.length - 1; i >= 0; i--) {
    const imp = imports[i];
    if (!imp?.n) continue;

    const keyword = findAssertKeyword(masked, imp);
    if (keyword === null) continue;

    result = result.slice(0, keyword) + "with" + result.slice(keyword + ASSERT_KEYWORD.length);
  }

  return unmask(result);
}

/**
 * Drop `with { type: "json" }` from every import whose specifier the caller
 * accepts, leaving all other attributes in place.
 *
 * Only a lone JSON type attribute is removed. An import that declares anything
 * else is describing something this rewrite knows nothing about, so it is left
 * exactly as written.
 */
export async function stripJsonImportAttributes(
  code: string,
  shouldStrip: (specifier: string) => boolean,
): Promise<string> {
  if (!code.includes("with")) return code;

  const { masked, imports, unmask } = await parseMaskedImports(code);
  let result = masked;

  for (let i = imports.length - 1; i >= 0; i--) {
    const imp = imports[i];
    if (!imp?.n) continue;
    if (!shouldStrip(unmask(imp.n))) continue;

    const { start, end } = attributeRange(imp);
    if (start >= end) continue;
    if (!declaresJsonTypeOnly(masked.slice(start, end), imp.d > -1)) continue;

    result = result.slice(0, start) + result.slice(end);
  }

  return unmask(result);
}
