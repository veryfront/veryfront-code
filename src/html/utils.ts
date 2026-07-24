import { escapeHTML } from "./html-escape.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import {
  RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG,
  RELEASE_MODULE_RUNTIME_VERSION_PARAM,
  RELEASE_MODULE_VERSION_PARAM,
  releaseAssetUrl,
} from "#veryfront/release-assets/constants.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { VERYFRONT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import {
  DEFAULT_REACT_VERSION,
  esmShReact,
  readProjectDependencyVersions,
  resolveProjectReactVersion,
  stripSemverRange,
} from "#veryfront/transforms/esm/package-registry.ts";
import { jsonForInlineScript } from "#veryfront/security/client/html-sanitizer.ts";

function joinAttributes(attrs: Array<string | false | undefined | null | "">): string {
  return attrs.filter(Boolean).join(" ");
}

export function buildRootAttributes(
  slug: string,
  mode: string,
  noLayout: boolean,
  ssrHash?: string,
): string {
  return joinAttributes([
    'id="root"',
    `data-veryfront-slug="${escapeHTML(slug || "")}"`,
    `data-veryfront-mode="${escapeHTML(mode || "production")}"`,
    `data-layout="${noLayout ? "none" : "default"}"`,
    ssrHash && `data-ssr-hash="${escapeHTML(ssrHash)}"`,
  ]);
}

interface DetectedVersions {
  react: string;
  veryfront: string;
}

interface CachedImportMapEntry {
  cacheKey: string;
  imports: Record<string, string>;
  json: string;
}

export interface BuiltImportMap {
  imports: Record<string, string>;
  json: string;
}

const DEFAULT_VERSIONS: DetectedVersions = {
  react: DEFAULT_REACT_VERSION,
  veryfront: VERYFRONT_VERSION,
};

/**
 * Import map JSON is deterministic per cache key, so entries are safe to evict
 * and recompute. Bound the cache so distinct key combinations (project dir ×
 * mode × provider × versions × custom imports) cannot grow memory without
 * limit.
 */
const IMPORT_MAP_CACHE_MAX_ENTRIES = 256;

const importMapJsonCache = new LRUCache<string, CachedImportMapEntry>({
  maxEntries: IMPORT_MAP_CACHE_MAX_ENTRIES,
});

type CdnProvider = "esm.sh" | "unpkg" | "jsdelivr";

// Platform utilities served from local module server to match SSR behavior.
// This ensures hydration matches (same code on server and client).
// CRITICAL: veryfront/context must use local module to share React context with SSR.
// Using esm.sh creates a separate context instance causing usePageContext to return undefined.
const CORE_REACT_RUNTIME_PATH = "/_vf_modules/_veryfront/react/runtime/core.js";

const PLATFORM_UTILITY_PATHS = {
  head: CORE_REACT_RUNTIME_PATH,
  router: CORE_REACT_RUNTIME_PATH,
  context: CORE_REACT_RUNTIME_PATH,
  fonts: "/_vf_modules/_veryfront/react/fonts/index.js",
  // Client-side AI/chat modules - use local module server in dev for faster iteration
  // NOTE: These are NOT available in compiled binaries, so we use CDN URLs there instead
  chat: "/_vf_modules/_veryfront/chat/index.js",
  markdown: "/_vf_modules/_veryfront/markdown/index.js",
  mdx: "/_vf_modules/_veryfront/mdx/index.js",
  workflow: "/_vf_modules/_veryfront/workflow/react/index.js",
} as const;

// Core platform utilities that are always served locally (embedded in compiled binary)
const CORE_PLATFORM_UTILITIES: Record<string, string> = {
  "veryfront/head": PLATFORM_UTILITY_PATHS.head,
  "veryfront/router": PLATFORM_UTILITY_PATHS.router,
  "veryfront/context": PLATFORM_UTILITY_PATHS.context,
  "veryfront/fonts": PLATFORM_UTILITY_PATHS.fonts,
  "veryfront/react/head": PLATFORM_UTILITY_PATHS.head,
  "veryfront/react/router": PLATFORM_UTILITY_PATHS.router,
  "veryfront/react/context": PLATFORM_UTILITY_PATHS.context,
  "veryfront/react/fonts": PLATFORM_UTILITY_PATHS.fonts,
};

