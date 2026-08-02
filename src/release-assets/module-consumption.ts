/**
 * Release Asset Manifest — module response consumption helpers.
 *
 * Rewrites browser module import specifiers that point at vendored HTTP bundles
 * to the manifest's immutable local dependency assets. This keeps production
 * `/_vf_modules/*` fallback responses on the same React/dependency module
 * instances as the release import map.
 *
 * @module release-assets/module-consumption
 */

import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { isAbsolute, normalize, relative } from "#veryfront/compat/path/index.ts";
import { normalizeHttpUrl } from "#veryfront/transforms/esm/http-cache-helpers.ts";
import { parseImports, replaceSpecifiers } from "#veryfront/transforms/esm/lexer.ts";
import { extractSourceUrl } from "#veryfront/transforms/esm/source-url-embed.ts";
import {
  RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_LIMITS,
  RELEASE_ASSET_MAX_SIZE_BYTES,
  releaseAssetUrl,
} from "./constants.ts";
import { getReadyManifestForRenderAsync, type ReadyManifestReadOptions } from "./manifest-cache.ts";
import {
  hasImmutableReleaseAssetDependencies,
  type ReleaseAssetManifest,
} from "./manifest-schema.ts";
import { hasControlCharacters } from "./string-validation.ts";

const textEncoder = new TextEncoder();

export interface RewriteReleaseDependencyImportsOptions {
  releaseId?: string | null;
  dependencyCacheRoot: string;
  readDependencySource: (path: string) => Promise<string>;
  manifest?: ReleaseAssetManifest | null;
  manifestReadOptions?: ReadyManifestReadOptions;
}

export interface ReleaseDependencyRewriteManifestState {
  enabled: boolean;
  manifest: ReleaseAssetManifest | null;
}

export function isReleaseDependencyImportMapRewriteEnabled(): boolean {
  return getHostEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG) === "1";
}

function isHttpImportSpecifier(specifier: string): boolean {
  try {
    const url = new URL(specifier);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function hasReleaseDependencyImportSpecifiers(code: string): Promise<boolean> {
  if (!code.includes("http") && !code.includes("veryfront-http-bundle")) return false;

  for (const imp of await parseImports(code)) {
    if (!imp.n) continue;
    if (isHttpImportSpecifier(imp.n) || localHttpBundlePath(imp.n)) return true;
  }

  return false;
}

export async function getReleaseDependencyRewriteManifestState(
  releaseId: string | null | undefined,
  options: ReadyManifestReadOptions = {},
): Promise<ReleaseDependencyRewriteManifestState> {
  if (!releaseId || !isReleaseDependencyImportMapRewriteEnabled()) {
    return { enabled: false, manifest: null };
  }

  return {
    enabled: true,
    manifest: await getReadyManifestForRenderAsync(releaseId, options),
  };
}

function dependencyAssetUrl(
  manifest: ReleaseAssetManifest,
  specifier: string,
): string | null {
  if (!hasImmutableReleaseAssetDependencies(manifest)) return null;
  const canonicalSpecifier = canonicalHttpSourceUrl(specifier);
  if (!canonicalSpecifier) return null;
  const fragmentIndex = specifier.indexOf("#");
  const fragment = fragmentIndex >= 0 ? specifier.slice(fragmentIndex) : "";
  const direct = ownDependency(manifest, specifier);
  if (direct) return `${releaseAssetUrl(direct.contentHash, "js")}${fragment}`;

  const normalizedEntry = ownDependency(manifest, canonicalSpecifier);
  return normalizedEntry
    ? `${releaseAssetUrl(normalizedEntry.contentHash, "js")}${fragment}`
    : null;
}

function ownDependency(
  manifest: ReleaseAssetManifest,
  key: string,
): ReleaseAssetManifest["dependencies"][string] | undefined {
  return Object.hasOwn(manifest.dependencies, key) ? manifest.dependencies[key] : undefined;
}

function localHttpBundlePath(specifier: string): string | null {
  try {
    const url = new URL(specifier);
    let path: string | null = null;
    if (url.protocol === "file:") {
      path = decodeURIComponent(url.pathname);
    } else if (url.protocol === "https:" && url.hostname === "esm.sh") {
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith("/file://")) {
        path = pathname.slice("/file://".length);
        if (!path.startsWith("/")) path = `/${path}`;
      }
    }
    if (!path) return null;
    if (!/\/veryfront-http-bundle\/http-[a-z0-9]+\.mjs$/i.test(path)) return null;
    return path;
  } catch {
    return null;
  }
}

function authorizedLocalHttpBundlePath(
  specifier: string,
  dependencyCacheRoot: string,
): string | null {
  const path = localHttpBundlePath(specifier);
  if (
    !path ||
    !isAbsolute(path) ||
    !isAbsolute(dependencyCacheRoot) ||
    normalize(path) !== path
  ) {
    return null;
  }

  const root = normalize(dependencyCacheRoot);
  const relativePath = relative(root, path);
  if (
    relativePath.length === 0 ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    relativePath.startsWith("..\\") ||
    isAbsolute(relativePath)
  ) {
    return null;
  }
  return path;
}

function canonicalHttpSourceUrl(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > RELEASE_ASSET_MANIFEST_LIMITS.manifestKeyLength ||
    value.trim() !== value ||
    hasControlCharacters(value)
  ) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return null;
  }

  const canonical = normalizeHttpUrl(parsed.toString());
  return canonical.length <= RELEASE_ASSET_MANIFEST_LIMITS.manifestKeyLength &&
      !hasControlCharacters(canonical)
    ? canonical
    : null;
}

