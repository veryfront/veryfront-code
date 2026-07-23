import { isAbsolute } from "#veryfront/compat/path/index.ts";
import type { ChunkManifest } from "./types.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

export const MAX_CHUNK_MANIFEST_BYTES = 16 * 1024 * 1024;
export const MAX_CHUNK_MANIFEST_ROUTES = 10_000;
export const MAX_CHUNK_MANIFEST_CHUNKS = 50_000;
export const MAX_CHUNK_MANIFEST_REFERENCES = 500_000;
export const MAX_CHUNK_MANIFEST_PATH_BYTES = 4_096;
export const MAX_CHUNK_NAME_BYTES = 1_024;

const UTF8_ENCODER = new TextEncoder();
const INVALID_PROPERTY = Symbol("invalid-property");

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readDataProperty(
  value: Record<string, unknown>,
  key: string,
): unknown | typeof INVALID_PROPERTY {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !("value" in descriptor)) return INVALID_PROPERTY;
  return descriptor.value;
}

function readOptionalDataProperty(
  value: Record<string, unknown>,
  key: string,
): unknown | typeof INVALID_PROPERTY | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) return INVALID_PROPERTY;
  return descriptor.value;
}

function readDataEntries(
  value: Record<string, unknown>,
  maxEntries: number,
): Array<[string, unknown]> | null {
  const keys = Object.keys(value);
  if (keys.length > maxEntries) return null;

  const entries: Array<[string, unknown]> = [];
  for (const key of keys) {
    const entry = readDataProperty(value, key);
    if (entry === INVALID_PROPERTY) return null;
    entries.push([key, entry]);
  }
  return entries;
}

function readStringArray(
  value: unknown,
  maxEntries: number,
  predicate: (item: string) => boolean,
): string[] | null {
  if (!Array.isArray(value) || value.length > maxEntries) return null;
  const result: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") {
      return null;
    }
    if (!predicate(descriptor.value)) return null;
    result.push(descriptor.value);
  }
  return result;
}

function consumeText(
  budget: ManifestWorkBudget,
  value: string,
  maxBytes: number,
): boolean {
  if (value.length > maxBytes) return false;
  const byteLength = UTF8_ENCODER.encode(value).byteLength;
  if (
    byteLength > maxBytes ||
    budget.textBytes > MAX_CHUNK_MANIFEST_BYTES - byteLength
  ) return false;
  budget.textBytes += byteLength;
  return true;
}

function isSafeAssetPath(value: string, budget: ManifestWorkBudget): boolean {
  if (
    !value || !consumeText(budget, value, MAX_CHUNK_MANIFEST_PATH_BYTES) ||
    isAbsolute(value)
  ) return false;
  const normalized = value.replaceAll("\\", "/");
  return !/^[A-Za-z]:\//.test(normalized) && !hasUnsafeControlCharacters(normalized) &&
    !normalized.includes("?") &&
    !normalized.includes("#") &&
    !normalized.split("/").some((segment) => segment === "." || segment === ".." || !segment);
}

function isSafeRoutePath(value: string, budget: ManifestWorkBudget): boolean {
  if (
    !consumeText(budget, value, MAX_CHUNK_MANIFEST_PATH_BYTES) ||
    !value.startsWith("/") || value.startsWith("//") || value.includes("\\") ||
    value.includes("?") || value.includes("#") || hasUnsafeControlCharacters(value)
  ) return false;
  if (value === "/") return true;
  return !value.endsWith("/") &&
    !value.slice(1).split("/").some((segment) => !segment || segment === "." || segment === "..");
}

function hasExtension(path: string, extension: string): boolean {
  return path.toLowerCase().endsWith(extension);
}

function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

interface ManifestWorkBudget {
  references: number;
  textBytes: number;
}

function consumeReferences(budget: ManifestWorkBudget, count: number): boolean {
  if (budget.references > MAX_CHUNK_MANIFEST_REFERENCES - count) return false;
  budget.references += count;
  return true;
}

