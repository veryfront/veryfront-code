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
        // The file name only: an outside path would expose the host's layout.
        message: `[API] module path escapes project directory: ${pathHelper.basename(modulePath)}`,
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

const NAMED_IMPORT_ENTRY =
  /\s*(?:("(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*')|([A-Za-z_$][\w$]*))(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*(?:,|$)/y;

/**
 * Convert a named import clause (`{ a, b as c, "d-e" as f }`) to a
 * destructuring pattern (`{ a, b: c, "d-e": f }`). A string-literal name
 * needs an alias, as in the import itself.
 */
export function toCjsDestructureBindings(bindings: string): string {
  const inner = bindings.trim().replace(/^\{\s*/, "").trimEnd().replace(/\}$/, "");
  if (!inner.trim()) return "{}";

  const converted: string[] = [];
  NAMED_IMPORT_ENTRY.lastIndex = 0;
  while (inner.slice(NAMED_IMPORT_ENTRY.lastIndex).trim() !== "") {
    const start = NAMED_IMPORT_ENTRY.lastIndex;
    const entry = NAMED_IMPORT_ENTRY.exec(inner);
    if (!entry || NAMED_IMPORT_ENTRY.lastIndex === start) {
      throw new Error(`Unsupported named import clause: ${bindings}`);
    }
    const [, literal, name, alias] = entry;
    if (literal !== undefined && alias === undefined) {
      throw new Error(`Unsupported named import clause: ${bindings}`);
    }
    converted.push(alias === undefined ? name! : `${literal ?? name}: ${alias}`);
  }

  return `{ ${converted.join(", ")} }`;
}

export function getLoaderForFile(filePath: string): "tsx" | "jsx" | "ts" | "js" | "json" {
  const ext = filePath.split(".").pop() ?? "";
  return EXT_TO_LOADER[ext] ?? "js";
}
