/**
 * Code splitter public API
 * @module code-splitter
 */

export type {
  ChunkInfo,
  ChunkManifest,
  MetafileOutput,
  RouteChunkInfo,
  SplitOptions,
  SplitResult,
} from "./types.ts";

export { CodeSplitter } from "./splitter.ts";

export { convertPathToName, createEntryPoints } from "./entry-points.ts";
export {
  buildManifest,
  calculateFileHash,
  extractChunkName,
  extractEntryName,
  getChunkInfo,
  getPreloadHints,
  isCriticalImport,
  writeManifest,
} from "./manifest-builder.ts";
export { createBuildContext, createShimFile, getExternalDependencies } from "./build-context.ts";
export { createSplitterPlugin } from "./esbuild-plugin.ts";

import type { ChunkManifest, SplitOptions } from "./types.ts";
import { CodeSplitter } from "./splitter.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { BUILD_FAILED } from "#veryfront/errors";

const MAX_CHUNK_MANIFEST_BYTES = 5 * 1024 * 1024;
const MAX_MANIFEST_RECORD_ENTRIES = 10_000;
const MAX_MANIFEST_LIST_ENTRIES = 10_000;
const MAX_MANIFEST_PATH_LENGTH = 2_048;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertBoundedRecord(
  value: unknown,
  description: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${description} must be an object`);
  if (Object.keys(value).length > MAX_MANIFEST_RECORD_ENTRIES) {
    throw new TypeError(`${description} has too many entries`);
  }
}

function assertAssetPath(value: unknown, description: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_MANIFEST_PATH_LENGTH ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("?") ||
    value.includes("#") ||
    /[\u0000-\u001f\u007f-\u009f"'<>]/.test(value) ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new TypeError(`${description} must be a safe relative asset path`);
  }
}

function assertRoutePath(value: string): void {
  if (
    value.length === 0 ||
    value.length > MAX_MANIFEST_PATH_LENGTH ||
    !value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    /[\u0000-\u001f\u007f-\u009f]/.test(value) ||
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
  if (!Array.isArray(value) || value.length > MAX_MANIFEST_LIST_ENTRIES) {
    throw new TypeError(`${description} must be a bounded array`);
  }

  const unique = new Set<string>();
  for (const [index, item] of value.entries()) {
    assertAssetPath(item, `${description}[${index}]`);
    if (unique.has(item)) throw new TypeError(`${description} contains duplicate paths`);
    unique.add(item);
  }
}

function assertOptionalAssetPathList(value: unknown, description: string): void {
  if (value !== undefined) assertAssetPathList(value, description);
}

export function validateChunkManifest(value: unknown): ChunkManifest {
  assertBoundedRecord(value, "Chunk manifest");
  if (value.version !== "1.0") {
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
      /[\u0000-\u001f\u007f-\u009f]/.test(rawChunk.name)
    ) {
      throw new TypeError(`Chunk ${JSON.stringify(file)} has an invalid name`);
    }
    assertAssetPath(rawChunk.file, `Chunk ${JSON.stringify(file)} file`);
    if (rawChunk.file !== file) {
      throw new TypeError(`Chunk ${JSON.stringify(file)} does not match its file field`);
    }
    assertAssetPathList(rawChunk.imports, `Chunk ${JSON.stringify(file)} imports`);
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

export function createCodeSplitter(options: SplitOptions): CodeSplitter {
  return new CodeSplitter(options);
}

export async function loadChunkManifest(manifestPath: string): Promise<ChunkManifest> {
  const fs = createFileSystem();

  try {
    const stat = await fs.stat(manifestPath);
    if (stat.size > MAX_CHUNK_MANIFEST_BYTES) {
      throw new TypeError("Chunk manifest exceeds the maximum supported size");
    }

    const content = await fs.readTextFile(manifestPath);
    if (new TextEncoder().encode(content).byteLength > MAX_CHUNK_MANIFEST_BYTES) {
      throw new TypeError("Chunk manifest exceeds the maximum supported size");
    }
    return validateChunkManifest(JSON.parse(content));
  } catch (error) {
    throw BUILD_FAILED.create({
      detail: `Failed to load chunk manifest: ${manifestPath}`,
      cause: error,
    });
  }
}

export function getChunksForRoute(manifest: ChunkManifest, routePath: string): string[] {
  const route = Object.hasOwn(manifest.routes, routePath) ? manifest.routes[routePath] : undefined;
  if (!route) return [];

  return [...(route.css ?? []), route.entry, ...route.chunks];
}

export function generatePreloadLinks(
  manifest: ChunkManifest,
  routePath: string,
  baseUrl = "",
): string {
  const route = Object.hasOwn(manifest.routes, routePath) ? manifest.routes[routePath] : undefined;
  if (!route) return "";

  const normalizedBaseUrl = normalizeAssetBaseUrl(baseUrl);
  const href = (assetPath: string): string => {
    assertAssetPath(assetPath, "Preload asset");
    return escapeHtmlAttribute(
      normalizedBaseUrl === "/"
        ? `/${assetPath}`
        : normalizedBaseUrl
        ? `${normalizedBaseUrl}/${assetPath}`
        : assetPath,
    );
  };

  const links = [
    `<link rel="modulepreload" href="${href(route.entry)}">`,
    ...(route.preload ?? []).map(
      (chunk) => `<link rel="modulepreload" href="${href(chunk)}">`,
    ),
    ...(route.css ?? []).map(
      (css) => `<link rel="preload" as="style" href="${href(css)}">`,
    ),
  ];

  return links.join("\n");
}

function normalizeAssetBaseUrl(baseUrl: string): string {
  if (!baseUrl) return "";
  if (
    baseUrl.length > MAX_MANIFEST_PATH_LENGTH ||
    baseUrl.includes("\\") ||
    /[\u0000-\u001f\u007f-\u009f"'<>]/.test(baseUrl)
  ) {
    throw new TypeError("Preload base URL is invalid");
  }

  const normalized = baseUrl === "/" ? "/" : baseUrl.replace(/\/+$/, "");
  if (normalized.startsWith("/")) {
    if (
      normalized.split("/").some((segment, index) =>
        index > 0 && (segment === "." || segment === "..")
      )
    ) {
      throw new TypeError("Preload base URL is invalid");
    }
    return normalized;
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch (error) {
    throw new TypeError("Preload base URL must be root-relative or an HTTP(S) URL", {
      cause: error,
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Preload base URL must use HTTP(S)");
  }
  return normalized;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&#39;");
}
