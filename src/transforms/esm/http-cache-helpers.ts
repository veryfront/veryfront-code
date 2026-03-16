/**
 * URL validation, normalization, and resolution utilities for HTTP module caching.
 *
 * @module transforms/esm/http-cache-helpers
 */

import { isAbsolute, join } from "#veryfront/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { rendererLogger } from "#veryfront/utils";
import { resolveImport } from "#veryfront/modules/import-map/resolver.ts";
import type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";
import { DEFAULT_REACT_VERSION, getReactImportMap } from "./package-registry.ts";

const logger = rendererLogger.component("http-cache");

/**
 * Cache interface for dependency injection (matches LRU essential methods).
 */
export interface HttpCacheLike<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  delete(key: K): void;
}

/**
 * Set interface for dependency injection.
 */
export interface SetLike<T> {
  has(value: T): boolean;
  add(value: T): this;
  delete(value: T): boolean;
}

export type CacheOptions = {
  cacheDir: string;
  importMap: ImportMapConfig;
  /** React version to use for esm.sh URLs (defaults to DEFAULT_REACT_VERSION) */
  reactVersion?: string;
};

export function ensureAbsoluteDir(path: string): string {
  return isAbsolute(path) ? path : join(cwd(), path);
}

export function isHttpUrl(specifier: string): boolean {
  return specifier.startsWith("https://") || specifier.startsWith("http://");
}

export function isExternalScheme(specifier: string): boolean {
  return specifier.startsWith("node:") ||
    specifier.startsWith("data:") ||
    specifier.startsWith("file:") ||
    specifier.startsWith("bun:");
}

export function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/");
}

/**
 * Check if a base URL is an HTTP URL being processed (parent module is also from esm.sh).
 * When both parent and child modules are HTTP URLs, relative paths work reliably.
 */
export function isParentHttpModule(baseUrl: string | undefined): boolean {
  return !!baseUrl && isHttpUrl(baseUrl);
}

export function isInternalBare(specifier: string): boolean {
  return specifier.startsWith("veryfront/") ||
    specifier.startsWith("#veryfront/") ||
    specifier.startsWith("@std/") ||
    specifier.startsWith("_vf_modules/") ||
    specifier.startsWith("/_vf_modules/") ||
    specifier.startsWith("_veryfront/") ||
    specifier.startsWith("/_veryfront/");
}

export function normalizeEsmShUrl(url: URL): void {
  if (url.hostname !== "esm.sh") return;

  if (url.pathname.includes("/denonext/")) {
    url.pathname = url.pathname.replace("/denonext/", "/");
  }

  if (!url.searchParams.has("target")) {
    url.searchParams.set("target", "es2022");
  }

  const pathname = url.pathname.replace(/^\/+/, "");
  const isBaseReact = /^react@[\d.]+(?:\?|$)/.test(pathname);
  if (isBaseReact) return;

  const existing = url.searchParams.get("external");
  const externals = existing ? existing.split(",") : [];
  if (!externals.includes("react")) {
    externals.push("react");
    url.searchParams.set("external", externals.join(","));
  }
}

export function normalizeHttpUrl(raw: string): string {
  try {
    const url = new URL(raw);
    normalizeEsmShUrl(url);
    url.searchParams.sort();
    const normalized = url.toString();

    // esm.sh misbehaves when list-valued params such as
    // `external=react,react-dom` are percent-encoded as `%2C`.
    // Preserve literal commas only for the affected param so unrelated
    // query values remain canonically encoded.
    if (url.hostname === "esm.sh") {
      const external = url.searchParams.get("external");
      if (!external) return normalized;

      const encodedExternal = encodeURIComponent(external);
      return normalized.replace(
        `external=${encodedExternal}`,
        `external=${encodedExternal.replace(/%2C/gi, ",")}`,
      );
    }

    return normalized;
  } catch (_) {
    /* expected: URL may be malformed */
    return raw;
  }
}

export function resolveBareSpecifier(
  specifier: string,
  importMap: ImportMapConfig,
  reactVersion: string = DEFAULT_REACT_VERSION,
): string {
  const reactMap = getReactImportMap(reactVersion);
  const reactMapped = reactMap[specifier];
  if (reactMapped) return reactMapped;

  if (specifier.startsWith("react/")) {
    const subpath = specifier.slice("react/".length);
    return `https://esm.sh/react@${reactVersion}/${subpath}?external=react&target=es2022`;
  }

  if (specifier.startsWith("react-dom/")) {
    const subpath = specifier.slice("react-dom/".length);
    return `https://esm.sh/react-dom@${reactVersion}/${subpath}?external=react&target=es2022`;
  }

  const mapped = resolveImport(specifier, importMap);
  if (mapped !== specifier) return mapped;

  return `https://esm.sh/${specifier}?target=es2022`;
}

/**
 * Check if cached HTTP bundle code has file:// paths from a different environment.
 * Returns true if the code should be rejected (has incompatible paths).
 */
export function hasIncompatibleFilePaths(code: string, localCacheDir: string): boolean {
  const filePathPattern = /file:\/\/([^"'\s]+)/gi;

  let match: RegExpExecArray | null;
  while ((match = filePathPattern.exec(code)) !== null) {
    const path = match[1]!;
    if (!path.includes("veryfront-http-bundle")) continue;

    if (!path.startsWith(localCacheDir)) {
      logger.debug("Bundle has incompatible file path from different environment", {
        path,
        expectedDir: localCacheDir,
      });
      return true;
    }
  }

  return false;
}
