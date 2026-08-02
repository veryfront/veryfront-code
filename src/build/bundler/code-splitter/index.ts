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
export { validateChunkManifest } from "./manifest-validator.ts";

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
import { hasControlCharacters } from "../../utils/string-validation.ts";
import { MAX_CHUNK_MANIFEST_BYTES } from "./constants.ts";
import {
  assertAssetPath,
  MAX_MANIFEST_PATH_LENGTH,
  validateChunkManifest,
} from "./manifest-validator.ts";

export function createCodeSplitter(options: SplitOptions): CodeSplitter {
  return new CodeSplitter(options);
}

export async function loadChunkManifest(manifestPath: string): Promise<ChunkManifest> {
  const fs = createFileSystem();

  try {
    const info = fs.lstat ? await fs.lstat(manifestPath) : await fs.stat(manifestPath);
    if (
      info.isSymlink ||
      !info.isFile ||
      info.isDirectory ||
      !Number.isSafeInteger(info.size) ||
      info.size < 0 ||
      info.size > MAX_CHUNK_MANIFEST_BYTES
    ) {
      throw new TypeError("Chunk manifest must be a safe bounded regular file");
    }

    const bytes = await fs.readFile(manifestPath);
    if (
      bytes.byteLength !== info.size ||
      bytes.byteLength > MAX_CHUNK_MANIFEST_BYTES
    ) {
      throw new TypeError("Chunk manifest changed while it was being read");
    }

    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      throw new TypeError("Chunk manifest must contain valid UTF-8", {
        cause: error,
      });
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
    hasControlCharacters(baseUrl) ||
    /["'<>]/.test(baseUrl)
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
