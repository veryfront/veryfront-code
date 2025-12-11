import { init, parse } from "es-module-lexer";

let initPromise: Promise<void> | null = null;

export async function initLexer() {
  if (!initPromise) {
    const anyInit = init as unknown;
    initPromise = typeof anyInit === "function"
      ? (anyInit as () => Promise<void>)()
      : (anyInit as Promise<void>);
  }
  await initPromise;
}

export type ImportSpecifier = {
  n: string | undefined;
  s: number;
  e: number;
  ss: number;
  se: number;
  d: number;
  a: number;
};

export async function parseImports(code: string): Promise<readonly ImportSpecifier[]> {
  await initLexer();
  return parse(code)[0];
}

export async function replaceSpecifiers(
  code: string,
  replacer: (specifier: string, isDynamic: boolean) => string | null | undefined,
): Promise<string> {
  const imports = await parseImports(code);
  let result = code;

  for (let i = imports.length - 1; i >= 0; i--) {
    const imp = imports[i];
    if (!imp) continue;
    if (imp.n === undefined) continue;

    const replacement = replacer(imp.n, imp.d > -1);

    if (replacement && replacement !== imp.n) {
      const before = result.substring(0, imp.s);
      const after = result.substring(imp.e);
      result = before + replacement + after;
    }
  }

  return result;
}

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

    if (replacement !== null) {
      const before = result.substring(0, imp.ss);
      const after = result.substring(imp.se);
      result = before + replacement + after;
    }
  }

  return result;
}
