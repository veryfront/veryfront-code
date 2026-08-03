import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { CodeParser } from "#veryfront/extensions/parser/index.ts";
import {
  hasUseClientDirective,
  hasUseServerDirective,
} from "#veryfront/rendering/rsc/page-island.ts";

export type BrowserModuleBoundaryViolation =
  | { kind: "conflicting" }
  | { kind: "module-server" }
  | { kind: "function-server" }
  | { kind: "parse-error" };

/**
 * Find server-only boundaries that cannot be emitted in a browser bundle.
 * Function directive semantics belong to the active parser implementation so
 * this check does not depend on one provider's AST shape. Syntax or parser
 * capabilities that cannot be analyzed fail closed.
 */
export async function inspectBrowserModuleBoundary(
  source: string,
  path: string,
): Promise<BrowserModuleBoundaryViolation | null> {
  const hasModuleServerDirective = hasUseServerDirective(source);
  if (hasModuleServerDirective) {
    return hasUseClientDirective(source, path)
      ? { kind: "conflicting" }
      : { kind: "module-server" };
  }

  const parser = tryResolve<CodeParser>("CodeParser");
  if (!parser?.hasFunctionDirective) return { kind: "parse-error" };

  try {
    return await parser.hasFunctionDirective({
        code: source,
        filePath: path,
        directive: "use server",
      })
      ? { kind: "function-server" }
      : null;
  } catch {
    return { kind: "parse-error" };
  }
}

export function describeBrowserModuleBoundaryViolation(
  violation: BrowserModuleBoundaryViolation,
): string {
  switch (violation.kind) {
    case "conflicting":
      return "Browser module has conflicting client and server directives";
    case "module-server":
      return "Browser module declares use server";
    case "function-server":
      return "Browser module contains a function-local use server directive";
    case "parse-error":
      return "Browser module could not be safely analyzed";
  }
}