async function sourceUrlForLocalHttpBundle(
  specifier: string,
  dependencyCacheRoot: string,
  readDependencySource: (path: string) => Promise<string>,
): Promise<string | null> {
  const path = authorizedLocalHttpBundlePath(specifier, dependencyCacheRoot);
  if (!path) return null;

  try {
    const source = await readDependencySource(path);
    if (
      typeof source !== "string" ||
      textEncoder.encode(source).byteLength > RELEASE_ASSET_MAX_SIZE_BYTES
    ) {
      return null;
    }
    return canonicalHttpSourceUrl(extractSourceUrl(source));
  } catch {
    return null;
  }
}

export async function rewriteReleaseDependencyImportsForModule(
  code: string,
  options: RewriteReleaseDependencyImportsOptions,
): Promise<string> {
  if (!options.releaseId) return code;
  if (!isReleaseDependencyImportMapRewriteEnabled()) return code;
  if (!code.includes("http") && !code.includes("veryfront-http-bundle")) return code;

  const manifest = options.manifest !== undefined
    ? options.manifest
    : await getReadyManifestForRenderAsync(options.releaseId, options.manifestReadOptions);

  const replacements = new Map<string, string>();
  for (const imp of await parseImports(code)) {
    if (!imp.n || replacements.has(imp.n)) continue;

    const direct = manifest ? dependencyAssetUrl(manifest, imp.n) : null;
    if (direct) {
      replacements.set(imp.n, direct);
      continue;
    }

    const sourceUrl = await sourceUrlForLocalHttpBundle(
      imp.n,
      options.dependencyCacheRoot,
      options.readDependencySource,
    );
    if (!sourceUrl) continue;

    const assetUrl = manifest ? dependencyAssetUrl(manifest, sourceUrl) : null;
    // A non-ready or incomplete manifest must never leak a local cache path to
    // the browser. Preserve the authenticated JIT path by restoring the
    // bundle's verified HTTP source URL, and keep the response uncached.
    replacements.set(imp.n, assetUrl ?? sourceUrl);
  }

  if (replacements.size === 0) return code;
  return await replaceSpecifiers(code, (specifier) => replacements.get(specifier) ?? null);
}
