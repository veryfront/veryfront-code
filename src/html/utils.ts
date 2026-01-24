import { escapeHTML } from "./html-escape.ts";
import type { VeryfrontConfig } from "#veryfront/config/types.ts";
import { REACT_DEFAULT_VERSION, VERYFRONT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { getTailwindImportMap } from "#veryfront/transforms/esm/package-registry.ts";

function joinAttributes(attrs: (string | false | undefined | null | "")[]): string {
  return attrs.filter(Boolean).join(" ");
}

export function buildRootAttributes(
  slug: string,
  mode: string,
  noLayout: boolean,
): string {
  return joinAttributes([
    'id="root"',
    !noLayout && 'class="vf-tailwind"',
    `data-veryfront-slug="${escapeHTML(slug || "")}"`,
    `data-veryfront-mode="${escapeHTML(mode || "production")}"`,
  ]);
}

export function buildContentAttributes(
  slug: string,
  noLayout: boolean,
  ssrHash?: string,
): string {
  return joinAttributes([
    'id="veryfront-content"',
    `data-slug="${slug || ""}"`,
    `data-layout="${noLayout ? "none" : "default"}"`,
    ssrHash && `data-ssr-hash="${escapeHTML(ssrHash)}"`,
  ]);
}

interface DetectedVersions {
  react: string;
  veryfront: string;
}

const DEFAULT_VERSIONS: DetectedVersions = {
  react: REACT_DEFAULT_VERSION,
  veryfront: VERYFRONT_VERSION,
};

export async function detectVersions(projectDir: string): Promise<DetectedVersions> {
  try {
    const { createFileSystem } = await import("../platform/compat/fs.ts");
    const fs = createFileSystem();
    const packageJsonPath = `${projectDir}/package.json`;
    const content = await fs.readTextFile(packageJsonPath);
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    return {
      react: deps?.react?.replace(/[\^~]/, "") || DEFAULT_VERSIONS.react,
      veryfront: deps?.veryfront?.replace(/[\^~]/, "") || DEFAULT_VERSIONS.veryfront,
    };
  } catch {
    return DEFAULT_VERSIONS;
  }
}

type CdnProvider = "esm.sh" | "unpkg" | "jsdelivr";

// Platform utilities served from local module server to match SSR behavior.
// This ensures hydration matches (same code on server and client).
// CRITICAL: veryfront/context must use local module to share React context with SSR.
// Using esm.sh creates a separate context instance causing usePageContext to return undefined.
const PLATFORM_UTILITY_PATHS = {
  head: "/_vf_modules/react/components/Head.js",
  router: "/_vf_modules/react/router/index.js",
  context: "/_vf_modules/react/context/index.js",
  fonts: "/_vf_modules/react/fonts/index.js",
} as const;

// Full platform utilities including react-prefixed aliases
const PLATFORM_UTILITIES: Record<string, string> = {
  "veryfront/head": PLATFORM_UTILITY_PATHS.head,
  "veryfront/router": PLATFORM_UTILITY_PATHS.router,
  "veryfront/context": PLATFORM_UTILITY_PATHS.context,
  "veryfront/fonts": PLATFORM_UTILITY_PATHS.fonts,
  // React-prefixed aliases (veryfront/react/*) - same modules, alternative import paths
  "veryfront/react/head": PLATFORM_UTILITY_PATHS.head,
  "veryfront/react/router": PLATFORM_UTILITY_PATHS.router,
  "veryfront/react/context": PLATFORM_UTILITY_PATHS.context,
  "veryfront/react/fonts": PLATFORM_UTILITY_PATHS.fonts,
};

// URL templates for each CDN provider
// Use ?target=es2022 on esm.sh to ensure identical builds between SSR (Deno) and browser.
// Without this, esm.sh auto-detects target and may serve different builds.
interface CdnUrlTemplates {
  react: (version: string) => string;
  reactDom: (version: string) => string;
  reactDomClient: (version: string) => string;
  jsxRuntime: (version: string) => string;
  jsxDevRuntime: (version: string) => string;
  veryfrontAgentReact: (version: string) => string;
  veryfrontComponentsAi: (version: string) => string;
  veryfrontPrimitives: (version: string) => string;
}

const CDN_URL_TEMPLATES: Record<CdnProvider, CdnUrlTemplates> = {
  "esm.sh": {
    react: (v) => `https://esm.sh/react@${v}?target=es2022`,
    reactDom: (v) => `https://esm.sh/react-dom@${v}?external=react&target=es2022`,
    reactDomClient: (v) => `https://esm.sh/react-dom@${v}/client?external=react&target=es2022`,
    jsxRuntime: (v) => `https://esm.sh/react@${v}/jsx-runtime?external=react&target=es2022`,
    jsxDevRuntime: (v) => `https://esm.sh/react@${v}/jsx-dev-runtime?external=react&target=es2022`,
    veryfrontAgentReact: (v) =>
      `https://esm.sh/veryfront@${v}/agent/react?external=react,react-dom&target=es2022`,
    veryfrontComponentsAi: (v) =>
      `https://esm.sh/veryfront@${v}/components/ai?external=react,react-dom&target=es2022`,
    veryfrontPrimitives: (v) =>
      `https://esm.sh/veryfront@${v}/primitives?external=react,react-dom&target=es2022`,
  },
  unpkg: {
    react: (v) => `https://unpkg.com/react@${v}/umd/react.production.min.js`,
    reactDom: (v) => `https://unpkg.com/react-dom@${v}/umd/react-dom.production.min.js`,
    reactDomClient: (v) => `https://unpkg.com/react-dom@${v}/umd/react-dom.production.min.js`,
    jsxRuntime: (v) => `https://unpkg.com/react@${v}/jsx-runtime`,
    jsxDevRuntime: (v) => `https://unpkg.com/react@${v}/jsx-dev-runtime`,
    veryfrontAgentReact: (v) => `https://unpkg.com/veryfront@${v}/dist/agent/react.js`,
    veryfrontComponentsAi: (v) => `https://unpkg.com/veryfront@${v}/dist/components/ai.js`,
    veryfrontPrimitives: (v) => `https://unpkg.com/veryfront@${v}/dist/primitives.js`,
  },
  jsdelivr: {
    react: (v) => `https://cdn.jsdelivr.net/npm/react@${v}/umd/react.production.min.js`,
    reactDom: (v) => `https://cdn.jsdelivr.net/npm/react-dom@${v}/umd/react-dom.production.min.js`,
    reactDomClient: (v) =>
      `https://cdn.jsdelivr.net/npm/react-dom@${v}/umd/react-dom.production.min.js`,
    jsxRuntime: (v) => `https://cdn.jsdelivr.net/npm/react@${v}/jsx-runtime`,
    jsxDevRuntime: (v) => `https://cdn.jsdelivr.net/npm/react@${v}/jsx-dev-runtime`,
    veryfrontAgentReact: (v) => `https://cdn.jsdelivr.net/npm/veryfront@${v}/dist/agent/react.js`,
    veryfrontComponentsAi: (v) =>
      `https://cdn.jsdelivr.net/npm/veryfront@${v}/dist/components/ai.js`,
    veryfrontPrimitives: (v) => `https://cdn.jsdelivr.net/npm/veryfront@${v}/dist/primitives.js`,
  },
};

function buildCdnImportMapFromTemplates(
  versions: DetectedVersions,
  templates: CdnUrlTemplates,
  includePlatformUtilities: boolean,
): Record<string, string> {
  const { react, veryfront } = versions;
  return {
    "react": templates.react(react),
    "react-dom": templates.reactDom(react),
    "react-dom/client": templates.reactDomClient(react),
    "react/jsx-runtime": templates.jsxRuntime(react),
    "react/jsx-dev-runtime": templates.jsxDevRuntime(react),
    "veryfront/agent/react": templates.veryfrontAgentReact(veryfront),
    "veryfront/components/ai": templates.veryfrontComponentsAi(veryfront),
    "veryfront/primitives": templates.veryfrontPrimitives(veryfront),
    ...(includePlatformUtilities ? PLATFORM_UTILITIES : {}),
    ...getTailwindImportMap(),
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
    // React still from CDN (or can be bundled separately)
    "react": esmShTemplates.react(react),
    "react-dom": esmShTemplates.reactDom(react),
    "react-dom/client": esmShTemplates.reactDomClient(react),
    "react/jsx-runtime": esmShTemplates.jsxRuntime(react),
    "react/jsx-dev-runtime": esmShTemplates.jsxDevRuntime(react),
    // Veryfront modules served from local endpoint
    "veryfront/agent/react": "/_veryfront/lib/agent/react.js",
    "veryfront/components/ai": "/_veryfront/lib/components/ai.js",
    "veryfront/primitives": "/_veryfront/lib/primitives.js",
    // Platform utilities (subset without react-prefixed aliases)
    "veryfront/head": PLATFORM_UTILITY_PATHS.head,
    "veryfront/router": PLATFORM_UTILITY_PATHS.router,
    "veryfront/context": PLATFORM_UTILITY_PATHS.context,
    "veryfront/fonts": PLATFORM_UTILITY_PATHS.fonts,
    ...getTailwindImportMap(),
  };
}

const CDN_IMPORT_MAP_FACTORIES: Record<
  CdnProvider,
  (versions: DetectedVersions) => Record<string, string>
> = {
  unpkg: getUnpkgImportMap,
  jsdelivr: getJsdelivrImportMap,
  "esm.sh": getEsmShImportMap,
} as const;

function getCdnImportMap(
  versions: DetectedVersions,
  provider: CdnProvider = "esm.sh",
): Record<string, string> {
  const factory = CDN_IMPORT_MAP_FACTORIES[provider] ?? getEsmShImportMap;
  return factory(versions);
}

function getDefaultHTMLImportMap(): Record<string, string> {
  return getEsmShImportMap(DEFAULT_VERSIONS);
}

async function resolveVersions(
  projectDir: string,
  config?: VeryfrontConfig,
): Promise<DetectedVersions> {
  const versionsConfig = config?.client?.cdn?.versions;

  if (!versionsConfig || versionsConfig === "auto") {
    return detectVersions(projectDir);
  }

  // Explicit versions from config
  const detected = await detectVersions(projectDir);
  return {
    react: versionsConfig.react || detected.react,
    veryfront: versionsConfig.veryfront || detected.veryfront,
  };
}

export interface BuildImportMapOptions {
  projectDir?: string;
  config?: VeryfrontConfig;
  customImports?: Record<string, string>;
}

export async function buildImportMapJson(
  options?: BuildImportMapOptions | Record<string, string>,
): Promise<string> {
  // Legacy: if passed a plain record, use as import map directly
  if (
    options && !("projectDir" in options) && !("config" in options) && !("customImports" in options)
  ) {
    const imports = options as Record<string, string>;
    if (Object.keys(imports).length > 0) {
      return JSON.stringify({ imports }, null, 2);
    }
  }

  const opts = (options || {}) as BuildImportMapOptions;
  const { projectDir, config, customImports } = opts;

  // Determine mode
  const mode = config?.client?.moduleResolution ?? "cdn";

  // For bundled mode, we might not need veryfront imports in the map
  // as they'll be bundled into the client JS
  if (mode === "bundled") {
    const versions = projectDir ? await resolveVersions(projectDir, config) : DEFAULT_VERSIONS;

    // Only include React in import map for bundled mode
    // Use ?target=es2022 to match SSR build
    // Use ?external=react on react sub-packages to ensure single React instance
    const imports: Record<string, string> = {
      "react": `https://esm.sh/react@${versions.react}?target=es2022`,
      "react-dom": `https://esm.sh/react-dom@${versions.react}?external=react&target=es2022`,
      "react-dom/client":
        `https://esm.sh/react-dom@${versions.react}/client?external=react&target=es2022`,
      "react/jsx-runtime":
        `https://esm.sh/react@${versions.react}/jsx-runtime?external=react&target=es2022`,
      "react/jsx-dev-runtime":
        `https://esm.sh/react@${versions.react}/jsx-dev-runtime?external=react&target=es2022`,
      ...customImports,
    };

    return JSON.stringify({ imports }, null, 2);
  }

  // Resolve versions
  const versions = projectDir ? await resolveVersions(projectDir, config) : DEFAULT_VERSIONS;

  // Get base import map based on mode
  let imports: Record<string, string>;

  if (mode === "self-hosted") {
    imports = getSelfHostedImportMap(versions);
  } else {
    // CDN mode
    const provider = config?.client?.cdn?.provider ?? "esm.sh";
    imports = getCdnImportMap(versions, provider);
  }

  // Add @/ alias for project-relative imports (maps to module server)
  imports["@/"] = "/_vf_modules/";

  // Merge with custom imports
  if (customImports) {
    imports = { ...imports, ...customImports };
  }

  return JSON.stringify({ imports }, null, 2);
}

export function buildImportMapJsonSync(importMap?: Record<string, string>): string {
  const imports = importMap || getDefaultHTMLImportMap();
  return JSON.stringify({ imports }, null, 2);
}

export function shouldDisableLayout(frontmatter?: Record<string, unknown>): boolean {
  return frontmatter?.layout === false || frontmatter?.layout === "false";
}
