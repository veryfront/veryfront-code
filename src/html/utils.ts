import { escapeHTML } from "./html-escape.ts";
import type { VeryfrontConfig } from "../core/config/types.ts";
import { REACT_DEFAULT_VERSION, VERYFRONT_VERSION } from "../core/utils/constants/cdn.ts";
import {
  getContextPackageImportMap,
  getTailwindImportMap,
} from "../build/transforms/esm/package-registry.ts";

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

function getEsmShImportMap(versions: DetectedVersions): Record<string, string> {
  const { react, veryfront } = versions;
  // Use ?target=es2022 to ensure identical builds between SSR (Deno) and browser
  // Without this, esm.sh auto-detects target and may serve different builds
  return {
    "react": `https://esm.sh/react@${react}?target=es2022`,
    "react-dom": `https://esm.sh/react-dom@${react}?target=es2022`,
    "react-dom/client": `https://esm.sh/react-dom@${react}/client?target=es2022`,
    "react/jsx-runtime": `https://esm.sh/react@${react}/jsx-runtime?target=es2022`,
    "react/jsx-dev-runtime": `https://esm.sh/react@${react}/jsx-dev-runtime?target=es2022`,
    "veryfront/ai/react":
      `https://esm.sh/veryfront@${veryfront}/ai/react?external=react&target=es2022`,
    "veryfront/ai/components":
      `https://esm.sh/veryfront@${veryfront}/ai/components?external=react&target=es2022`,
    "veryfront/ai/primitives":
      `https://esm.sh/veryfront@${veryfront}/ai/primitives?external=react&target=es2022`,
    // Platform utilities - serve from local module server to match SSR behavior
    // This ensures hydration matches (same code on server and client)
    "veryfront/head": "/_vf_modules/exports/head.js",
    "veryfront/router": "/_vf_modules/exports/router.js",
    "veryfront/context":
      `https://esm.sh/veryfront@${veryfront}/context?external=react&target=es2022`,
    "veryfront/fonts": `https://esm.sh/veryfront@${veryfront}/fonts?external=react&target=es2022`,
    // Context packages - MUST match SSR import map (from package-registry.ts)
    ...getContextPackageImportMap(),
    // Tailwind CSS - unified version to prevent conflicts
    ...getTailwindImportMap(),
  };
}

function getUnpkgImportMap(versions: DetectedVersions): Record<string, string> {
  const { react, veryfront } = versions;
  return {
    "react": `https://unpkg.com/react@${react}/umd/react.production.min.js`,
    "react-dom": `https://unpkg.com/react-dom@${react}/umd/react-dom.production.min.js`,
    "react-dom/client": `https://unpkg.com/react-dom@${react}/umd/react-dom.production.min.js`,
    "react/jsx-runtime": `https://unpkg.com/react@${react}/jsx-runtime`,
    "react/jsx-dev-runtime": `https://unpkg.com/react@${react}/jsx-dev-runtime`,
    "veryfront/ai/react": `https://unpkg.com/veryfront@${veryfront}/dist/ai/react.js`,
    "veryfront/ai/components": `https://unpkg.com/veryfront@${veryfront}/dist/ai/components.js`,
    "veryfront/ai/primitives": `https://unpkg.com/veryfront@${veryfront}/dist/ai/primitives.js`,
    // Tailwind CSS - unified version (use esm.sh for ESM compatibility)
    ...getTailwindImportMap(),
  };
}

function getJsdelivrImportMap(versions: DetectedVersions): Record<string, string> {
  const { react, veryfront } = versions;
  return {
    "react": `https://cdn.jsdelivr.net/npm/react@${react}/umd/react.production.min.js`,
    "react-dom": `https://cdn.jsdelivr.net/npm/react-dom@${react}/umd/react-dom.production.min.js`,
    "react-dom/client":
      `https://cdn.jsdelivr.net/npm/react-dom@${react}/umd/react-dom.production.min.js`,
    "react/jsx-runtime": `https://cdn.jsdelivr.net/npm/react@${react}/jsx-runtime`,
    "react/jsx-dev-runtime": `https://cdn.jsdelivr.net/npm/react@${react}/jsx-dev-runtime`,
    "veryfront/ai/react": `https://cdn.jsdelivr.net/npm/veryfront@${veryfront}/dist/ai/react.js`,
    "veryfront/ai/components":
      `https://cdn.jsdelivr.net/npm/veryfront@${veryfront}/dist/ai/components.js`,
    "veryfront/ai/primitives":
      `https://cdn.jsdelivr.net/npm/veryfront@${veryfront}/dist/ai/primitives.js`,
    // Tailwind CSS - unified version (use esm.sh for ESM compatibility)
    ...getTailwindImportMap(),
  };
}

function getSelfHostedImportMap(versions: DetectedVersions): Record<string, string> {
  const { react } = versions;
  return {
    // React still from CDN (or can be bundled separately)
    // Use ?target=es2022 to match SSR build
    "react": `https://esm.sh/react@${react}?target=es2022`,
    "react-dom": `https://esm.sh/react-dom@${react}?target=es2022`,
    "react-dom/client": `https://esm.sh/react-dom@${react}/client?target=es2022`,
    "react/jsx-runtime": `https://esm.sh/react@${react}/jsx-runtime?target=es2022`,
    "react/jsx-dev-runtime": `https://esm.sh/react@${react}/jsx-dev-runtime?target=es2022`,
    // Veryfront modules served from local endpoint
    "veryfront/ai/react": "/_veryfront/lib/ai/react.js",
    "veryfront/ai/components": "/_veryfront/lib/ai/components.js",
    "veryfront/ai/primitives": "/_veryfront/lib/ai/primitives.js",
    // Platform utilities
    "veryfront/head": "/_veryfront/lib/head.js",
    "veryfront/router": "/_veryfront/lib/router.js",
    "veryfront/context": "/_veryfront/lib/context.js",
    "veryfront/fonts": "/_veryfront/lib/fonts.js",
    // Context packages - MUST match SSR import map
    ...getContextPackageImportMap(),
    // Tailwind CSS - unified version
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
    const imports: Record<string, string> = {
      "react": `https://esm.sh/react@${versions.react}?target=es2022`,
      "react-dom": `https://esm.sh/react-dom@${versions.react}?target=es2022`,
      "react-dom/client": `https://esm.sh/react-dom@${versions.react}/client?target=es2022`,
      "react/jsx-runtime": `https://esm.sh/react@${versions.react}/jsx-runtime?target=es2022`,
      "react/jsx-dev-runtime":
        `https://esm.sh/react@${versions.react}/jsx-dev-runtime?target=es2022`,
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
