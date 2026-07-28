import { logger as baseLogger } from "#veryfront/utils";
import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type { ImportSpecifier, ModuleLexer } from "#veryfront/extensions/bundler/module-lexer.ts";

export type { ImportSpecifier };

const logger = baseLogger.component("es-module-lexer");

let initPromise: Promise<void> | null = null;

function getLexer(): ModuleLexer {
  return resolveContract<ModuleLexer>("ModuleLexer");
}

export async function initLexer(): Promise<void> {
  if (initPromise) {
    await initPromise;
    return;
  }

  const lexer = getLexer();
  initPromise = lexer.init ? lexer.init() : Promise.resolve();
  await initPromise;
}

function logParseError(error: unknown, code: string): void {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const match = errorMsg.match(/@:(\d+):(\d+)/);
  if (!match) return;

  const line = Number.parseInt(match[1] ?? "", 10);
  const col = Number.parseInt(match[2] ?? "", 10);
  const lines = code.split("\n");
  const start = Math.max(0, line - 3);

  const context = lines
    .slice(start, line + 2)
    .map((l, i) => {
      const lineNum = start + i + 1;
      const prefix = lineNum === line ? ">>> " : "    ";
      const snippet = l.length > 200 ? `${l.substring(0, 200)}...` : l;
      return `${prefix}${lineNum}: ${snippet}`;
    })
    .join("\n");

  logger.error("Parse error", { line, col, context });
}

export async function parseImports(code: string): Promise<readonly ImportSpecifier[]> {
  await initLexer();

  try {
    return getLexer().parse(code);
  } catch (error) {
    logParseError(error, code);
    throw error;
  }
}

/** @deprecated Use {@link parseImports}; source masking is no longer required. */
export interface MaskedParse {
  /** Original source code. The field name is retained for compatibility. */
  masked: string;
  /** Specifiers whose every positional field indexes into {@link masked}. */
  imports: readonly ImportSpecifier[];
  /** Identity function retained for compatibility. */
  unmask: (text: string) => string;
}

/**
 * Compatibility wrapper around {@link parseImports}.
 *
 * @deprecated Parse the original source with {@link parseImports} and apply
 * edits directly to it.
 */
export async function parseMaskedImports(code: string): Promise<MaskedParse> {
  const imports = await parseImports(code);
  return { masked: code, imports, unmask: (text) => text };
}

/**
 * Replace import specifiers (the path string) in the code.
 * Safe for simple re-mappings like aliases or rewriting URLs.
 */
export async function replaceSpecifiers(
  code: string,
  replacer: (specifier: string, isDynamic: boolean) => string | null | undefined,
): Promise<string> {
  const imports = await parseImports(code);
  let result = code;

  for (let i = imports.length - 1; i >= 0; i--) {
    const imp = imports[i];
    if (!imp?.n) continue;

    const originalSpecifier = imp.n;
    const isDynamic = imp.d > -1;
    const replacement = replacer(originalSpecifier, isDynamic);

    if (!replacement || replacement === originalSpecifier) continue;

    if (!isDynamic) {
      result = result.substring(0, imp.s) + replacement + result.substring(imp.e);
      continue;
    }

    // For dynamic imports with string literals, es-module-lexer's s/e include the quotes.
    // We need to preserve the quote style when replacing.
    const quote = result[imp.s];
    if (quote === '"' || quote === "'" || quote === "`") {
      result = result.substring(0, imp.s) + quote + replacement + quote + result.substring(imp.e);
      continue;
    }

    // Dynamic import with expression, not string literal - shouldn't happen if n is defined
    result = result.substring(0, imp.s) + replacement + result.substring(imp.e);
  }

  return result;
}

/**
 * Rewrite entire import statements.
 * Useful for complex transformations like vendor splitting.
 */
export async function rewriteImports(
  code: string,
  rewriter: (imp: ImportSpecifier, statement: string) => string | null,
): Promise<string> {
  const imports = await parseImports(code);
  let result = code;

  for (let i = imports.length - 1; i >= 0; i--) {
    const imp = imports[i];
    if (!imp) continue;

    const statement = code.substring(imp.ss, imp.se);

    const replacement = rewriter(imp, statement);
    if (replacement === null) continue;

    result = result.substring(0, imp.ss) + replacement + result.substring(imp.se);
  }

  return result;
}