// AI/chat modules - served from local module server (embedded in compiled binary)
const AI_MODULE_UTILITIES: Record<string, string> = {
  "veryfront/chat": PLATFORM_UTILITY_PATHS.chat,
  "veryfront/markdown": PLATFORM_UTILITY_PATHS.markdown,
  "veryfront/mdx": PLATFORM_UTILITY_PATHS.mdx,
  "veryfront/workflow": PLATFORM_UTILITY_PATHS.workflow,
};

export const PLATFORM_UTILITIES: Record<string, string> = {
  ...CORE_PLATFORM_UTILITIES,
  ...AI_MODULE_UTILITIES,
};

interface CdnUrlTemplates {
  react: (version: string) => string;
  reactDom: (version: string) => string;
  reactDomClient: (version: string) => string;
  jsxRuntime: (version: string) => string;
  jsxDevRuntime: (version: string) => string;
  veryfrontChat: (version: string) => string;
  veryfrontMarkdown: (version: string) => string;
  veryfrontMdx: (version: string) => string;
  veryfrontWorkflow: (version: string) => string;
}

const CDN_URL_TEMPLATES: Record<CdnProvider, CdnUrlTemplates> = {
  "esm.sh": {
    // Use centralized esmShReact() helper from package-registry.ts to ensure URL consistency
    // Any URL mismatch causes esm.sh to serve different modules -> multiple React instances -> hooks fail
    react: (v) => esmShReact("react", v),
    reactDom: (v) => esmShReact("react-dom", v, "", true),
    reactDomClient: (v) => esmShReact("react-dom", v, "/client", true),
    jsxRuntime: (v) => esmShReact("react", v, "/jsx-runtime", true),
    jsxDevRuntime: (v) => esmShReact("react", v, "/jsx-dev-runtime", true),
    veryfrontChat: (v) =>
      `https://esm.sh/veryfront@${v}/chat?external=react,react-dom&target=es2022`,
    veryfrontMarkdown: (v) =>
      `https://esm.sh/veryfront@${v}/markdown?external=react,react-dom&target=es2022`,
    veryfrontMdx: (v) => `https://esm.sh/veryfront@${v}/mdx?external=react,react-dom&target=es2022`,
    veryfrontWorkflow: (v) =>
      `https://esm.sh/veryfront@${v}/workflow/react?external=react,react-dom&target=es2022`,
  },
  unpkg: {
    react: (v) => `https://unpkg.com/react@${v}/umd/react.production.min.js`,
    reactDom: (v) => `https://unpkg.com/react-dom@${v}/umd/react-dom.production.min.js`,
    reactDomClient: (v) => `https://unpkg.com/react-dom@${v}/umd/react-dom.production.min.js`,
    jsxRuntime: (v) => `https://unpkg.com/react@${v}/jsx-runtime`,
    jsxDevRuntime: (v) => `https://unpkg.com/react@${v}/jsx-dev-runtime`,
    veryfrontChat: (v) => `https://unpkg.com/veryfront@${v}/esm/src/chat/index.js`,
    veryfrontMarkdown: (v) => `https://unpkg.com/veryfront@${v}/esm/src/markdown/index.js`,
    veryfrontMdx: (v) => `https://unpkg.com/veryfront@${v}/esm/src/mdx/index.js`,
    veryfrontWorkflow: (v) => `https://unpkg.com/veryfront@${v}/esm/src/workflow/react/index.js`,
  },
  jsdelivr: {
    react: (v) => `https://cdn.jsdelivr.net/npm/react@${v}/umd/react.production.min.js`,
    reactDom: (v) => `https://cdn.jsdelivr.net/npm/react-dom@${v}/umd/react-dom.production.min.js`,
    reactDomClient: (v) =>
      `https://cdn.jsdelivr.net/npm/react-dom@${v}/umd/react-dom.production.min.js`,
    jsxRuntime: (v) => `https://cdn.jsdelivr.net/npm/react@${v}/jsx-runtime`,
    jsxDevRuntime: (v) => `https://cdn.jsdelivr.net/npm/react@${v}/jsx-dev-runtime`,
    veryfrontChat: (v) => `https://cdn.jsdelivr.net/npm/veryfront@${v}/esm/src/chat/index.js`,
    veryfrontMarkdown: (v) =>
      `https://cdn.jsdelivr.net/npm/veryfront@${v}/esm/src/markdown/index.js`,
    veryfrontMdx: (v) => `https://cdn.jsdelivr.net/npm/veryfront@${v}/esm/src/mdx/index.js`,
    veryfrontWorkflow: (v) =>
      `https://cdn.jsdelivr.net/npm/veryfront@${v}/esm/src/workflow/react/index.js`,
  },
};