function validateChunkManifest(value: unknown): value is ChunkManifest {
  if (!isRecord(value)) return false;
  if (readDataProperty(value, "version") !== "1.0") return false;

  const routesValue = readDataProperty(value, "routes");
  const chunksValue = readDataProperty(value, "chunks");
  const sharedValue = readDataProperty(value, "shared");
  if (!isRecord(routesValue) || !isRecord(chunksValue)) return false;

  const routeEntries = readDataEntries(routesValue, MAX_CHUNK_MANIFEST_ROUTES);
  const chunkEntries = readDataEntries(chunksValue, MAX_CHUNK_MANIFEST_CHUNKS);
  if (!routeEntries || !chunkEntries) return false;

  const budget: ManifestWorkBudget = { references: 0, textBytes: 0 };
  const shared = readStringArray(
    sharedValue,
    MAX_CHUNK_MANIFEST_CHUNKS,
    (path) => isSafeAssetPath(path, budget) && hasExtension(path, ".js"),
  );
  if (!shared || !hasUniqueValues(shared) || !consumeReferences(budget, shared.length)) {
    return false;
  }

  const routes: Array<{
    entry: string;
    chunks: string[];
    preload?: string[];
  }> = [];
  for (const [routePath, routeValue] of routeEntries) {
    if (!isSafeRoutePath(routePath, budget) || !isRecord(routeValue)) return false;
    const entry = readDataProperty(routeValue, "entry");
    const chunks = readStringArray(
      readDataProperty(routeValue, "chunks"),
      MAX_CHUNK_MANIFEST_CHUNKS,
      (path) => isSafeAssetPath(path, budget) && hasExtension(path, ".js"),
    );
    if (
      typeof entry !== "string" || !isSafeAssetPath(entry, budget) ||
      !hasExtension(entry, ".js") ||
      !chunks || !hasUniqueValues(chunks) || !consumeReferences(budget, chunks.length)
    ) return false;

    const cssValue = readOptionalDataProperty(routeValue, "css");
    if (cssValue === INVALID_PROPERTY) return false;
    if (cssValue !== undefined) {
      const css = readStringArray(
        cssValue,
        MAX_CHUNK_MANIFEST_REFERENCES,
        (path) => isSafeAssetPath(path, budget) && hasExtension(path, ".css"),
      );
      if (!css || !hasUniqueValues(css) || !consumeReferences(budget, css.length)) return false;
    }

    const preloadValue = readOptionalDataProperty(routeValue, "preload");
    if (preloadValue === INVALID_PROPERTY) return false;
    let preload: string[] | undefined;
    if (preloadValue !== undefined) {
      preload = readStringArray(
        preloadValue,
        MAX_CHUNK_MANIFEST_REFERENCES,
        (path) => isSafeAssetPath(path, budget) && hasExtension(path, ".js"),
      ) ?? undefined;
      if (
        !preload || !hasUniqueValues(preload) ||
        !consumeReferences(budget, preload.length)
      ) return false;
    }
    routes.push({ entry, chunks, preload });
  }

  const chunkImports: string[][] = [];
  for (const [chunkPath, chunkValue] of chunkEntries) {
    if (!isSafeAssetPath(chunkPath, budget) || !hasExtension(chunkPath, ".js")) return false;
    if (!isRecord(chunkValue)) return false;

    const name = readDataProperty(chunkValue, "name");
    const file = readDataProperty(chunkValue, "file");
    const imports = readStringArray(
      readDataProperty(chunkValue, "imports"),
      MAX_CHUNK_MANIFEST_REFERENCES,
      (path) => isSafeAssetPath(path, budget) && hasExtension(path, ".js"),
    );
    const size = readDataProperty(chunkValue, "size");
    const hash = readDataProperty(chunkValue, "hash");
    if (
      typeof name !== "string" || !name ||
      !consumeText(budget, name, MAX_CHUNK_NAME_BYTES) ||
      hasUnsafeControlCharacters(name) || typeof file !== "string" || file !== chunkPath ||
      !consumeText(budget, file, MAX_CHUNK_MANIFEST_PATH_BYTES) || !imports ||
      !hasUniqueValues(imports) || !consumeReferences(budget, imports.length) ||
      !Number.isSafeInteger(size) || (size as number) < 0 ||
      typeof hash !== "string" || hash.length !== 64 ||
      !consumeText(budget, hash, 64) || !/^[a-f0-9]{64}$/i.test(hash)
    ) return false;

    const css = readOptionalDataProperty(chunkValue, "css");
    if (
      css === INVALID_PROPERTY ||
      (css !== undefined &&
        (typeof css !== "string" || !isSafeAssetPath(css, budget) ||
          !hasExtension(css, ".css")))
    ) return false;
    chunkImports.push(imports);
  }

  const chunkPaths = new Set(chunkEntries.map(([path]) => path));
  const entryPaths = new Set<string>();
  for (const route of routes) {
    if (!chunkPaths.has(route.entry) || entryPaths.has(route.entry)) return false;
    entryPaths.add(route.entry);
    if (route.chunks.includes(route.entry)) return false;
    if (!route.chunks.every((path) => chunkPaths.has(path))) return false;
    if (route.preload) {
      const routeChunks = new Set(route.chunks);
      if (!route.preload.every((path) => routeChunks.has(path))) return false;
    }
  }

  const sharedPaths = new Set(shared);
  if (!shared.every((path) => chunkPaths.has(path))) return false;
  if (chunkPaths.size - entryPaths.size !== sharedPaths.size) return false;
  for (const chunkPath of chunkPaths) {
    if (!entryPaths.has(chunkPath) && !sharedPaths.has(chunkPath)) return false;
  }
  for (const imports of chunkImports) {
    if (!imports.every((path) => chunkPaths.has(path))) return false;
  }

  return true;
}

export function isChunkManifest(value: unknown): value is ChunkManifest {
  try {
    return validateChunkManifest(value);
  } catch {
    return false;
  }
}
