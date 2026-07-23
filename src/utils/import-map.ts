export type ImportMapImports = Record<string, string>;

const MAX_IMPORT_MAP_JSON_LENGTH = 1_048_576;
const MAX_IMPORT_MAP_ENTRIES = 10_000;

function defineImport(
  target: ImportMapImports,
  specifier: string,
  address: string,
): void {
  Object.defineProperty(target, specifier, {
    configurable: true,
    enumerable: true,
    value: address,
    writable: true,
  });
}

function copyImportMapImports(value: unknown): ImportMapImports | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  const copy: ImportMapImports = {};
  let count = 0;
  try {
    for (const specifier in value as Record<string, unknown>) {
      if (!Object.hasOwn(value, specifier)) continue;
      if (count++ >= MAX_IMPORT_MAP_ENTRIES) return null;
      const address = (value as Record<string, unknown>)[specifier];
      if (typeof address !== "string") return null;
      defineImport(copy, specifier, address);
    }
  } catch {
    return null;
  }
  return copy;
}

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
  const merged: ImportMapImports = {};
  const normalizedImports = copyImportMapImports(imports ?? {}) ?? {};
  for (const [specifier, address] of Object.entries(DEFAULT_BROWSER_IMPORT_MAP_IMPORTS)) {
    defineImport(merged, specifier, address);
  }
  for (const [specifier, address] of Object.entries(normalizedImports)) {
    defineImport(merged, specifier, address);
  }
  return merged;
}

export function importMapOwnsSpecifier(
  specifier: string,
  imports?: ImportMapImports,
): boolean {
  if (typeof specifier !== "string" || !imports) return false;
  try {
    if (Object.hasOwn(imports, specifier)) return typeof imports[specifier] === "string";

    let count = 0;
    for (const key in imports) {
      if (!Object.hasOwn(imports, key)) continue;
      if (count++ >= MAX_IMPORT_MAP_ENTRIES) return false;
      if (
        key.endsWith("/") && specifier.startsWith(key) &&
        typeof imports[key] === "string" && imports[key].endsWith("/")
      ) return true;
    }
  } catch {
    return false;
  }

  return false;
}

export function parseImportMapImports(json: string): ImportMapImports {
  if (typeof json !== "string" || json.length > MAX_IMPORT_MAP_JSON_LENGTH) {
    console.warn("Import map JSON is invalid or too large; treating as empty", {
      inputLength: typeof json === "string" ? json.length : undefined,
    });
    return {};
  }

  try {
    const parsed = JSON.parse(json) as { imports?: unknown } | null;
    const imports = parsed?.imports;
    if (imports === undefined) return {};
    return copyImportMapImports(imports) ?? {};
  } catch (error) {
    // A malformed import map silently flips the RSC client-module strategy.
    // This module is browser-bundled, so the server logger (which pulls in
    // node:async_hooks) is unavailable; console.warn keeps the failure diagnosable.
    console.warn("Failed to parse import map JSON; treating as empty", {
      errorName: error instanceof Error ? error.name : typeof error,
      inputLength: json.length,
    });
    return {};
  }
}

export function getDocumentImportMapImports(doc: Document = document): ImportMapImports {
  const importMapElement = doc.querySelector('script[type="importmap"]');
  if (!importMapElement?.textContent) return {};

  return parseImportMapImports(importMapElement.textContent);
}
