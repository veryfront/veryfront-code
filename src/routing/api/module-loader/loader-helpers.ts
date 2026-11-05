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

/**
 * A JavaScript identifier, including Unicode letters and `\u` escapes, as
 * the source of a RegExp built with the `u` flag.
 */
export const JS_IDENTIFIER = "(?:[\\p{ID_Start}$_]|\\\\u[0-9a-fA-F]{4}|\\\\u\\{[0-9a-fA-F]+\\})" +
  "(?:[\\p{ID_Continue}$\\u200C\\u200D]|\\\\u[0-9a-fA-F]{4}|\\\\u\\{[0-9a-fA-F]+\\})*";

/** A single- or double-quoted string literal, as the source of a RegExp. */
export const JS_STRING_LITERAL = `"(?:[^"\\\\\\r\\n]|\\\\.)*"|'(?:[^'\\\\\\r\\n]|\\\\.)*'`;

const SPECIFIER_ENTRY = new RegExp(
  `\\s*(?:(${JS_STRING_LITERAL})|(${JS_IDENTIFIER}))` +
    `(?:\\s+as\\s+(?:(${JS_STRING_LITERAL})|(${JS_IDENTIFIER})))?\\s*(?:,|$)`,
  "uy",
);

/** One `name as alias` entry of an import or export clause, as source text. */
export interface ModuleSpecifier {
  /** The name in the other module: an identifier or a string literal. */
  readonly name: string;
  readonly nameIsString: boolean;
  /** The local or exported name, if it differs: an identifier or a string literal. */
  readonly alias?: string;
  readonly aliasIsString: boolean;
}

/** Parse a `{ ... }` import or export clause. Throws on anything else. */
export function parseModuleSpecifiers(clause: string): ModuleSpecifier[] {
  const trimmed = clause.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error(`Unsupported import or export clause: ${clause}`);
  }
  const inner = trimmed.slice(1, -1);
  const specifiers: ModuleSpecifier[] = [];
  const entry = new RegExp(SPECIFIER_ENTRY.source, SPECIFIER_ENTRY.flags);
  while (inner.slice(entry.lastIndex).trim() !== "") {
    const start = entry.lastIndex;
    const match = entry.exec(inner);
    if (!match || entry.lastIndex === start) {
      throw new Error(`Unsupported import or export clause: ${clause}`);
    }
    const [, nameString, nameIdent, aliasString, aliasIdent] = match;
    specifiers.push({
      name: (nameString ?? nameIdent)!,
      nameIsString: nameString !== undefined,
      alias: aliasString ?? aliasIdent,
      aliasIsString: aliasString !== undefined,
    });
  }
  return specifiers;
}

/**
 * Convert a named import clause (`{ a, b as c, "d-e" as f }`) to a
 * destructuring pattern (`{ a, b: c, "d-e": f }`). A string-literal name
 * needs an identifier alias, as in the import itself.
 */
export function toCjsDestructureBindings(bindings: string): string {
  const converted: string[] = [];
  for (const specifier of parseModuleSpecifiers(bindings)) {
    if (specifier.aliasIsString || (specifier.nameIsString && specifier.alias === undefined)) {
      throw new Error(`Unsupported named import clause: ${bindings}`);
    }
    converted.push(
      specifier.alias === undefined ? specifier.name : `${specifier.name}: ${specifier.alias}`,
    );
  }
  return converted.length === 0 ? "{}" : `{ ${converted.join(", ")} }`;
}

export function getLoaderForFile(filePath: string): "tsx" | "jsx" | "ts" | "js" | "json" {
  const ext = filePath.split(".").pop() ?? "";
  return EXT_TO_LOADER[ext] ?? "js";
}
