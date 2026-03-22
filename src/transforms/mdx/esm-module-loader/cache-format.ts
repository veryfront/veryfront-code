import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { createCacheNamespace } from "#veryfront/utils/cache-namespace.ts";
import { UNRESOLVED_VF_MODULES_PATTERN } from "./constants.ts";
import { hashString } from "./utils/hash.ts";

const ALL_FILE_URL_PATTERN_SOURCE = /file:\/\/([^"'\s]+)/.source;
const MJS_FILE_URL_PATTERN_SOURCE = /file:\/\/([^"'\s]+\.mjs)/.source;
const CACHE_NAMESPACE_SENTINEL = "__vf_cache_namespace__";

function formatMdxEsmTransformCacheKey(
  namespace: string,
  projectId: string,
  normalizedPath: string,
  contentHash: string,
): string {
  return `${namespace}:${projectId}:${normalizedPath}:${contentHash}:ssr`;
}

function formatMdxEsmPathCacheKey(namespace: string, normalizedPath: string): string {
  return `${namespace}:${normalizedPath}`;
}

function formatMdxEsmModuleFileName(namespace: string, contentHash: string): string {
  return `vfmod-${namespace}-${contentHash}.mjs`;
}

function formatMdxJsxCacheFileName(namespace: string, filePath: string): string {
  return `jsx-${namespace}-${hashString(filePath)}.mjs`;
}

function formatFrameworkVfModuleCacheFileName(
  namespace: string,
  pathHash: string,
  envKey: string,
  contentHash: string,
): string {
  return `vfmod-${namespace}-${pathHash}-${envKey}-${contentHash}.mjs`;
}

function buildMdxEsmCacheSchemaSample() {
  return {
    transformKey: formatMdxEsmTransformCacheKey(
      CACHE_NAMESPACE_SENTINEL,
      "__vf_project__",
      "_vf_modules/pages/index.js",
      "deadbeef",
    ),
    pathKey: formatMdxEsmPathCacheKey(CACHE_NAMESPACE_SENTINEL, "_vf_modules/pages/index.js"),
    moduleFile: formatMdxEsmModuleFileName(CACHE_NAMESPACE_SENTINEL, "deadbeef"),
    jsxFile: formatMdxJsxCacheFileName(CACHE_NAMESPACE_SENTINEL, "/tmp/project/Button.tsx"),
    unresolvedVfModulesPattern: UNRESOLVED_VF_MODULES_PATTERN.source,
    allFileUrlPattern: ALL_FILE_URL_PATTERN_SOURCE,
    mjsFileUrlPattern: MJS_FILE_URL_PATTERN_SOURCE,
    sourceHashing: [
      hashString("_vf_modules/pages/index.jsexport default 1;"),
      hashString("/tmp/project/Button.tsx"),
    ],
  };
}

function buildFrameworkVfModuleCacheSchemaSample() {
  return {
    moduleFile: formatFrameworkVfModuleCacheFileName(
      CACHE_NAMESPACE_SENTINEL,
      hashCodeHex("_vf_modules/_veryfront/react/components/Head.js"),
      hashCodeHex("/app/.cache/veryfront-mdx-esm").slice(0, 8),
      hashCodeHex("export default function Head() {}"),
    ),
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
  normalizedPath: string,
  contentHash: string,
): string {
  return formatMdxEsmTransformCacheKey(
    MDX_ESM_CACHE_NAMESPACE,
    projectId,
    normalizedPath,
    contentHash,
  );
}

export function buildMdxEsmPathCacheKey(normalizedPath: string): string {
  return formatMdxEsmPathCacheKey(MDX_ESM_CACHE_NAMESPACE, normalizedPath);
}

export function buildMdxEsmModuleFileName(contentHash: string): string {
  return formatMdxEsmModuleFileName(MDX_ESM_CACHE_NAMESPACE, contentHash);
}

export function buildMdxJsxCacheFileName(filePath: string): string {
  return formatMdxJsxCacheFileName(MDX_ESM_CACHE_NAMESPACE, filePath);
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
