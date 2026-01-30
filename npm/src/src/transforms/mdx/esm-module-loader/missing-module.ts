/**
 * Missing module error helpers for MDX ESM loader.
 */

import { getErrorCollector } from "../../../cli/mcp/error-collector.js";
import { extractNamedImports } from "./utils/stub-module.js";

type MissingModuleContext = {
  modulePath: string;
  importer?: string;
  importStatement?: string;
  code?: string;
  projectSlug?: string;
};

function getSuggestion(modulePath: string, namedImports: string[]): string {
  if (modulePath.includes("lib/utils")) {
    const missingCn = namedImports.includes("cn");
    if (missingCn) {
      return "Add lib/utils.ts exporting `cn`, or remove the `cn` import.";
    }
    return "Add lib/utils.ts or update the import path.";
  }

  return "Ensure the file exists in the project and is included in the release.";
}

export function buildMissingModuleError(ctx: MissingModuleContext): Error {
  const namedImports = ctx.code && ctx.importStatement
    ? extractNamedImports(ctx.code, ctx.importStatement)
    : [];

  const parts: string[] = [];
  parts.push(`[MDX] Missing module: ${ctx.modulePath}.`);
  if (ctx.importer) parts.push(`Imported by: ${ctx.importer}.`);
  if (namedImports.length > 0) {
    parts.push(`Missing exports: ${namedImports.join(", ")}.`);
  }
  parts.push(`Suggestion: ${getSuggestion(ctx.modulePath, namedImports)}`);

  const message = parts.join(" ");
  const error = new Error(message);
  error.name = "MissingModuleError";

  try {
    getErrorCollector().addModuleError(
      message,
      ctx.modulePath,
      {
        importer: ctx.importer,
        namedImports,
        importStatement: ctx.importStatement,
        projectSlug: ctx.projectSlug,
      },
    );
  } catch {
    // Error collector may not be initialized in all contexts
  }

  return error;
}
