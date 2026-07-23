import { INPUT_VALIDATION_FAILED } from "#veryfront/errors/error-registry/general.ts";
import {
  assertHTMLStringSize,
  getUTF8ByteLength,
  MAX_HTML_IMPORT_MAP_BYTES,
  MAX_HTML_IMPORT_MAP_ENTRIES,
  MAX_HTML_IMPORT_SPECIFIER_BYTES,
  MAX_HTML_IMPORT_VALUE_BYTES,
} from "./limits.ts";

interface ImportMapBudget {
  bytes: number;
  entries: number;
}

function invalidImportMap(detail: string): Error {
  return INPUT_VALIDATION_FAILED.create({ detail });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function validateEntries(
  value: unknown,
  label: string,
  budget: ImportMapBudget,
): Record<string, string> {
  if (!isPlainObject(value)) throw invalidImportMap(`${label} must be a plain object`);

  const imports: Record<string, string> = {};
  let specifiers: string[];
  try {
    specifiers = Object.keys(value);
  } catch {
    throw invalidImportMap(`${label} cannot be inspected`);
  }
  for (const specifier of specifiers) {
    budget.entries++;
    if (budget.entries > MAX_HTML_IMPORT_MAP_ENTRIES) {
      throw invalidImportMap(`${label} exceeds the entry limit`);
    }
    const specifierBytes = getUTF8ByteLength(specifier);
    if (
      specifier.length === 0 || specifierBytes > MAX_HTML_IMPORT_SPECIFIER_BYTES ||
      hasControlCharacter(specifier)
    ) {
      throw invalidImportMap(`Invalid import-map specifier in ${label.toLowerCase()}`);
    }

    let importValue: unknown;
    try {
      importValue = Reflect.get(value, specifier);
    } catch {
      throw invalidImportMap(`${label} entry cannot be inspected`);
    }
    const importValueBytes = typeof importValue === "string" ? getUTF8ByteLength(importValue) : 0;
    if (
      typeof importValue !== "string" || importValue.length === 0 ||
      importValueBytes > MAX_HTML_IMPORT_VALUE_BYTES || hasControlCharacter(importValue)
    ) {
      throw invalidImportMap(`Invalid import-map value in ${label.toLowerCase()}`);
    }

    budget.bytes += specifierBytes + importValueBytes;
    if (budget.bytes > MAX_HTML_IMPORT_MAP_BYTES) {
      throw invalidImportMap(`${label} exceeds the aggregate byte budget`);
    }
    Object.defineProperty(imports, specifier, {
      configurable: true,
      enumerable: true,
      value: importValue,
      writable: true,
    });
  }
  return imports;
}

export function validateCustomImportMap(value: unknown): Record<string, string> {
  return validateEntries(value, "Custom import map", { bytes: 0, entries: 0 });
}

export function assertValidImportMapJson(json: unknown): asserts json is string {
  assertHTMLStringSize(json, "Prebuilt import map JSON", MAX_HTML_IMPORT_MAP_BYTES);

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw invalidImportMap("Prebuilt import map JSON is invalid");
  }
  if (!isPlainObject(parsed)) {
    throw invalidImportMap("Prebuilt import map must be an object");
  }

  const allowedKeys = new Set(["imports", "scopes", "integrity"]);
  for (const key of Object.keys(parsed)) {
    if (!allowedKeys.has(key)) {
      throw invalidImportMap(`Prebuilt import map contains unsupported field ${key}`);
    }
  }

  const budget: ImportMapBudget = { bytes: 0, entries: 0 };
  if (parsed.imports !== undefined) validateEntries(parsed.imports, "Import map", budget);
  if (parsed.integrity !== undefined) {
    validateEntries(parsed.integrity, "Import map integrity", budget);
  }
  if (parsed.scopes !== undefined) {
    if (!isPlainObject(parsed.scopes)) {
      throw invalidImportMap("Import map scopes must be a plain object");
    }
    for (const scope in parsed.scopes) {
      if (!Object.hasOwn(parsed.scopes, scope)) continue;
      const scopeBytes = getUTF8ByteLength(scope);
      if (
        scope.length === 0 || scopeBytes > MAX_HTML_IMPORT_SPECIFIER_BYTES ||
        hasControlCharacter(scope)
      ) {
        throw invalidImportMap("Invalid import map scope");
      }
      budget.entries++;
      budget.bytes += scopeBytes;
      if (budget.entries > MAX_HTML_IMPORT_MAP_ENTRIES) {
        throw invalidImportMap("Import map scopes exceed the entry limit");
      }
      if (budget.bytes > MAX_HTML_IMPORT_MAP_BYTES) {
        throw invalidImportMap("Import map scopes exceed the aggregate byte budget");
      }
      validateEntries(parsed.scopes[scope], "Import map scope", budget);
    }
  }
}
