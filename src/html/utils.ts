import { escapeHTML } from "./html-escape.ts";
import type { VeryfrontConfig } from "../core/config/types.ts";

export function buildRootAttributes(
  slug: string,
  mode: string,
  noLayout: boolean,
): string {
  const attributes = [
    'id="root"',
    noLayout ? "" : 'class="vf-tailwind"',
    `data-veryfront-slug="${escapeHTML(slug || "")}"`,
    `data-veryfront-mode="${escapeHTML(mode || "production")}"`,
  ]
    .filter(Boolean)
    .join(" ");

  return attributes;
}

export function buildContentAttributes(
  slug: string,
  noLayout: boolean,
  ssrHash?: string,
): string {
  const attrs = [
    'id="veryfront-content"',
    `data-slug="${slug || ""}"`,
    `data-layout="${noLayout ? "none" : "default"}"`,
    ssrHash ? `data-ssr-hash="${escapeHTML(ssrHash)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return attrs;
}

interface DetectedVersions {
  react: string;
  veryfront: string;
}

const DEFAULT_VERSIONS: DetectedVersions = {
  react: "18.3.1",
  veryfront: "0.0.12",
};

/**
 * Detect package versions from project's package.json
 * Falls back to defaults if not found
 */
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

/**
 * Generate import map for esm.sh CDN
 */
function getEsmShImportMap(versions: DetectedVersions): Record<string, string> {
  const { react, veryfront } = versions;
  return {
    "react": `https://esm.sh/react@${react}`,
    "react-dom": `https://esm.sh/react-dom@${react}`,
    "react-dom/client": `https://esm.sh/react-dom@${react}/client`,
    "react/jsx-runtime": `https://esm.sh/react@${react}/jsx-runtime`,
    "react/jsx-dev-runtime": `https://esm.sh/react@${react}/jsx-dev-runtime`,
    "veryfront/ai/react": `https://esm.sh/veryfront@${veryfront}/ai/react?external=react`,
    "veryfront/ai/components": `https://esm.sh/veryfront@${veryfront}/ai/components?external=react`,
    "veryfront/ai/primitives": `https://esm.sh/veryfront@${veryfront}/ai/primitives?external=react`,
  };
}

/**
 * Generate import map for unpkg CDN
 */
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
  };
}

/**
 * Generate import map for jsdelivr CDN
 */
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
  };
}

/**
 * Generate import map for self-hosted mode
 * Modules served from /_veryfront/lib/* endpoint
 */
function getSelfHostedImportMap(versions: DetectedVersions): Record<string, string> {
  const { react } = versions;
  return {
    // React still from CDN (or can be bundled separately)
    "react": `https://esm.sh/react@${react}`,
    "react-dom": `https://esm.sh/react-dom@${react}`,
    "react-dom/client": `https://esm.sh/react-dom@${react}/client`,
    "react/jsx-runtime": `https://esm.sh/react@${react}/jsx-runtime`,
    "react/jsx-dev-runtime": `https://esm.sh/react@${react}/jsx-dev-runtime`,
    // Veryfront modules served from local endpoint
    "veryfront/ai/react": "/_veryfront/lib/ai/react.js",
    "veryfront/ai/components": "/_veryfront/lib/ai/components.js",
    "veryfront/ai/primitives": "/_veryfront/lib/ai/primitives.js",
  };
}

/**
 * Get CDN import map based on provider
 */
function getCdnImportMap(
  versions: DetectedVersions,
  provider: CdnProvider = "esm.sh",
): Record<string, string> {
  switch (provider) {
    case "unpkg":
      return getUnpkgImportMap(versions);
    case "jsdelivr":
      return getJsdelivrImportMap(versions);
    case "esm.sh":
    default:
      return getEsmShImportMap(versions);
  }
}

/**
 * Get default HTML import map (legacy function for backwards compatibility)
 */
function getDefaultHTMLImportMap(): Record<string, string> {
  return getEsmShImportMap(DEFAULT_VERSIONS);
}

/**
 * Resolve versions based on config
 * Returns auto-detected versions or explicit config versions
 */
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

/**
 * Build import map JSON string
 * Supports multiple modes: cdn, self-hosted, bundled
 */
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
    const imports: Record<string, string> = {
      "react": `https://esm.sh/react@${versions.react}`,
      "react-dom": `https://esm.sh/react-dom@${versions.react}`,
      "react-dom/client": `https://esm.sh/react-dom@${versions.react}/client`,
      "react/jsx-runtime": `https://esm.sh/react@${versions.react}/jsx-runtime`,
      "react/jsx-dev-runtime": `https://esm.sh/react@${versions.react}/jsx-dev-runtime`,
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

  // Merge with custom imports
  if (customImports) {
    imports = { ...imports, ...customImports };
  }

  return JSON.stringify({ imports }, null, 2);
}

/**
 * Synchronous version for backwards compatibility
 * Uses default versions without project detection
 */
export function buildImportMapJsonSync(importMap?: Record<string, string>): string {
  const imports = importMap || getDefaultHTMLImportMap();
  return JSON.stringify({ imports }, null, 2);
}

export function shouldDisableLayout(frontmatter?: Record<string, unknown>): boolean {
  return frontmatter?.layout === false || frontmatter?.layout === "false";
}
