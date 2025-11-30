import { init, parse } from "es-module-lexer";

let initPromise: Promise<void> | null = null;

export async function initLexer() {
  if (!initPromise) {
    // es-module-lexer@1.5 exports init as a Promise (not a function) in ESM build
    // but some typings expect a function. Handle both to avoid type errors.
    const anyInit = init as unknown;
    initPromise = typeof anyInit === "function" ? (anyInit as () => Promise<void>)() : (anyInit as Promise<void>);
  }
  await initPromise;
}

export type ImportSpecifier = {
  n: string | undefined; // The module specifier (e.g., "react")
  s: number; // Start of module specifier
  e: number; // End of module specifier
  ss: number; // Start of import statement
  se: number; // End of import statement
  d: number; // > -1 if dynamic import
  a: number; // assert index
};

export async function parseImports(code: string): Promise<readonly ImportSpecifier[]> {
  await initLexer();
  return parse(code)[0];
}

/**
 * Replace import specifiers (the path string) in the code.
 * Safe for simple re-mappings like aliases or rewriting URLs.
 */
export async function replaceSpecifiers(
  code: string,
  replacer: (specifier: string, isDynamic: boolean) => string | null | undefined
): Promise<string> {
  const imports = await parseImports(code);
  let result = code;

  // Process in reverse order to maintain indices
  for (let i = imports.length - 1; i >= 0; i--) {
    const imp = imports[i];
    if (!imp) continue;
    if (imp.n === undefined) continue;

    const replacement = replacer(imp.n, imp.d > -1);
    
    if (replacement && replacement !== imp.n) {
      // Replace only the specifier part [s, e]
      // imp.s and imp.e are indices in the original string.
      // Since we modify 'result' from right to left, these indices are valid for 'result' too (for the parts to the left).
      const before = result.substring(0, imp.s);
      const after = result.substring(imp.e);
      result = before + replacement + after;
    }
  }

  return result;
}

/**
 * Rewrite entire import statements.
 * Useful for complex transformations like vendor splitting.
 */
export async function rewriteImports(
  code: string,
  rewriter: (imp: ImportSpecifier, statement: string) => string | null
): Promise<string> {
  const imports = await parseImports(code);
  let result = code;

  for (let i = imports.length - 1; i >= 0; i--) {
    const imp = imports[i];
    if (!imp) continue;
    
    // Extract the full statement from the ORIGINAL code (indices are stable)
    const statement = code.substring(imp.ss, imp.se);
    
    const replacement = rewriter(imp, statement);
    
    if (replacement !== null) {
      const before = result.substring(0, imp.ss);
      const after = result.substring(imp.se);
      result = before + replacement + after;
    }
  }

  return result;
}
