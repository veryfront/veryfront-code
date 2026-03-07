/**
 * Missing module error helpers for MDX ESM loader.
 */

import { getErrorCollector } from "#veryfront/observability/error-collector.ts";
import { MODULE_NOT_FOUND } from "#veryfront/errors";
import { extractNamedImports } from "./utils/stub-module.ts";

type MissingModuleContext = {
  modulePath: string;
  importer?: string;
  importStatement?: string;
  code?: string;
  projectSlug?: string;
};

function getSuggestion(modulePath: string, namedImports: string[]): string {
  if (!modulePath.includes("lib/utils")) {
    return "Ensure the file exists in the project and is included in the release.";
  }

  if (namedImports.includes("cn")) {
    return "Add lib/utils.ts exporting `cn`, or remove the `cn` import.";
  }

  return "Add lib/utils.ts or update the import path.";
}

export function buildMissingModuleError(ctx: MissingModuleContext): Error {
  const namedImports = ctx.code && ctx.importStatement
    ? extractNamedImports(ctx.code, ctx.importStatement)
    : [];

  const parts: string[] = [
    `[MDX] Missing module: ${ctx.modulePath}.`,
    ctx.importer ? `Imported by: ${ctx.importer}.` : "",
    namedImports.length ? `Missing exports: ${namedImports.join(", ")}.` : "",
    `Suggestion: ${getSuggestion(ctx.modulePath, namedImports)}`,
  ].filter(Boolean);

  const message = parts.join(" ");
  const error = MODULE_NOT_FOUND.create({ detail: message });
  error.name = "MissingModuleError";

  try {
    getErrorCollector().addModuleError(message, ctx.modulePath, {
      importer: ctx.importer,
      namedImports,
      importStatement: ctx.importStatement,
      projectSlug: ctx.projectSlug,
    });
  } catch (_) {
    /* expected: error collector may not be initialized in all contexts */
  }

  return error;
}
