import { createCacheNamespace } from "#veryfront/utils/cache-namespace.ts";
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
): string {
  const identity = hashString(
    JSON.stringify([projectId, contentSourceId, reactVersion, normalizedPath, contentHash]),
  );
  return `${namespace}:transform:${identity}:ssr`;
}

function formatMdxEsmPathCacheKey(
  namespace: string,
  reactVersion: string,
  normalizedPath: string,
  sourceContentHash?: string,
): string {
  // This cache is local and needs to support selective path invalidation. Keep
  // the framed identity parseable while binding it to the full source digest.
  return `${namespace}:path:${
    JSON.stringify([
      reactVersion,
      normalizedPath,
      sourceContentHash ?? null,
    ])
  }`;
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
  const identity = hashString(JSON.stringify([projectId, contentSourceId, fileName]));
  return `${namespace}:recovery:${identity}:vfmod`;
}

function formatMdxJsxCacheFileName(
  namespace: string,
  filePath: string,
  sourceCode: string,
): string {
  return `jsx-${namespace}-${hashString(`${filePath}\0${sourceCode}`)}.mjs`;
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
      "preview-main",
      "19.1.1",
      "_vf_modules/pages/index.js",
      "deadbeef",
    ),
    pathKey: formatMdxEsmPathCacheKey(
      CACHE_NAMESPACE_SENTINEL,
      REACT_DEFAULT_VERSION,
      "_vf_modules/pages/index.js",
      "deadbeef",
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
    unresolvedVfModulesPattern: UNRESOLVED_VF_MODULES_PATTERN.source,
    allFileUrlPattern: ALL_FILE_URL_PATTERN_SOURCE,
    mjsFileUrlPattern: MJS_FILE_URL_PATTERN_SOURCE,
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
      hashString("/_vf_modules/_veryfront/react/runtime/core.js"),
      hashString("/app/.cache/veryfront-mdx-esm"),
      hashString("export default function Head() {}"),
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
): string {
  return formatMdxEsmTransformCacheKey(
    MDX_ESM_CACHE_NAMESPACE,
    projectId,
    contentSourceId,
    reactVersion,
    normalizedPath,
    contentHash,
  );
}

export function buildMdxEsmPathCacheKey(
  normalizedPath: string,
  reactVersion = REACT_DEFAULT_VERSION,
  sourceContentHash?: string,
): string {
  return formatMdxEsmPathCacheKey(
    MDX_ESM_CACHE_NAMESPACE,
    reactVersion,
    normalizedPath,
    sourceContentHash,
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