function buildCdnImportMapFromTemplates(
  versions: DetectedVersions,
  templates: CdnUrlTemplates,
  // Whether the AI/chat modules (chat/markdown/mdx/workflow) are also served
  // locally instead of from the CDN. The CORE platform utilities
  // (router/head/context/fonts) are ALWAYS served locally regardless of
  // provider — they must share the same React context module instance as SSR,
  // otherwise usePageContext() returns undefined and the browser fails to even
  // resolve `veryfront/router`. CDN is for third-party deps (react) and,
  // optionally, the AI modules — never the core runtime.
  includeAiModulesLocally: boolean,
): Record<string, string> {
  const { react, veryfront } = versions;

  // React is ALWAYS served from esm.sh, regardless of the configured CDN
  // provider. esm.sh is the only CDN that serves React as real ESM; unpkg and
  // jsdelivr only ship UMD globals (react/umd/react.production.min.js), which
  // cannot be consumed through an import map at all — the browser rejects them
  // with a module-resolution/CORS error and hydration never starts. Self-hosted
  // mode already does exactly this. The `provider` only governs where the
  // veryfront framework modules load from.
  const reactTemplates = CDN_URL_TEMPLATES["esm.sh"];

  return {
    react: reactTemplates.react(react),
    "react-dom": reactTemplates.reactDom(react),
    "react-dom/client": reactTemplates.reactDomClient(react),
    "react/jsx-runtime": reactTemplates.jsxRuntime(react),
    "react/jsx-dev-runtime": reactTemplates.jsxDevRuntime(react),
    "veryfront/chat": templates.veryfrontChat(veryfront),
    "veryfront/markdown": templates.veryfrontMarkdown(veryfront),
    "veryfront/mdx": templates.veryfrontMdx(veryfront),
    "veryfront/workflow": templates.veryfrontWorkflow(veryfront),
    // Core runtime utilities always resolve locally (see comment above).
    ...CORE_PLATFORM_UTILITIES,
    // AI modules only override the CDN entries when requested.
    ...(includeAiModulesLocally ? AI_MODULE_UTILITIES : {}),
  };
}

function getEsmShImportMap(versions: DetectedVersions): Record<string, string> {
  return buildCdnImportMapFromTemplates(versions, CDN_URL_TEMPLATES["esm.sh"], true);
}

function getUnpkgImportMap(versions: DetectedVersions): Record<string, string> {
  return buildCdnImportMapFromTemplates(versions, CDN_URL_TEMPLATES.unpkg, false);
}

function getJsdelivrImportMap(versions: DetectedVersions): Record<string, string> {
  return buildCdnImportMapFromTemplates(versions, CDN_URL_TEMPLATES.jsdelivr, false);
}

function getSelfHostedImportMap(versions: DetectedVersions): Record<string, string> {
  const { react } = versions;
  const esmShTemplates = CDN_URL_TEMPLATES["esm.sh"];

  return {
    react: esmShTemplates.react(react),
    "react-dom": esmShTemplates.reactDom(react),
    "react-dom/client": esmShTemplates.reactDomClient(react),
    "react/jsx-runtime": esmShTemplates.jsxRuntime(react),
    "react/jsx-dev-runtime": esmShTemplates.jsxDevRuntime(react),
    "veryfront/chat": "/_veryfront/lib/chat.js",
    "veryfront/markdown": "/_veryfront/lib/markdown.js",
    "veryfront/mdx": "/_veryfront/lib/mdx.js",
    "veryfront/workflow": "/_veryfront/lib/workflow.js",
    "veryfront/head": PLATFORM_UTILITY_PATHS.head,
    "veryfront/router": PLATFORM_UTILITY_PATHS.router,
    "veryfront/context": PLATFORM_UTILITY_PATHS.context,
    "veryfront/fonts": PLATFORM_UTILITY_PATHS.fonts,
  };
}

