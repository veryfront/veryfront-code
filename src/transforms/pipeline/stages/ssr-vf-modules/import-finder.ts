/**
 * Import discovery functions for the SSR VF Modules stage.
 */

import { parseImports } from "../../../esm/lexer.ts";

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Find all /_vf_modules/_veryfront/ imports in the code.
 * Only matches framework modules, not user project files.
 */
export async function findVfModuleImports(code: string): Promise<string[]> {
  const imports = await parseImports(code);
  return unique(
    imports
      .map((imp) => imp.n)
      .filter((specifier): specifier is string =>
        specifier?.startsWith("/_vf_modules/_veryfront/") === true ||
        specifier?.startsWith("file:///_vf_modules/_veryfront/") === true
      ),
  );
}

/**
 * Find all relative imports (./foo, ../bar) in the code.
 * Returns array of specifiers.
 */
export async function findRelativeImports(code: string): Promise<string[]> {
  const imports = await parseImports(code);
  return unique(
    imports
      .map((imp) => imp.n)
      .filter((specifier): specifier is string =>
        specifier?.startsWith("./") === true ||
        specifier?.startsWith("../") === true
      ),
  );
}
