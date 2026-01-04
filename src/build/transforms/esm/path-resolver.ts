import { parseImports, replaceSpecifiers } from "./lexer.ts";
import { DEFAULT_ALLOWED_CDN_HOSTS } from "@veryfront/utils/constants/cdn.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.220.0/fs/mod.ts";

// Directory for SSR stub modules - will be created on first use
const SSR_STUBS_DIR = join(
  Deno.env.get("HOME") || "/tmp",
  ".cache",
  "veryfront-ssr-stubs"
);

// Cache of created stub files to avoid re-creating them
// Key format: "url::export1,export2,export3" to ensure we regenerate if different exports are needed
const stubFileCache = new Map<string, string>();

/**
 * Extract named imports from an import statement
 * e.g., "import { clsx, cn } from '...'" -> ["clsx", "cn"]
 * e.g., "import { motion as m } from '...'" -> ["motion"]
 * e.g., "import Default from '...'" -> [] (default imports don't need named exports)
 * e.g., "import * as pkg from '...'" -> [] (namespace imports use default)
 */
function extractNamedImports(statement: string): string[] {
  const namedImports: string[] = [];

  // Match destructured imports: { a, b as c, d }
  const braceMatch = statement.match(/\{([^}]+)\}/);
  if (braceMatch) {
    const inside = braceMatch[1]!;
    // Split by comma and extract the import name (not the alias)
    const parts = inside.split(",");
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      // Handle "name as alias" - we need the original name
      const asMatch = trimmed.match(/^(\w+)\s+as\s+\w+$/);
      if (asMatch) {
        namedImports.push(asMatch[1]!);
      } else {
        // Simple import name
        namedImports.push(trimmed);
      }
    }
  }

  return namedImports;
}

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
function _isAllowedCdnUrl(url: string): boolean {
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
 * Create a hash from a URL to use as filename
 */
async function hashUrl(url: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(url);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Get or create an SSR stub file for a given URL.
 * Pre-imports the stub to warm Deno's module cache.
 *
 * @param specifier - The original URL being stubbed
 * @param namedExports - Array of named exports to include in the stub
 */
async function getOrCreateStubFile(specifier: string, namedExports: string[] = []): Promise<string> {
  // Cache key includes exports to regenerate if different exports are needed
  const sortedExports = [...namedExports].sort();
  const cacheKey = `${specifier}::${sortedExports.join(",")}`;

  // Check cache first
  const cached = stubFileCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Generate named export declarations
  // For each named export, we create a no-op that's appropriate for common patterns
  const namedExportDeclarations = namedExports.map((name) => {
    // Common component names get noopComponent
    if (/^[A-Z]/.test(name) || name.endsWith("Provider") || name.endsWith("Consumer")) {
      return `export const ${name} = noopComponent;`;
    }
    // Hook-like names get a function returning empty object
    if (name.startsWith("use")) {
      return `export const ${name} = () => ({});`;
    }
    // Functions like clsx, cn, twMerge - class name merging utilities
    if (["clsx", "cn", "twMerge", "twJoin", "cx", "classNames", "classnames"].includes(name)) {
      return `export const ${name} = (...args) => args.filter(Boolean).join(" ");`;
    }
    // cva is special - returns a function that takes variant options and returns a class string
    if (name === "cva") {
      return `export const ${name} = (base, _config) => (_props) => base || "";`;
    }
    // motion is special - it's a Proxy-based API
    if (name === "motion" || name === "m") {
      return `export const ${name} = motionProxy;`;
    }
    if (name === "AnimatePresence") {
      return `export const ${name} = noopComponent;`;
    }
    // Default: return a no-op function
    return `export const ${name} = noop;`;
  }).join("\n");

  // Create the stub module content
  const stubModule = `// SSR stub for ${specifier}
// Named exports: ${namedExports.join(", ") || "(none)"}
const noop = () => {};
const noopComponent = (props) => props?.children || null;

// Proxy for motion-like APIs (motion.div, motion.span, etc.)
const motionProxy = new Proxy(noopComponent, {
  get(_, prop) {
    if (prop === 'default' || prop === '__esModule') return motionProxy;
    // motion.div, motion.span, etc. should return a component
    return noopComponent;
  }
});

const noopProxy = new Proxy(function(){}, {
  get(_, prop) {
    if (prop === 'default' || prop === '__esModule') return noopProxy;
    if (prop === 'Provider' || prop === 'Consumer') return noopComponent;
    if (typeof prop === 'string' && prop.startsWith('use')) return () => ({});
    return noop;
  },
  apply() { return null; }
});

// Named exports
${namedExportDeclarations}

// Default export and metadata
export default noopProxy;
export const __ssr_stub__ = true;
export const __original_url__ = ${JSON.stringify(specifier)};
`;

  // Create hash-based filename (include exports in hash for uniqueness)
  const hash = await hashUrl(cacheKey);
  const stubPath = join(SSR_STUBS_DIR, `stub-${hash}.js`);

  // Ensure directory exists and write file
  await ensureDir(SSR_STUBS_DIR);
  await Deno.writeTextFile(stubPath, stubModule);

  // Pre-import the stub to warm Deno's module cache
  // This ensures the module is "prepared" for subsequent dynamic imports
  try {
    await import(`file://${stubPath}`);
  } catch {
    // Ignore errors - the stub should be valid, but we don't want to fail if it isn't
  }

  // Cache and return
  stubFileCache.set(cacheKey, stubPath);
  return stubPath;
}

/**
 * Block ALL external URL imports (https://, http://) in SSR mode.
 *
 * Even though Deno can load https:// URLs natively, when transformed code is written
 * to a temp file and imported via file:// protocol, the dynamic import mechanism
 * can't resolve https:// imports from within that file.
 *
 * Instead of crashing with "ERR_UNSUPPORTED_ESM_URL_SCHEME", we replace external URLs
 * with file:// URLs pointing to stub modules that provide no-op implementations.
 * This allows the page to render server-side, and the real client-side implementation
 * will take over after hydration.
 */
export async function blockExternalUrlImports(
  code: string,
  _filePath: string,
): Promise<BlockExternalUrlResult> {
  const blockedUrls: string[] = [];

  // Collect ALL external URL imports with their named exports
  // We need the full import statement to extract named imports
  const imports = await parseImports(code);
  const urlToNamedExports = new Map<string, string[]>();

  for (const imp of imports) {
    if (imp.n && (imp.n.startsWith("https://") || imp.n.startsWith("http://"))) {
      blockedUrls.push(imp.n);

      // Extract the full import statement to parse named imports
      const statement = code.substring(imp.ss, imp.se);
      const namedExports = extractNamedImports(statement);

      // Merge with existing exports for this URL (same URL may be imported multiple times)
      const existing = urlToNamedExports.get(imp.n) || [];
      urlToNamedExports.set(imp.n, [...new Set([...existing, ...namedExports])]);
    }
  }

  if (blockedUrls.length === 0) {
    return { code, blockedUrls };
  }

  // Create stub files for all external URLs with their named exports
  const stubPaths = new Map<string, string>();
  for (const [url, namedExports] of urlToNamedExports) {
    const stubPath = await getOrCreateStubFile(url, namedExports);
    stubPaths.set(url, stubPath);
  }

  // Replace external URL imports with file:// URLs to stub modules
  const transformedCode = await replaceSpecifiers(code, (specifier) => {
    if (specifier.startsWith("https://") || specifier.startsWith("http://")) {
      const stubPath = stubPaths.get(specifier);
      if (stubPath) {
        return `file://${stubPath}`;
      }
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
