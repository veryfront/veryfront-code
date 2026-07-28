export type ImportMapImports = Record<string, string>;

/** Browser import-map parsing limits. These are character counts, not byte counts. */
export const MAX_IMPORT_MAP_JSON_CHARACTERS = 1024 * 1024;
export const MAX_IMPORT_MAP_ENTRIES = 10_000;
export const MAX_IMPORT_MAP_SPECIFIER_CHARACTERS = 4_096;
export const MAX_IMPORT_MAP_TARGET_CHARACTERS = 64 * 1024;

/**
 * Browser-resolved bare specifiers that Veryfront keeps in the output bundle.
 * Empty-string values are intentional sentinels: ownership matters, not truthiness.
 */
export const DEFAULT_BROWSER_IMPORT_MAP_IMPORTS: Readonly<ImportMapImports> = Object.freeze({
  react: "",
  "react-dom": "",
  "react-dom/client": "",
  "react-dom/server": "",
  "react/jsx-runtime": "",
  "react/jsx-dev-runtime": "",
});

export function mergeBrowserImportMapImports(
  imports?: ImportMapImports,
): ImportMapImports {
  return {
    ...DEFAULT_BROWSER_IMPORT_MAP_IMPORTS,
    ...(imports ?? {}),
  };
}

export function importMapOwnsSpecifier(
  specifier: string,
  imports?: ImportMapImports,
): boolean {
  if (!imports) return false;
  if (Object.prototype.hasOwnProperty.call(imports, specifier)) return true;

  for (const key of Object.keys(imports)) {
    if (key.endsWith("/") && specifier.startsWith(key)) return true;
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseImportMapImports(json: string): ImportMapImports {
  if (json.length > MAX_IMPORT_MAP_JSON_CHARACTERS) {
    throw new RangeError(
      `Import map JSON exceeds ${MAX_IMPORT_MAP_JSON_CHARACTERS} characters`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    // Native JSON parser messages may include source fragments. Keep the
    // failure actionable without exposing import targets or embedded tokens.
    throw new SyntaxError("Import map contains invalid JSON");
  }

  if (!isRecord(parsed)) throw new TypeError("Import map must be an object");
  if (parsed.imports === undefined) return {};
  if (!isRecord(parsed.imports)) {
    throw new TypeError("Import map imports must be an object");
  }

  const entries = Object.entries(parsed.imports);
  if (entries.length > MAX_IMPORT_MAP_ENTRIES) {
    throw new RangeError(
      `Import map exceeds ${MAX_IMPORT_MAP_ENTRIES} entries`,
    );
  }

  const imports: ImportMapImports = {};
  for (const [specifier, target] of entries) {
    if (typeof target !== "string") {
      throw new TypeError("Import map targets must be strings");
    }
    if (specifier.length > MAX_IMPORT_MAP_SPECIFIER_CHARACTERS) {
      throw new RangeError(
        `Import map specifier exceeds ${MAX_IMPORT_MAP_SPECIFIER_CHARACTERS} characters`,
      );
    }
    if (target.length > MAX_IMPORT_MAP_TARGET_CHARACTERS) {
      throw new RangeError(
        `Import map target exceeds ${MAX_IMPORT_MAP_TARGET_CHARACTERS} characters`,
      );
    }
    if (specifier.endsWith("/") && !target.endsWith("/")) {
      throw new TypeError("Import map prefix targets must end with a slash");
    }
    Object.defineProperty(imports, specifier, {
      configurable: true,
      enumerable: true,
      value: target,
      writable: true,
    });
  }
  return imports;
}

export function getDocumentImportMapImports(doc: Document = document): ImportMapImports {
  const importMapElement = doc.querySelector('script[type="importmap"]');
  if (!importMapElement) return {};

  return parseImportMapImports(importMapElement.textContent ?? "");
}