const CDN_IMPORT_MAP_FACTORIES: Record<
  CdnProvider,
  (versions: DetectedVersions) => Record<string, string>
> = {
  unpkg: getUnpkgImportMap,
  jsdelivr: getJsdelivrImportMap,
  "esm.sh": getEsmShImportMap,
};

function getCdnImportMap(
  versions: DetectedVersions,
  provider: CdnProvider = "esm.sh",
): Record<string, string> {
  return (CDN_IMPORT_MAP_FACTORIES[provider] ?? getEsmShImportMap)(versions);
}

async function resolveVersions(
  projectDir: string | undefined,
  config?: VeryfrontConfig,
): Promise<DetectedVersions> {
  // Use shared resolver for React (handles config override + package.json + fallback)
  const versionsConfig = config?.client?.cdn?.versions;
  const configuredVeryfrontVersion = versionsConfig && versionsConfig !== "auto"
    ? versionsConfig.veryfront
    : undefined;
  const detected: { react?: string; veryfront?: string } = projectDir
    ? await readProjectDependencyVersions(projectDir)
    : {};
  const reactVersion = await resolveProjectReactVersion({ projectDir, config });

  // Resolve veryfront version separately (config override or detection)
  let veryfrontVersion = DEFAULT_VERSIONS.veryfront;

  if (configuredVeryfrontVersion) {
    veryfrontVersion = stripSemverRange(configuredVeryfrontVersion);
  } else if (detected.veryfront) {
    veryfrontVersion = detected.veryfront;
  }

  return { react: reactVersion, veryfront: veryfrontVersion };
}

interface BuildImportMapOptions {
  projectDir?: string;
  config?: VeryfrontConfig;
  customImports?: Record<string, string>;
  pretty?: boolean;
  releaseAssetManifest?: ReleaseAssetManifest | null;
}

function stringifyImportMap(imports: Record<string, string>, pretty = true): string {
  return jsonForInlineScript({ imports }, pretty ? 2 : undefined);
}

function stableMapKey(imports?: Record<string, string>): string {
  return imports
    ? JSON.stringify(Object.entries(imports).sort(([a], [b]) => a.localeCompare(b)))
    : "";
}

function stableManifestDependencyKey(manifest?: ReleaseAssetManifest | null): string {
  return manifest
    ? JSON.stringify({
      assetBasePath: manifest.assetBasePath,
      releaseId: manifest.releaseId,
      manifestVersion: manifest.manifestVersion,
      dependencies: Object.entries(manifest.dependencies)
        .map(([specifier, entry]) => [specifier, entry.contentHash])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    })
    : "";
}

function canonicalDependencyUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return value;

    const sortedParams = [...url.searchParams.entries()].sort(([leftKey, leftValue], [
      rightKey,
      rightValue,
    ]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
    url.search = "";
    for (const [key, paramValue] of sortedParams) {
      url.searchParams.append(key, paramValue);
    }
    return url.toString();
  } catch {
    return value;
  }
}

function applyManifestDependencies(
  imports: Record<string, string>,
  manifest?: ReleaseAssetManifest | null,
): Record<string, string> {
  if (!manifest) return imports;
  if (getHostEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG) !== "1") return imports;

  const dependencyAssets = new Map<string, string>();
  for (const [specifier, entry] of Object.entries(manifest.dependencies)) {
    const assetUrl = releaseAssetUrl(entry.contentHash, "js");
    dependencyAssets.set(specifier, assetUrl);
    dependencyAssets.set(canonicalDependencyUrl(specifier), assetUrl);
  }

  return Object.fromEntries(
    Object.entries(imports).map(([specifier, url]) => {
      const directAsset = dependencyAssets.get(specifier);
      if (directAsset) return [specifier, directAsset];

      const urlAsset = dependencyAssets.get(url) ??
        dependencyAssets.get(canonicalDependencyUrl(url));
      if (urlAsset) return [specifier, urlAsset];

      return [specifier, url];
    }),
  );
}

