import * as pathHelper from "#veryfront/compat/path";
import { createError, toError } from "#veryfront/errors";
import { isWithinDirectory } from "#veryfront/security/path-validation.ts";

const EXT_TO_LOADER: Record<string, "tsx" | "jsx" | "ts" | "js" | "json"> = {
  tsx: "tsx",
  jsx: "jsx",
  ts: "ts",
  json: "json",
};

export const FILE_EXTENSIONS: string[] = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs"];

/**
 * Validates that a module path is contained within the project directory.
 * Prevents path traversal attacks that could load arbitrary files from the host.
 */
export function validateModulePath(modulePath: string, projectDir: string): void {
  const resolved = pathHelper.resolve(modulePath);
  const resolvedProject = pathHelper.resolve(projectDir);

  if (!isWithinDirectory(resolvedProject, resolved)) {
    throw toError(
      createError({
        type: "api",
        message: `[API] module path escapes project directory: ${modulePath}`,
      }),
    );
  }
}

export function resolveExportEntry(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    const obj = entry as Record<string, unknown>;
    for (const key of ["import", "default"]) {
      const value = obj[key];
      if (typeof value === "string") return value;
      if (value && typeof value === "object") {
        const nested = value as Record<string, unknown>;
        if (typeof nested.default === "string") return nested.default;
      }
    }
  }
  return undefined;
}

export function toCjsDestructureBindings(bindings: string): string {
  const inner = bindings.trim().replace(/^\{\s*/, "").replace(/\s*\}$/, "");
  if (!inner) return "{}";

  const converted = inner
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const aliasMatch = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (aliasMatch) return `${aliasMatch[1]}: ${aliasMatch[2]}`;
      return part;
    });

  return `{ ${converted.join(", ")} }`;
}

export function getLoaderForFile(filePath: string): "tsx" | "jsx" | "ts" | "js" | "json" {
  const ext = filePath.split(".").pop() ?? "";
  return EXT_TO_LOADER[ext] ?? "js";
}
