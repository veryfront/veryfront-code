import { escapeHTML } from "./html-escape.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import {
  isValidContentHash,
  RELEASE_ASSET_CONTENT_TYPES,
  RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG,
  RELEASE_ASSET_MAX_SIZE_BYTES,
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
import { INPUT_VALIDATION_FAILED } from "#veryfront/errors/error-registry/general.ts";
import {
  assertBoundedHTMLText,
  getUTF8ByteLength,
  MAX_HTML_IMPORT_MAP_BYTES,
  MAX_HTML_IMPORT_SPECIFIER_BYTES,
  MAX_HTML_RELEASE_ID_BYTES,
} from "./limits.ts";
import { validateCustomImportMap } from "./import-map-validation.ts";
import { snapshotPlainDataRecord } from "./json-snapshot.ts";

function joinAttributes(attrs: Array<string | false | undefined | null | "">): string {
  return attrs.filter(Boolean).join(" ");
}

export function buildRootAttributes(
  slug: string,
  mode: "development" | "production",
  noLayout: boolean,
  ssrHash?: string,
): string {
  if (mode !== "development" && mode !== "production") {
    throw new TypeError("HTML mode must be development or production");
  }
  return joinAttributes([
    'id="root"',
    `data-veryfront-slug="${escapeHTML(slug || "")}"`,
    `data-veryfront-mode="${escapeHTML(mode)}"`,
    `data-layout="${noLayout ? "none" : "default"}"`,
    ssrHash && `data-ssr-hash="${escapeHTML(ssrHash)}"`,
  ]);
}

interface DetectedVersions {
  react: string;
  veryfront: string;
}

interface CachedImportMapEntry {
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
const MAX_MANIFEST_DEPENDENCIES = 10_000;
const MAX_RELEASE_MANIFEST_FIELDS = 256;
const MAX_RELEASE_DEPENDENCY_ENTRY_FIELDS = 16;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

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

export const PLATFORM_UTILITIES: Readonly<Record<string, string>> = Object.freeze({
  ...CORE_PLATFORM_UTILITIES,
  ...AI_MODULE_UTILITIES,
});

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
  includePlatformUtilities: boolean,
): Record<string, string> {
  const { react, veryfront } = versions;

  return {
    react: templates.react(react),
    "react-dom": templates.reactDom(react),
    "react-dom/client": templates.reactDomClient(react),
    "react/jsx-runtime": templates.jsxRuntime(react),
    "react/jsx-dev-runtime": templates.jsxDevRuntime(react),
    "veryfront/chat": templates.veryfrontChat(veryfront),
    "veryfront/markdown": templates.veryfrontMarkdown(veryfront),
    "veryfront/mdx": templates.veryfrontMdx(veryfront),
    "veryfront/workflow": templates.veryfrontWorkflow(veryfront),
    ...(includePlatformUtilities ? PLATFORM_UTILITIES : {}),
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
  const factory = CDN_IMPORT_MAP_FACTORIES[provider];
  if (!factory) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Unsupported import-map CDN provider" });
  }
  return factory(versions);
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
  const json = jsonForInlineScript({ imports }, pretty ? 2 : undefined);
  if (getUTF8ByteLength(json) > MAX_HTML_IMPORT_MAP_BYTES) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "Import map exceeds the aggregate byte budget",
    });
  }
  return json;
}

function stableMapKey(imports?: Record<string, string>): string {
  return imports
    ? JSON.stringify(Object.entries(imports).sort(([a], [b]) => a.localeCompare(b)))
    : "";
}

interface ReleaseManifestImportContext {
  releaseId?: string;
  dependencies: Array<[string, { contentHash: string }]>;
}

function snapshotReleaseManifest(
  manifest: ReleaseAssetManifest | null | undefined,
  includeDependencies: boolean,
): ReleaseManifestImportContext | null {
  if (!manifest) return null;
  const manifestSnapshot = snapshotPlainDataRecord(
    manifest,
    "Release manifest",
    MAX_RELEASE_MANIFEST_FIELDS,
  );
  const releaseId = manifestSnapshot.releaseId;
  if (releaseId !== undefined && typeof releaseId !== "string") {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Release manifest ID must be a string" });
  }
  if (typeof releaseId === "string") {
    assertBoundedHTMLText(releaseId, "HTML release ID", MAX_HTML_RELEASE_ID_BYTES, {
      allowEmpty: true,
    });
  }

  return {
    releaseId,
    dependencies: includeDependencies
      ? collectManifestDependencies(manifestSnapshot.dependencies)
      : [],
  };
}

function stableManifestDependencyKey(context: ReleaseManifestImportContext | null): string {
  return context
    ? JSON.stringify({
      releaseId: context.releaseId,
      dependencies: context.dependencies
        .map(([specifier, entry]) => [specifier, entry.contentHash])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    })
    : "";
}

