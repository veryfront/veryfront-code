import type { ImportMapConfig } from "./types.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const MAX_IMPORT_MAP_ENTRIES = 5_000;
const MAX_IMPORT_MAP_KEY_LENGTH = 2_048;
const MAX_IMPORT_MAP_VALUE_LENGTH = 8_192;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isValidText(value: string, maxLength: number): boolean {
  return value.length > 0 && value.length <= maxLength &&
    !hasUnsafeControlCharacters(value);
}

function sanitizeMappings(
  value: unknown,
  count: { value: number },
): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const entries: Array<[string, string]> = [];
  for (const [key, target] of Object.entries(value)) {
    count.value++;
    if (
      count.value > MAX_IMPORT_MAP_ENTRIES || typeof target !== "string" ||
      !isValidText(key, MAX_IMPORT_MAP_KEY_LENGTH) ||
      !isValidText(target, MAX_IMPORT_MAP_VALUE_LENGTH)
    ) {
      return null;
    }
    entries.push([key, target]);
  }
  return Object.fromEntries(entries);
}

/** Validate and copy an untrusted runtime import-map value. */
export function sanitizeImportMap(value: unknown): ImportMapConfig | null {
  try {
    if (!isRecord(value)) return null;
    const count = { value: 0 };
    const importsValue = value.imports;
    const scopesValue = value.scopes;
    let imports: Record<string, string> | undefined;
    if (importsValue !== undefined) {
      const sanitizedImports = sanitizeMappings(importsValue, count);
      if (sanitizedImports === null) return null;
      imports = sanitizedImports;
    }

    let scopes: Record<string, Record<string, string>> | undefined;
    if (scopesValue !== undefined) {
      if (!isRecord(scopesValue)) return null;
      const scopeEntries: Array<[string, Record<string, string>]> = [];
      for (const [scope, mappings] of Object.entries(scopesValue)) {
        count.value++;
        if (
          count.value > MAX_IMPORT_MAP_ENTRIES ||
          !isValidText(scope, MAX_IMPORT_MAP_KEY_LENGTH)
        ) return null;
        const sanitized = sanitizeMappings(mappings, count);
        if (!sanitized) return null;
        scopeEntries.push([scope, sanitized]);
      }
      scopes = Object.fromEntries(scopeEntries);
    }

    return { imports, scopes };
  } catch {
    return null;
  }
}

export function mergeImportMaps(...maps: ImportMapConfig[]): ImportMapConfig {
  const imports = new Map<string, string>();
  const scopes = new Map<string, Map<string, string>>();
  let mergedEntryCount = 0;

  const addMergedEntry = (): void => {
    mergedEntryCount++;
    if (mergedEntryCount > MAX_IMPORT_MAP_ENTRIES) {
      throw new TypeError("Merged import map exceeds entry limit");
    }
  };

  for (const map of maps) {
    const sanitized = sanitizeImportMap(map);
    if (!sanitized) throw new TypeError("Invalid import map");

    for (const [specifier, target] of Object.entries(sanitized.imports ?? {})) {
      if (!imports.has(specifier)) addMergedEntry();
      imports.set(specifier, target);
    }
    for (const [scope, scopeImports] of Object.entries(sanitized.scopes ?? {})) {
      if (!scopes.has(scope)) addMergedEntry();
      const mergedScope = scopes.get(scope) ?? new Map<string, string>();
      for (const [specifier, target] of Object.entries(scopeImports)) {
        if (!mergedScope.has(specifier)) addMergedEntry();
        mergedScope.set(specifier, target);
      }
      scopes.set(scope, mergedScope);
    }
  }

  return {
    imports: Object.fromEntries(imports),
    scopes: Object.fromEntries(
      Array.from(scopes, ([scope, mappings]) => [scope, Object.fromEntries(mappings)]),
    ),
  };
}
