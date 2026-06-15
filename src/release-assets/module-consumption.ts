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
import { normalizeHttpUrl } from "#veryfront/transforms/esm/http-cache.ts";
import { parseImports, replaceSpecifiers } from "#veryfront/transforms/esm/lexer.ts";
import { extractSourceUrl } from "#veryfront/transforms/esm/source-url-embed.ts";
import { RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG, releaseAssetUrl } from "./constants.ts";
import { getReadyManifestForRenderAsync } from "./manifest-cache.ts";
import type { ReleaseAssetManifest } from "./manifest-schema.ts";

export interface RewriteReleaseDependencyImportsOptions {
  releaseId?: string | null;
  readDependencySource: (path: string) => Promise<string>;
}

function dependencyAssetUrl(
  manifest: ReleaseAssetManifest,
  specifier: string,
): string | null {
  const direct = manifest.dependencies[specifier] ??
    manifest.dependencies[specifier.replace(/[?#].*$/, "")];
  if (direct) return releaseAssetUrl(direct.contentHash, "js");

  const normalized = normalizeHttpUrl(specifier);
  const normalizedEntry = manifest.dependencies[normalized] ??
    manifest.dependencies[normalized.replace(/[?#].*$/, "")];
  return normalizedEntry ? releaseAssetUrl(normalizedEntry.contentHash, "js") : null;
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

async function sourceUrlForLocalHttpBundle(
  specifier: string,
  readDependencySource: (path: string) => Promise<string>,
): Promise<string | null> {
  const path = localHttpBundlePath(specifier);
  if (!path) return null;

  try {
    return extractSourceUrl(await readDependencySource(path));
  } catch {
    return null;
  }
}

export async function rewriteReleaseDependencyImportsForModule(
  code: string,
  options: RewriteReleaseDependencyImportsOptions,
): Promise<string> {
  if (!options.releaseId) return code;
  if (getHostEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG) !== "1") return code;
  if (!code.includes("http") && !code.includes("veryfront-http-bundle")) return code;

  const manifest = await getReadyManifestForRenderAsync(options.releaseId);
  if (!manifest || Object.keys(manifest.dependencies).length === 0) return code;

  const replacements = new Map<string, string>();
  for (const imp of await parseImports(code)) {
    if (!imp.n || replacements.has(imp.n)) continue;

    const direct = dependencyAssetUrl(manifest, imp.n);
    if (direct) {
      replacements.set(imp.n, direct);
      continue;
    }

    const sourceUrl = await sourceUrlForLocalHttpBundle(imp.n, options.readDependencySource);
    if (!sourceUrl) continue;

    const assetUrl = dependencyAssetUrl(manifest, sourceUrl);
    if (assetUrl) replacements.set(imp.n, assetUrl);
  }

  if (replacements.size === 0) return code;
  return await replaceSpecifiers(code, (specifier) => replacements.get(specifier) ?? null);
}
