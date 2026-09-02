import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { hashString as hashCachePath } from "#veryfront/cache/hash.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { createCacheNamespace } from "#veryfront/utils/cache-namespace.ts";
import { getCacheBaseDir } from "#veryfront/utils/cache-dir.ts";
import { REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { RUNTIME_VERSION } from "#veryfront/utils/version.ts";
import {
  resolveVeryfrontModuleTarget,
  resolveVeryfrontModuleUrl,
} from "../../veryfront-module-urls.ts";
import { UNRESOLVED_VF_MODULES_PATTERN } from "./constants.ts";
import { hashString } from "./utils/hash.ts";

const ALL_FILE_URL_PATTERN_SOURCE = /file:\/\/([^"'\s]+)/.source;
const MJS_FILE_URL_PATTERN_SOURCE = /file:\/\/([^"'\s]+\.mjs)/.source;
const CACHE_NAMESPACE_SENTINEL = "__vf_cache_namespace__";
export const UNRESOLVED_IMPORTS_SIDECAR_SUFFIX = ".unresolved-imports.json";
const CYCLE_MANIFEST_CACHE_DIR = "veryfront-cycle-manifests";

/**
 * Variant segment that isolates development-compiled module artifacts. It
 * lives with the key format because the namespace schema below has to name it:
 * the namespace roll is what keeps legacy, always-development-compiled entries
 * off the unsegmented production key.
 */
export const MDX_MODULE_DEV_COMPILE_VARIANT = "on:compile-dev";
export const CYCLE_MANIFEST_SIDECAR_SUFFIX = ".cycle-manifest.json";

/** Cache-wide storage that no project or content-source namespace can occupy. */
export function getCycleManifestCacheRootDir(): string {
  return join(getCacheBaseDir(), CYCLE_MANIFEST_CACHE_DIR);
}

/** Storage outside the project-relative artifact namespace for one cache dir. */
export function getCycleManifestCacheDir(cacheDir: string): string {
  return join(getCycleManifestCacheRootDir(), hashCachePath(cacheDir));
}
const MDX_ESM_PATH_CACHE_ATTRIBUTION_SCHEMA = "unresolved-import-sidecars-v1";
const PUBLIC_RUNTIME_SPECIFIERS = [
  "veryfront/head",
  "veryfront/router",
  "veryfront/context",
] as const;

function buildPublicRuntimeAliasSchema(
  overrides?: Partial<Record<(typeof PUBLIC_RUNTIME_SPECIFIERS)[number], string>>,
) {
  return Object.fromEntries(
    PUBLIC_RUNTIME_SPECIFIERS.map((specifier) => [
      specifier,
      {
        target: overrides?.[specifier] ?? resolveVeryfrontModuleTarget(specifier),
        url: resolveVeryfrontModuleUrl(specifier),
      },
    ]),
  );
}

function formatMdxEsmTransformCacheKey(
  namespace: string,
  projectId: string,
  contentSourceId: string,
  reactVersion: string,
  normalizedPath: string,
  contentHash: string,
  cacheVariant?: string,
): string {
  const variant = cacheVariant?.startsWith("on:") ? `:${cacheVariant}` : "";
  return `${namespace}:${projectId}:${contentSourceId}:${reactVersion}:${normalizedPath}:${contentHash}${variant}:ssr`;
}

function formatMdxEsmPathCacheKey(
  namespace: string,
  reactVersion: string,
  normalizedPath: string,
  cacheVariant?: string,
): string {
  const variant = cacheVariant?.startsWith("on:") ? `:${cacheVariant}` : "";
  return `${namespace}:${reactVersion}${variant}:${normalizedPath}`;
}

function formatMdxEsmModuleFileName(namespace: string, contentHash: string): string {
  return `vfmod-${namespace}-${contentHash}.mjs`;
}

function formatMdxEsmModuleRecoveryCacheKey(
  namespace: string,
  projectId: string,
  contentSourceId: string,
  fileName: string,
): string {
  return `${namespace}:${projectId}:${contentSourceId}:${fileName}:vfmod`;
}

/**
 * Path-scoped prefix shared by every content variant of one source file.
 *
 * The artifact name stays content-keyed, so a tenant that keeps changing the
 * same path would otherwise leave one persistent `jsx-*.mjs` file per variant.
 * Grouping the variants under a per-path prefix lets the writer delete the
 * superseded ones and bound the cache to the project's current source.
 */
function formatMdxJsxCacheFileNamePrefix(namespace: string, filePath: string): string {
  return `jsx-${namespace}-${hashString(filePath)}-`;
}

function formatMdxJsxCacheFileName(
  namespace: string,
  filePath: string,
  sourceCode: string,
): string {
  const prefix = formatMdxJsxCacheFileNamePrefix(namespace, filePath);
  return `${prefix}${hashString(`${filePath}\0${sourceCode}`)}.mjs`;
}

function formatFrameworkVfModuleCacheFileName(
  namespace: string,
  pathHash: string,
  envKey: string,
  contentHash: string,
): string {
  return `vfmod-${namespace}-${pathHash}-${envKey}-${contentHash}.mjs`;
}

/**
 * Declarative description of every MDX-ESM cache key shape. `createCacheNamespace`
 * hashes it, so naming a format change here rolls the namespace and makes the
 * entries written under the previous shape unreachable.
 *
 * Exported so a test can rebuild the namespace from a modified sample and assert
 * the isolation the roll provides, rather than pinning the resulting hash.
 */
export function buildMdxEsmCacheSchemaSample() {
  return {
    transformKey: formatMdxEsmTransformCacheKey(
      CACHE_NAMESPACE_SENTINEL,
      "__vf_project__",
      "preview-main",
      "19.1.1",
      "_vf_modules/pages/index.js",
      "deadbeef",
    ),
    // Development artifacts carry a compile-mode variant segment; production
    // artifacts stay on the unsegmented key. Naming the split here rolls the
    // namespace, so entries written before the compile mode was part of the
    // cache identity (all of them development-compiled) cannot be served to a
    // production render. `cache-format.test.ts` fails if this line is dropped.
    devCompileVariant: MDX_MODULE_DEV_COMPILE_VARIANT,
    pathKey: formatMdxEsmPathCacheKey(
      CACHE_NAMESPACE_SENTINEL,
      REACT_DEFAULT_VERSION,
      "_vf_modules/pages/index.js",
    ),
    moduleFile: formatMdxEsmModuleFileName(CACHE_NAMESPACE_SENTINEL, "deadbeef"),
    moduleRecoveryKey: formatMdxEsmModuleRecoveryCacheKey(
      CACHE_NAMESPACE_SENTINEL,
      "__vf_project__",
      "preview-main",
      formatMdxEsmModuleFileName(CACHE_NAMESPACE_SENTINEL, "deadbeef"),
    ),
    jsxFile: formatMdxJsxCacheFileName(
      CACHE_NAMESPACE_SENTINEL,
      "/tmp/project/Button.tsx",
      "export default function Button() {}",
    ),
    // The per-path prefix is what makes superseded content variants findable
    // for deletion. Naming it here rolls the namespace so entries written under
    // the unprefixed shape, which nothing can group or evict, stay unreachable.
    jsxFilePrefix: formatMdxJsxCacheFileNamePrefix(
      CACHE_NAMESPACE_SENTINEL,
      "/tmp/project/Button.tsx",
    ),
    unresolvedVfModulesPattern: UNRESOLVED_VF_MODULES_PATTERN.source,
    allFileUrlPattern: ALL_FILE_URL_PATTERN_SOURCE,
    mjsFileUrlPattern: MJS_FILE_URL_PATTERN_SOURCE,
    pathCacheAttributionSchema: MDX_ESM_PATH_CACHE_ATTRIBUTION_SCHEMA,
    sourceHashing: [
      hashString("_vf_modules/pages/index.jsexport default 1;"),
      hashString("/tmp/project/Button.tsx\0export default function Button() {}"),
    ],
    publicRuntimeAliases: buildPublicRuntimeAliasSchema({
      "veryfront/head": "./src/react/runtime/core.ts",
      "veryfront/router": "./src/react/runtime/core.ts",
      "veryfront/context": "./src/react/runtime/core.ts",
    }),
    frameworkVersion: RUNTIME_VERSION,
  };
}

function buildFrameworkVfModuleCacheSchemaSample() {
  return {
    moduleFile: formatFrameworkVfModuleCacheFileName(
      CACHE_NAMESPACE_SENTINEL,
      hashCodeHex("/_vf_modules/_veryfront/react/runtime/core.js"),
      hashCodeHex("/app/.cache/veryfront-mdx-esm").slice(0, 8),
      hashCodeHex("export default function Head() {}"),
    ),
    publicRuntimeAliases: buildPublicRuntimeAliasSchema({
      "veryfront/head": "./src/react/runtime/core.ts",
      "veryfront/router": "./src/react/runtime/core.ts",
      "veryfront/context": "./src/react/runtime/core.ts",
    }),
  };
}

export const MDX_ESM_ALL_FILE_URL_PATTERN_SOURCE = ALL_FILE_URL_PATTERN_SOURCE;
export const MDX_ESM_MJS_FILE_URL_PATTERN_SOURCE = MJS_FILE_URL_PATTERN_SOURCE;

export const MDX_ESM_CACHE_NAMESPACE = createCacheNamespace(
  "mdx-esm",
  buildMdxEsmCacheSchemaSample(),
);

export const FRAMEWORK_VF_MODULE_CACHE_NAMESPACE = createCacheNamespace(
  "vf-framework",
  buildFrameworkVfModuleCacheSchemaSample(),
);

export function buildMdxEsmTransformCacheKey(
  projectId: string,
  contentSourceId: string,
  reactVersion: string,
  normalizedPath: string,
  contentHash: string,
  cacheVariant?: string,
): string {
  return formatMdxEsmTransformCacheKey(
    MDX_ESM_CACHE_NAMESPACE,
    projectId,
    contentSourceId,
    reactVersion,
    normalizedPath,
    contentHash,
    cacheVariant,
  );
}

export function buildMdxEsmPathCacheKey(
  normalizedPath: string,
  reactVersion = REACT_DEFAULT_VERSION,
  cacheVariant?: string,
): string {
  return formatMdxEsmPathCacheKey(
    MDX_ESM_CACHE_NAMESPACE,
    reactVersion,
    normalizedPath,
    cacheVariant,
  );
}

export function buildMdxEsmModuleFileName(contentHash: string): string {
  return formatMdxEsmModuleFileName(MDX_ESM_CACHE_NAMESPACE, contentHash);
}

export function buildMdxEsmModuleRecoveryCacheKey(
  projectId: string,
  contentSourceId: string,
  fileName: string,
): string {
  return formatMdxEsmModuleRecoveryCacheKey(
    MDX_ESM_CACHE_NAMESPACE,
    projectId,
    contentSourceId,
    fileName,
  );
}

export function buildMdxJsxCacheFileName(filePath: string, sourceCode: string): string {
  return formatMdxJsxCacheFileName(MDX_ESM_CACHE_NAMESPACE, filePath, sourceCode);
}

/** Name prefix every cached JSX artifact for `filePath` shares. */
export function buildMdxJsxCacheFileNamePrefix(filePath: string): string {
  return formatMdxJsxCacheFileNamePrefix(MDX_ESM_CACHE_NAMESPACE, filePath);
}

export function buildFrameworkVfModuleCacheFileName(
  pathHash: string,
  envKey: string,
  contentHash: string,
): string {
  return formatFrameworkVfModuleCacheFileName(
    FRAMEWORK_VF_MODULE_CACHE_NAMESPACE,
    pathHash,
    envKey,
    contentHash,
  );
}
