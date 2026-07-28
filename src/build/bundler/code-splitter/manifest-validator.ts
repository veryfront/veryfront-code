import { hasControlCharacters } from "../../utils/string-validation.ts";
import { CHUNK_MANIFEST_VERSION, MAX_CHUNK_MANIFEST_ENTRIES } from "./constants.ts";
import type { ChunkManifest } from "./types.ts";

export const MAX_MANIFEST_PATH_LENGTH = 2_048;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertBoundedRecord(
  value: unknown,
  description: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${description} must be an object`);
  if (Object.keys(value).length > MAX_CHUNK_MANIFEST_ENTRIES) {
    throw new TypeError(`${description} has too many entries`);
  }
}

export function assertAssetPath(value: unknown, description: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_MANIFEST_PATH_LENGTH ||
    value !== value.normalize("NFC") ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("?") ||
    value.includes("#") ||
    hasControlCharacters(value) ||
    /["'<>]/.test(value) ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new TypeError(`${description} must be a safe relative asset path`);
  }
}

function assertRoutePath(value: string): void {
  if (
    value.length === 0 ||
    value.length > MAX_MANIFEST_PATH_LENGTH ||
    value !== value.normalize("NFC") ||
    !value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    hasControlCharacters(value) ||
    (value !== "/" &&
      value.split("/").some((segment, index) =>
        index > 0 && (segment === "" || segment === "." || segment === "..")
      ))
  ) {
    throw new TypeError(`Invalid route path in chunk manifest: ${JSON.stringify(value)}`);
  }
}

function assertAssetPathList(
  value: unknown,
  description: string,
): asserts value is string[] {
  if (!Array.isArray(value) || value.length > MAX_CHUNK_MANIFEST_ENTRIES) {
    throw new TypeError(`${description} must be a bounded array`);
  }

  const unique = new Set<string>();
  for (const [index, item] of value.entries()) {
    assertAssetPath(item, `${description}[${index}]`);
    if (unique.has(item)) throw new TypeError(`${description} contains duplicate paths`);
    unique.add(item);
  }
}

function assertOptionalAssetPathList(
  value: unknown,
  description: string,
): asserts value is string[] | undefined {
  if (value !== undefined) assertAssetPathList(value, description);
}

/** Validate the complete bounded and referentially consistent chunk-manifest schema. */
export function validateChunkManifest(value: unknown): ChunkManifest {
  assertBoundedRecord(value, "Chunk manifest");
  if (value.version !== CHUNK_MANIFEST_VERSION) {
    throw new TypeError(`Unsupported chunk manifest version: ${String(value.version)}`);
  }

  assertBoundedRecord(value.routes, "Chunk manifest routes");
  assertBoundedRecord(value.chunks, "Chunk manifest chunks");
  assertAssetPathList(value.shared, "Chunk manifest shared chunks");

  for (const [file, rawChunk] of Object.entries(value.chunks)) {
    assertAssetPath(file, `Chunk manifest key ${JSON.stringify(file)}`);
    assertBoundedRecord(rawChunk, `Chunk manifest entry ${JSON.stringify(file)}`);
    if (
      typeof rawChunk.name !== "string" ||
      rawChunk.name.length === 0 ||
      rawChunk.name.length > 256 ||
      hasControlCharacters(rawChunk.name)
    ) {
      throw new TypeError(`Chunk ${JSON.stringify(file)} has an invalid name`);
    }
    assertAssetPath(rawChunk.file, `Chunk ${JSON.stringify(file)} file`);
    if (rawChunk.file !== file) {
      throw new TypeError(`Chunk ${JSON.stringify(file)} does not match its file field`);
    }
    assertAssetPathList(rawChunk.imports, `Chunk ${JSON.stringify(file)} imports`);
    for (const importedChunk of rawChunk.imports) {
      if (!Object.hasOwn(value.chunks, importedChunk)) {
        throw new TypeError(
          `Chunk ${JSON.stringify(file)} imports unknown chunk ${JSON.stringify(importedChunk)}`,
        );
      }
    }
    if (rawChunk.css !== undefined) {
      assertAssetPath(rawChunk.css, `Chunk ${JSON.stringify(file)} CSS`);
    }
    if (
      typeof rawChunk.size !== "number" ||
      !Number.isSafeInteger(rawChunk.size) ||
      rawChunk.size < 0
    ) {
      throw new TypeError(`Chunk ${JSON.stringify(file)} has an invalid size`);
    }
    if (typeof rawChunk.hash !== "string" || !/^[0-9a-f]{8}$/.test(rawChunk.hash)) {
      throw new TypeError(`Chunk ${JSON.stringify(file)} has an invalid hash`);
    }
  }

  for (const [routePath, rawRoute] of Object.entries(value.routes)) {
    assertRoutePath(routePath);
    assertBoundedRecord(rawRoute, `Chunk manifest route ${JSON.stringify(routePath)}`);
    assertAssetPath(rawRoute.entry, `Route ${JSON.stringify(routePath)} entry`);
    assertAssetPathList(rawRoute.chunks, `Route ${JSON.stringify(routePath)} chunks`);
    assertOptionalAssetPathList(rawRoute.css, `Route ${JSON.stringify(routePath)} CSS`);
    assertOptionalAssetPathList(rawRoute.preload, `Route ${JSON.stringify(routePath)} preload`);
    if (!Object.hasOwn(value.chunks, rawRoute.entry)) {
      throw new TypeError(`Route ${JSON.stringify(routePath)} references an unknown entry chunk`);
    }
    for (const chunk of rawRoute.chunks) {
      if (!Object.hasOwn(value.chunks, chunk)) {
        throw new TypeError(
          `Route ${JSON.stringify(routePath)} references unknown chunk ${JSON.stringify(chunk)}`,
        );
      }
    }
    for (const preload of rawRoute.preload ?? []) {
      if (!Object.hasOwn(value.chunks, preload)) {
        throw new TypeError(
          `Route ${JSON.stringify(routePath)} preloads unknown chunk ${JSON.stringify(preload)}`,
        );
      }
    }
  }

  for (const shared of value.shared) {
    if (!Object.hasOwn(value.chunks, shared)) {
      throw new TypeError(
        `Chunk manifest references unknown shared chunk ${JSON.stringify(shared)}`,
      );
    }
  }

  return value as unknown as ChunkManifest;
}
