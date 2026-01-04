import { parseImports, replaceSpecifiers } from "./lexer.ts";
import { DEFAULT_ALLOWED_CDN_HOSTS } from "@veryfront/utils/constants/cdn.ts";
import { rendererLogger as logger } from "@veryfront/utils";

export interface BlockExternalUrlResult {
  code: string;
  blockedUrls: string[];
}

/**
 * Pattern to match cross-project imports (with or without version).
 *
 * Supported formats:
 *   - projectSlug@version/@/path (versioned)
 *   - projectSlug/@/path (versionless, defaults to "latest")
 *
 * Examples:
 *   - demo@0.0.1/@/components/Button
 *   - shadcn-ui@1.2.3/@/lib/utils
 *   - demo/@/app.tsx (defaults to latest)
 *
 * The separator /@/ distinguishes cross-project imports from other patterns.
 */
const CROSS_PROJECT_VERSIONED_PATTERN = /^([a-z0-9-]+)@([\d^~x][\d.x^~-]*)\/@\/(.+)$/;
const CROSS_PROJECT_LATEST_PATTERN = /^([a-z0-9-]+)\/@\/(.+)$/;

/**
 * Check if a specifier is a cross-project import (versioned or versionless).
 */
export function isCrossProjectImport(specifier: string): boolean {
  return CROSS_PROJECT_VERSIONED_PATTERN.test(specifier) ||
         CROSS_PROJECT_LATEST_PATTERN.test(specifier);
}

/**
 * Parse a cross-project import specifier into its components.
 * Returns null if the specifier doesn't match the pattern.
 * Versionless imports default to "latest".
 */
export function parseCrossProjectImport(
  specifier: string,
): { projectSlug: string; version: string; path: string } | null {
  // Try versioned pattern first
  const versionedMatch = specifier.match(CROSS_PROJECT_VERSIONED_PATTERN);
  if (versionedMatch) {
    return {
      projectSlug: versionedMatch[1]!,
      version: versionedMatch[2]!,
      path: versionedMatch[3]!,
    };
  }

  // Try versionless pattern (defaults to "latest")
  const latestMatch = specifier.match(CROSS_PROJECT_LATEST_PATTERN);
  if (latestMatch) {
    return {
      projectSlug: latestMatch[1]!,
      version: "latest",
      path: latestMatch[2]!,
    };
  }

  return null;
}

export interface CrossProjectImportOptions {
  /** Base URL for the API (unused in browser mode, kept for interface compat) */
  apiBaseUrl?: string;
  /** Whether this is SSR mode */
  ssr?: boolean;
}

/**
 * Rewrite cross-project imports to module server URLs (browser mode only).
 *
 * For browser mode, transforms imports like:
 *   import { Button } from "demo@0.0.1/@/components/Button"  (versioned)
 *   import { Button } from "demo/@/components/Button"        (versionless → latest)
 *
 * To module server URL:
 *   /_vf_modules/_cross/demo@0.0.1/@/components/Button.tsx
 *   /_vf_modules/_cross/demo/@/components/Button.tsx
 *
 * For SSR mode, imports are left as-is. The SSRModuleLoader handles cross-project
 * imports by fetching from registry and writing to temp files with file:// URLs.
 */
export function resolveCrossProjectImports(
  code: string,
  options: CrossProjectImportOptions,
): Promise<string> {
  const { ssr = false } = options;

  // In SSR mode, leave cross-project imports as-is
  // SSRModuleLoader handles them by fetching from registry and writing to temp files
  if (ssr) {
    return Promise.resolve(code);
  }

  // Browser mode: rewrite to module server URL
  return Promise.resolve(
    replaceSpecifiers(code, (specifier) => {
      const parsed = parseCrossProjectImport(specifier);
      if (!parsed) return null;

      const { projectSlug, version, path } = parsed;

      // Keep the original extension - module server will handle it
      let modulePath = path;
      if (!/\.(js|mjs|jsx|ts|tsx|mdx)$/.test(modulePath)) {
        modulePath = `${modulePath}.tsx`;
      }

      // Build URL - omit version for "latest" (versionless imports)
      const projectRef = version === "latest" ? projectSlug : `${projectSlug}@${version}`;
      const moduleServerUrl = `/_vf_modules/_cross/${projectRef}/@/${modulePath}`;

      logger.debug("[CrossProjectImport] Rewriting", { from: specifier, to: moduleServerUrl });

      return moduleServerUrl;
    }),
  );
}

/**
 * Check if a URL is from an allowed CDN host (esm.sh, deno.land, etc.)
 * or is a cross-project registry URL (api.lvh.me, api.veryfront.com, registry.veryfront.com).
 * These URLs are supported by Deno's module loader and can be imported in SSR mode.
 */
function isAllowedCdnUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const origin = `${parsed.protocol}//${parsed.host}`;

    // Allow known CDN hosts (esm.sh, deno.land)
    if (DEFAULT_ALLOWED_CDN_HOSTS.some((allowed) => origin.startsWith(allowed))) {
      return true;
    }

    // Allow cross-project registry URLs from the Veryfront API
    // These URLs are used for importing components from other Veryfront projects
    const registryHosts = [
      "http://api.lvh.me:4000", // Local dev
      "https://api.veryfront.com", // Production
      "https://registry.veryfront.com", // Registry subdomain
    ];
    if (registryHosts.some((host) => origin.startsWith(host))) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Block external URL imports (https://, http://) in SSR mode,
 * EXCEPT for known CDN hosts like esm.sh and deno.land which Deno can load natively.
 *
 * Unknown external URLs can't be loaded when the transformed module is imported via file:// protocol.
 * Instead of crashing, we replace them with a stub that throws a clear error at runtime.
 */
export async function blockExternalUrlImports(
  code: string,
  filePath: string,
): Promise<BlockExternalUrlResult> {
  const blockedUrls: string[] = [];

  // First, collect all external URL imports (excluding allowed CDN hosts)
  const imports = await parseImports(code);
  for (const imp of imports) {
    if (imp.n && (imp.n.startsWith("https://") || imp.n.startsWith("http://"))) {
      // Allow known CDN hosts - Deno can load these directly
      if (!isAllowedCdnUrl(imp.n)) {
        blockedUrls.push(imp.n);
      }
    }
  }

  if (blockedUrls.length === 0) {
    return { code, blockedUrls };
  }

  // Replace external URL imports with a stub module that provides a helpful error
  // Only block URLs that are NOT from allowed CDN hosts
  const transformedCode = await replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("https://") || specifier.startsWith("http://")) {
      // Allow known CDN hosts - Deno can load these directly
      if (isAllowedCdnUrl(specifier)) {
        return null; // Keep the import as-is
      }

      // Create a data: URL module that exports a proxy throwing helpful errors
      const errorMessage = `External URL imports are not supported in SSR mode. ` +
        `The import "${specifier}" in "${filePath}" cannot be loaded server-side. ` +
        `Consider using a local module or dynamic import with typeof window check.`;

      // Return a data URL with a module that throws when accessed
      const stubModule = `
        const handler = {
          get(_, prop) {
            if (prop === 'default' || prop === '__esModule') {
              return new Proxy({}, handler);
            }
            throw new Error(${JSON.stringify(errorMessage)});
          },
          apply() {
            throw new Error(${JSON.stringify(errorMessage)});
          }
        };
        export default new Proxy(function(){}, handler);
        export const __blocked_url__ = ${JSON.stringify(specifier)};
      `;
      return `data:text/javascript;base64,${btoa(stubModule)}`;
    }
    return null;
  });

  return { code: transformedCode, blockedUrls };
}

/**
 * Rewrite @veryfront/* imports to veryfront/* for npm compatibility
 * This allows Deno-style imports to work in Node.js environments
 */
export function resolveVeryfrontImports(code: string): Promise<string> {
  return Promise.resolve(replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("@veryfront/")) {
      // @veryfront/ai -> veryfront/ai
      // @veryfront/ai/react -> veryfront/ai/react
      return specifier.replace("@veryfront/", "veryfront/");
    }
    if (specifier === "@veryfront") {
      return "veryfront";
    }
    return null;
  }));
}

export function resolvePathAliases(
  code: string,
  filePath: string,
  projectDir: string,
  ssr = false,
): Promise<string> {
  const _normalizedProjectDir = projectDir.replace(/\\/g, "/").replace(/\/$/, "");

  // For both SSR and browser, we need to resolve @/ aliases to relative paths
  // SSR files are written to a temp directory with the same relative structure as the source
  // So @/components from pages/index.tsx becomes ../components (relative path)
  let relativeFilePath = filePath;
  if (filePath.startsWith(_normalizedProjectDir)) {
    relativeFilePath = filePath.substring(_normalizedProjectDir.length + 1);
  } else if (filePath.startsWith("/")) {
    const pathParts = filePath.split("/");
    const projectParts = _normalizedProjectDir.split("/");
    const lastProjectPart = projectParts[projectParts.length - 1];
    const projectIndex = pathParts.indexOf(lastProjectPart!);
    if (projectIndex >= 0) {
      relativeFilePath = pathParts.slice(projectIndex + 1).join("/");
    }
  }

  const fileDir = relativeFilePath.substring(0, relativeFilePath.lastIndexOf("/"));
  const depth = fileDir.split("/").filter(Boolean).length;
  const relativeToRoot = depth === 0 ? "." : "../".repeat(depth).slice(0, -1);

  return Promise.resolve(replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("@/")) {
      const path = specifier.substring(2);
      // @/ maps to project root in veryfront projects
      const relativePath = depth === 0 ? `./${path}` : `${relativeToRoot}/${path}`;
      // Add .js extension if path doesn't already have a valid JS/TS extension
      // This ensures Deno can properly identify the module type when loading via HTTP
      if (!/\.(tsx?|jsx?|mjs|cjs|mdx)$/.test(relativePath)) {
        return relativePath + ".js";
      }
      // For SSR, also normalize TS/TSX extensions to .js
      if (ssr) {
        return relativePath.replace(/\.(tsx?|jsx|mdx)$/, ".js");
      }
      return relativePath;
    }
    return null;
  }));
}

