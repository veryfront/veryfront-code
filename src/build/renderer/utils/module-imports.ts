import { parseAllImports } from "#veryfront/transforms/import-rewriter/parse-cache.ts";
import type { ImportSpecifierInfo } from "#veryfront/transforms/import-rewriter/types.ts";

export interface ModuleImportLocation {
  specifier: string;
  dynamic: boolean;
  /** Start offset of the complete string literal, including quotes. */
  start: number;
  /** End offset of the complete string literal, including quotes. */
  end: number;
}

function getLiteralRange(
  moduleImport: ImportSpecifierInfo,
  code: string,
): { start: number; end: number } {
  if (moduleImport.isDynamic) {
    const quote = code[moduleImport.start];
    if (
      (quote !== '"' && quote !== "'" && quote !== "`") ||
      code[moduleImport.end - 1] !== quote
    ) {
      throw new TypeError("Module lexer returned an invalid dynamic-import literal range");
    }
    return { start: moduleImport.start, end: moduleImport.end };
  }

  const start = moduleImport.start - 1;
  const end = moduleImport.end + 1;
  const quote = code[start];
  if (
    start < 0 ||
    (quote !== '"' && quote !== "'") ||
    code[end - 1] !== quote
  ) {
    throw new TypeError("Module lexer returned an invalid static-import literal range");
  }
  return { start, end };
}

function restoreMaskedUrls(
  code: string,
  urlMap: ReadonlyMap<string, string>,
): string {
  let restored = code;
  for (const [placeholder, url] of urlMap) {
    restored = restored.replaceAll(placeholder, url);
  }
  return restored;
}

function protectReplacementFromUrlUnmasking(
  serialized: string,
  urlMap: ReadonlyMap<string, string>,
): string {
  let protectedLiteral = serialized;
  for (const placeholder of urlMap.keys()) {
    // The lexer mask uses an underscore-prefixed identifier. Encode the first
    // underscore in replacement literals so the later source unmask cannot
    // rewrite caller-controlled replacement text that resembles a placeholder.
    if (!placeholder.startsWith("_")) {
      throw new TypeError("Module lexer returned an unsupported URL placeholder");
    }
    protectedLiteral = protectedLiteral.replaceAll(
      placeholder,
      `\\u005f${placeholder.slice(1)}`,
    );
  }
  return protectedLiteral;
}

/** Parse actual ESM dependencies without matching comments or string contents. */
export async function parseModuleImports(
  code: string,
): Promise<ModuleImportLocation[]> {
  const parsed = await parseAllImports(code);
  return parsed.imports.map((moduleImport) => {
    const range = getLiteralRange(moduleImport, parsed.maskedCode);
    return {
      specifier: moduleImport.specifier,
      dynamic: moduleImport.isDynamic,
      ...range,
    };
  });
}

/** Return unique module specifiers in deterministic source order. */
export async function getModuleDependencies(code: string): Promise<string[]> {
  const imports = await parseModuleImports(code);
  return [...new Set(imports.map(({ specifier }) => specifier))];
}

/**
 * Replace parsed module string literals with safely serialized specifiers.
 *
 * Replacements are applied from the end so source offsets stay valid. Import
 * attributes and dynamic-import options lie outside the replaced literal.
 */
export async function replaceModuleImportSpecifiers(
  code: string,
  replacements: ReadonlyMap<string, string>,
): Promise<string> {
  if (replacements.size === 0) return code;

  const parsed = await parseAllImports(code);
  let rewritten = parsed.maskedCode;
  for (let index = parsed.imports.length - 1; index >= 0; index--) {
    const moduleImport = parsed.imports[index]!;
    const replacement = replacements.get(moduleImport.specifier);
    if (
      replacement === undefined ||
      replacement === moduleImport.specifier
    ) {
      continue;
    }

    const range = getLiteralRange(moduleImport, parsed.maskedCode);
    const serialized = protectReplacementFromUrlUnmasking(
      JSON.stringify(replacement),
      parsed.urlMap,
    );
    rewritten = rewritten.slice(0, range.start) + serialized +
      rewritten.slice(range.end);
  }

  return restoreMaskedUrls(rewritten, parsed.urlMap);
}
