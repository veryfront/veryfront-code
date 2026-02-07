import { escapeHTML } from "./html-escape.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { REACT_DEFAULT_VERSION, VERYFRONT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { esmShReact } from "#veryfront/transforms/esm/package-registry.ts";
import { isDenoCompiled } from "#veryfront/platform/compat/runtime.ts";

function joinAttributes(attrs: Array<string | false | undefined | null | "">): string {
  return attrs.filter(Boolean).join(" ");
}

export function buildRootAttributes(slug: string, mode: string, noLayout: boolean): string {
  return joinAttributes([
    'id="root"',
    !noLayout && 'class="vf-tailwind"',
    `data-veryfront-slug="${escapeHTML(slug || "")}"`,
    `data-veryfront-mode="${escapeHTML(mode || "production")}"`,
  ]);
}

export function buildContentAttributes(slug: string, noLayout: boolean, ssrHash?: string): string {
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
    const content = await fs.readTextFile(`${projectDir}/package.json`);
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    return {
      react: deps.react?.replace(/[\^~]/, "") ?? DEFAULT_VERSIONS.react,
      veryfront: deps.veryfront?.replace(/[\^~]/, "") ?? DEFAULT_VERSIONS.veryfront,
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
  head: "/_vf_modules/_veryfront/react/components/Head.js",
  router: "/_vf_modules/_veryfront/react/router/index.js",
  context: "/_vf_modules/_veryfront/react/context/index.js",
  fonts: "/_vf_modules/_veryfront/react/fonts/index.js",
  // Client-side AI/chat modules - use local module server in dev for faster iteration
  // NOTE: These are NOT available in compiled binaries, so we use CDN URLs there instead
  chat: "/_vf_modules/_veryfront/chat/index.js",
  markdown: "/_vf_modules/_veryfront/markdown/index.js",
  mdx: "/_vf_modules/_veryfront/mdx/index.js",
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

// AI/chat modules - only use local paths when running from source (not compiled binary)
// In compiled binaries, these files aren't embedded, so we fall back to CDN URLs
const AI_MODULE_UTILITIES: Record<string, string> = isDenoCompiled
  ? {} // Use CDN URLs (set in buildCdnImportMapFromTemplates)
  : {
    "veryfront/chat": PLATFORM_UTILITY_PATHS.chat,
    "veryfront/markdown": PLATFORM_UTILITY_PATHS.markdown,
    "veryfront/mdx": PLATFORM_UTILITY_PATHS.mdx,
  };

const PLATFORM_UTILITIES: Record<string, string> = {
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
  },
  unpkg: {
    react: (v) => `https://unpkg.com/react@${v}/umd/react.production.min.js`,
    reactDom: (v) => `https://unpkg.com/react-dom@${v}/umd/react-dom.production.min.js`,
    reactDomClient: (v) => `https://unpkg.com/react-dom@${v}/umd/react-dom.production.min.js`,
    jsxRuntime: (v) => `https://unpkg.com/react@${v}/jsx-runtime`,
    jsxDevRuntime: (v) => `https://unpkg.com/react@${v}/jsx-dev-runtime`,
    veryfrontChat: (v) => `https://unpkg.com/veryfront@${v}/dist/chat.js`,
    veryfrontMarkdown: (v) => `https://unpkg.com/veryfront@${v}/dist/markdown.js`,
    veryfrontMdx: (v) => `https://unpkg.com/veryfront@${v}/dist/mdx.js`,
  },
  jsdelivr: {
    react: (v) => `https://cdn.jsdelivr.net/npm/react@${v}/umd/react.production.min.js`,
    reactDom: (v) => `https://cdn.jsdelivr.net/npm/react-dom@${v}/umd/react-dom.production.min.js`,
    reactDomClient: (v) =>
      `https://cdn.jsdelivr.net/npm/react-dom@${v}/umd/react-dom.production.min.js`,
    jsxRuntime: (v) => `https://cdn.jsdelivr.net/npm/react@${v}/jsx-runtime`,
    jsxDevRuntime: (v) => `https://cdn.jsdelivr.net/npm/react@${v}/jsx-dev-runtime`,
    veryfrontChat: (v) => `https://cdn.jsdelivr.net/npm/veryfront@${v}/dist/chat.js`,
    veryfrontMarkdown: (v) => `https://cdn.jsdelivr.net/npm/veryfront@${v}/dist/markdown.js`,
    veryfrontMdx: (v) => `https://cdn.jsdelivr.net/npm/veryfront@${v}/dist/mdx.js`,
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

function isImportMapOnlyOptions(
  options: BuildImportMapOptions | Record<string, string>,
): options is Record<string, string> {
  return !("projectDir" in options) && !("config" in options) && !("customImports" in options);
}

export async function buildImportMapJson(
  options?: BuildImportMapOptions | Record<string, string>,
): Promise<string> {
  if (options && isImportMapOnlyOptions(options)) {
    const imports = options;
    if (Object.keys(imports).length > 0) {
      return JSON.stringify({ imports }, null, 2);
    }
  }

  const { projectDir, config, customImports } = (options ?? {}) as BuildImportMapOptions;
  const mode = config?.client?.moduleResolution ?? "cdn";
  const versions = projectDir ? await resolveVersions(projectDir, config) : DEFAULT_VERSIONS;

  if (mode === "bundled") {
    const reactTemplates = CDN_URL_TEMPLATES["esm.sh"];
    const imports: Record<string, string> = {
      react: reactTemplates.react(versions.react),
      "react-dom": reactTemplates.reactDom(versions.react),
      "react-dom/client": reactTemplates.reactDomClient(versions.react),
      "react/jsx-runtime": reactTemplates.jsxRuntime(versions.react),
      "react/jsx-dev-runtime": reactTemplates.jsxDevRuntime(versions.react),
      ...customImports,
    };

    return JSON.stringify({ imports }, null, 2);
  }

  let imports: Record<string, string>;
  if (mode === "self-hosted") {
    imports = getSelfHostedImportMap(versions);
  } else {
    imports = getCdnImportMap(versions, config?.client?.cdn?.provider ?? "esm.sh");
  }

  imports["@/"] = "/_vf_modules/";

  if (customImports) {
    imports = { ...imports, ...customImports };
  }

  return JSON.stringify({ imports }, null, 2);
}

export function buildImportMapJsonSync(importMap?: Record<string, string>): string {
  const imports = importMap ?? getDefaultHTMLImportMap();
  return JSON.stringify({ imports }, null, 2);
}

export function shouldDisableLayout(frontmatter?: Record<string, unknown>): boolean {
  return frontmatter?.layout === false || frontmatter?.layout === "false";
}