export function resolveRelativeImports(
  code: string,
  filePath: string,
  projectDir: string,
  moduleServerUrl?: string,
): Promise<string> {
  const _normalizedProjectDir = projectDir.replace(/\\/g, "/").replace(/\/$/, "");

  let relativeFilePath = filePath;
  if (filePath.startsWith(_normalizedProjectDir)) {
    relativeFilePath = filePath.substring(_normalizedProjectDir.length + 1);
  } else if (filePath.startsWith("/")) {
    const pathParts = filePath.split("/");
    const projectParts = _normalizedProjectDir.split("/");
    const lastProjectPart = projectParts[projectParts.length - 1];
    const projectIndex = pathParts.indexOf(lastProjectPart!);
    if (projectIndex >= 0) {
      relativeFilePath = pathParts.slice(projectIndex + 1).join("/");
    }
  }

  const fileDir = relativeFilePath.substring(0, relativeFilePath.lastIndexOf("/"));

  return Promise.resolve(replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      // Rewrite TypeScript extensions to .js for browser compatibility
      let rewrittenSpecifier = specifier;
      if (/\.(tsx?|jsx)$/.test(specifier)) {
        rewrittenSpecifier = specifier.replace(/\.(tsx?|jsx)$/, ".js");
      }

      // If moduleServerUrl provided, convert to absolute URL
      if (moduleServerUrl) {
        const resolvedPath = resolveRelativePath(fileDir, rewrittenSpecifier);
        return `${moduleServerUrl}/${resolvedPath}`;
      }

      return rewrittenSpecifier;
    }
    return null;
  }));
}

function resolveRelativePath(currentDir: string, importPath: string): string {
  const currentParts = currentDir.split("/").filter(Boolean);
  const importParts = importPath.split("/").filter(Boolean);

  const resolvedParts = [...currentParts];
  for (const part of importParts) {
    if (part === "..") {
      resolvedParts.pop(); // Go up one directory
    } else if (part !== ".") {
      resolvedParts.push(part); // Add to path
    }
  }

  return resolvedParts.join("/");
}

export async function resolveRelativeImportsToAbsolute(
  code: string,
  filePath: string,
  _projectDir: string,
): Promise<string> {
  const normalizedFilePath = filePath.replace(/\\/g, "/");
  const fileDir = normalizedFilePath.substring(0, normalizedFilePath.lastIndexOf("/"));

  // Build a map of specifiers to resolved paths with extensions
  const resolvedImports = new Map<string, string>();
  const specifiersToResolve: string[] = [];

  // First pass: collect all relative import specifiers
  await replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      specifiersToResolve.push(specifier);
    }
    return null;
  });

  // Resolve each specifier to an absolute path with extension
  for (const specifier of specifiersToResolve) {
    const absolutePath = resolveAbsolutePath(fileDir, specifier);
    const resolvedPath = await findFileWithExtension(absolutePath);
    resolvedImports.set(specifier, `file://${resolvedPath}`);
  }

  // Second pass: replace specifiers with resolved paths
  return replaceSpecifiers(code, (specifier) => {
    return resolvedImports.get(specifier) || null;
  });
}

/**
 * Find a file by trying common TypeScript/JavaScript extensions
 * If the path already has an extension, return it as-is
 */
async function findFileWithExtension(basePath: string): Promise<string> {
  // If already has a valid extension, return as-is
  if (/\.(tsx?|jsx?|mjs|cjs|mdx)$/.test(basePath)) {
    return basePath;
  }

  const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx"];

  for (const ext of extensions) {
    const fullPath = basePath + ext;
    try {
      const stat = await Deno.stat(fullPath);
      if (stat.isFile) {
        return fullPath;
      }
    } catch {
      // File doesn't exist with this extension, try next
    }
  }

  // If no file found, return with .ts extension as fallback
  // (Deno will give a clearer error message)
  return basePath + ".ts";
}

export function resolveRelativeImportsForNodeSSR(code: string): Promise<string> {
  return Promise.resolve(replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      return specifier.replace(/\.(tsx|ts|jsx)$/, ".js");
    }
    return null;
  }));
}

export function resolveRelativeImportsForSSR(code: string): Promise<string> {
  return Promise.resolve(replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      if (/\.(js|mjs|cjs)$/.test(specifier)) {
        return null;
      }
      const withoutExt = specifier.replace(/\.(tsx?|jsx|mdx)$/, "");
      return withoutExt + ".js";
    }
    return null;
  }));
}

function resolveAbsolutePath(baseDir: string, relativePath: string): string {
  const baseParts = baseDir.split("/").filter(Boolean);
  const relativeParts = relativePath.split("/").filter(Boolean);

  const resolvedParts = [...baseParts];
  for (const part of relativeParts) {
    if (part === "..") {
      resolvedParts.pop();
    } else if (part !== ".") {
      resolvedParts.push(part);
    }
  }

  return "/" + resolvedParts.join("/");
}