function collectManifestDependencies(
  value: unknown,
): Array<[string, { contentHash: string }]> {
  const dependenciesSnapshot = snapshotPlainDataRecord(
    value,
    "Release manifest dependency collection",
    MAX_MANIFEST_DEPENDENCIES,
  );
  const specifiers = Object.keys(dependenciesSnapshot);

  const dependencies: Array<[string, { contentHash: string }]> = [];
  for (const specifier of specifiers) {
    if (
      specifier.length === 0 ||
      getUTF8ByteLength(specifier) > MAX_HTML_IMPORT_SPECIFIER_BYTES ||
      hasControlCharacter(specifier)
    ) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "Release manifest dependency specifier is invalid",
      });
    }
    const entry = snapshotPlainDataRecord(
      dependenciesSnapshot[specifier],
      "Release manifest dependency entry",
      MAX_RELEASE_DEPENDENCY_ENTRY_FIELDS,
    );
    const contentHash = entry.contentHash;
    const size = entry.size;
    const contentType = entry.contentType;
    if (
      typeof contentHash !== "string" || !isValidContentHash(contentHash) ||
      !Number.isSafeInteger(size) || (size as number) < 0 ||
      (size as number) > RELEASE_ASSET_MAX_SIZE_BYTES ||
      contentType !== RELEASE_ASSET_CONTENT_TYPES.js
    ) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "Release manifest dependency entry is invalid",
      });
    }
    dependencies.push([specifier, { contentHash }]);
  }
  return dependencies;
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
  context: ReleaseManifestImportContext | null,
  enabled: boolean,
): Record<string, string> {
  if (!context || !enabled) return imports;

  const dependencyAssets = new Map<string, string>();
  for (const [specifier, entry] of context.dependencies) {
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
  assertBoundedHTMLText(releaseId, "HTML release ID", MAX_HTML_RELEASE_ID_BYTES);

  const url = new URL(value, "https://veryfront.local");
  url.searchParams.set(RELEASE_MODULE_VERSION_PARAM, releaseId);
  url.searchParams.set(RELEASE_MODULE_RUNTIME_VERSION_PARAM, VERYFRONT_VERSION);
  return `${url.pathname}${url.search}${url.hash}`;
}

function applyReleaseModuleVersions(
  imports: Record<string, string>,
  context: ReleaseManifestImportContext | null,
): Record<string, string> {
  const releaseId = context?.releaseId;
  if (!releaseId) return imports;

  return Object.fromEntries(
    Object.entries(imports).map(([specifier, url]) => [
      specifier,
      appendReleaseModuleVersion(url, releaseId),
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
    const imports = validateCustomImportMap(options);
    if (Object.keys(imports).length > 0) {
      return { imports, json: stringifyImportMap(imports) };
    }
  }

  const {
    projectDir,
    config,
    customImports: rawCustomImports,
    pretty = true,
    releaseAssetManifest,
  } = (options ?? {}) as BuildImportMapOptions;
  if (typeof pretty !== "boolean") {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Import-map pretty option must be boolean" });
  }
  const mode = config?.client?.moduleResolution ?? "cdn";
  if (mode !== "cdn" && mode !== "self-hosted" && mode !== "bundled") {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Unsupported module resolution mode" });
  }
  const customImports = rawCustomImports === undefined
    ? undefined
    : validateCustomImportMap(rawCustomImports);
  const dependencyImportMapEnabled =
    getHostEnv(RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG) === "1";
  const releaseManifestContext = snapshotReleaseManifest(
    releaseAssetManifest,
    dependencyImportMapEnabled,
  );
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
    imports = applyManifestDependencies(
      imports,
      releaseManifestContext,
      dependencyImportMapEnabled,
    );
    imports = applyReleaseModuleVersions(imports, releaseManifestContext);
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
  imports = applyManifestDependencies(
    imports,
    releaseManifestContext,
    dependencyImportMapEnabled,
  );
  imports = applyReleaseModuleVersions(imports, releaseManifestContext);

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
    dependencyImportMapEnabled,
    manifestDependencies: stableManifestDependencyKey(releaseManifestContext),
  });
  const cached = importMapJsonCache.get(cacheKey);
  if (cached) return { imports: { ...cached.imports }, json: cached.json };

  const json = stringifyImportMap(imports, pretty);
  importMapJsonCache.set(cacheKey, { imports: { ...imports }, json });
  return { imports, json };
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
  if (frontmatter === undefined) return false;
  const snapshot = snapshotPlainDataRecord(frontmatter, "HTML frontmatter");
  return snapshot.layout === false || snapshot.layout === "false";
}