function shouldVersionReleaseModuleImportMapUrl(value: string): boolean {
  if (!value.startsWith("/_vf_modules/")) return false;
  const pathname = value.split(/[?#]/, 1)[0] ?? "";
  return pathname.endsWith(".js") || pathname.endsWith(".mjs");
}

function appendReleaseModuleVersion(value: string, releaseId: string): string {
  if (!shouldVersionReleaseModuleImportMapUrl(value)) return value;

  const url = new URL(value, "https://veryfront.local");
  url.searchParams.set(RELEASE_MODULE_VERSION_PARAM, releaseId);
  url.searchParams.set(RELEASE_MODULE_RUNTIME_VERSION_PARAM, VERYFRONT_VERSION);
  return `${url.pathname}${url.search}${url.hash}`;
}

function applyReleaseModuleVersions(
  imports: Record<string, string>,
  manifest?: ReleaseAssetManifest | null,
): Record<string, string> {
  if (!manifest?.releaseId) return imports;

  return Object.fromEntries(
    Object.entries(imports).map(([specifier, url]) => [
      specifier,
      appendReleaseModuleVersion(url, manifest.releaseId),
    ]),
  );
}

function isImportMapOnlyOptions(
  options: BuildImportMapOptions | Record<string, string>,
): options is Record<string, string> {
  return !("projectDir" in options) &&
    !("config" in options) &&
    !("customImports" in options) &&
    !("releaseAssetManifest" in options) &&
    !("pretty" in options);
}

export async function buildImportMap(
  options?: BuildImportMapOptions | Record<string, string>,
): Promise<BuiltImportMap> {
  if (options && isImportMapOnlyOptions(options)) {
    const imports = { ...options };
    if (Object.keys(imports).length > 0) {
      return { imports, json: stringifyImportMap(imports) };
    }
  }

  const { projectDir, config, customImports, pretty = true, releaseAssetManifest } =
    (options ?? {}) as BuildImportMapOptions;
  const mode = config?.client?.moduleResolution ?? "cdn";
  const versions = projectDir || config
    ? await resolveVersions(projectDir, config)
    : DEFAULT_VERSIONS;

  if (mode === "bundled") {
    const reactTemplates = CDN_URL_TEMPLATES["esm.sh"];
    let imports: Record<string, string> = {
      react: reactTemplates.react(versions.react),
      "react-dom": reactTemplates.reactDom(versions.react),
      "react-dom/client": reactTemplates.reactDomClient(versions.react),
      "react/jsx-runtime": reactTemplates.jsxRuntime(versions.react),
      "react/jsx-dev-runtime": reactTemplates.jsxDevRuntime(versions.react),
    };
    imports = applyManifestDependencies(imports, releaseAssetManifest);
    imports = applyReleaseModuleVersions(imports, releaseAssetManifest);
    imports = { ...imports, ...customImports };

    return { imports, json: stringifyImportMap(imports, pretty) };
  }

  let imports: Record<string, string>;
  if (mode === "self-hosted") {
    imports = getSelfHostedImportMap(versions);
  } else {
    imports = getCdnImportMap(
      versions,
      (config?.client?.cdn?.provider ?? "esm.sh") as CdnProvider,
    );
  }

  imports["@/"] = "/_vf_modules/";
  imports = applyManifestDependencies(imports, releaseAssetManifest);
  imports = applyReleaseModuleVersions(imports, releaseAssetManifest);

  if (customImports) {
    imports = { ...imports, ...customImports };
  }

  const cacheKey = JSON.stringify({
    projectDir: projectDir ?? "",
    mode,
    provider: config?.client?.cdn?.provider ?? "esm.sh",
    react: versions.react,
    veryfront: versions.veryfront,
    pretty,
    customImports: stableMapKey(customImports),
    dependencyImportMapEnabled: getHostEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG) === "1",
    manifestDependencies: stableManifestDependencyKey(releaseAssetManifest),
  });
  const cached = importMapJsonCache.get(cacheKey);
  if (cached) return cached;

  const json = stringifyImportMap(imports, pretty);
  const built = { cacheKey, imports, json };
  importMapJsonCache.set(cacheKey, built);
  return built;
}

export async function buildImportMapJson(
  options?: BuildImportMapOptions | Record<string, string>,
): Promise<string> {
  return (await buildImportMap(options)).json;
}

export function clearImportMapCache(): void {
  importMapJsonCache.clear();
}

export function shouldDisableLayout(frontmatter?: Record<string, unknown>): boolean {
  return frontmatter?.layout === false || frontmatter?.layout === "false";
}
