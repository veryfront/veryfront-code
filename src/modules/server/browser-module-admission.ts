import type { VeryfrontConfig } from "#veryfront/config";
import { isAbsolute, relative } from "#veryfront/compat/path/index.ts";
import {
  createProjectDiscoveryConfig,
  DEFAULT_PROJECT_DISCOVERY_DIRS,
} from "#veryfront/discovery/project-discovery-config.ts";

const PROJECT_METADATA_FILE =
  /^(?:veryfront\.config\.(?:ts|js|mjs)|deno\.jsonc?|import_map\.json|package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|veryfront\.lock|tsconfig(?:\.[a-z0-9_-]+)?\.json|\.env(?:\..+)?)$/i;
const APP_ROUTE_MODULE = /(?:^|\/)route\.(?:tsx?|jsx?)$/i;
const ROOT_MIDDLEWARE_MODULE = /^middleware\.(?:ts|js|mjs)$/i;
const WINDOWS_ABSOLUTE_PATH = /^[a-z]:\//i;

export type BrowserModuleProtectionReason =
  | "invalid-path"
  | "invalid-configured-root"
  | "metadata"
  | "hidden-path"
  | "middleware"
  | "discovery"
  | "server-route";

export interface BrowserModuleSourcePolicy {
  canonicalPath: string | null;
  protectionReason: BrowserModuleProtectionReason | null;
  requiresClientBoundary: boolean;
}

export interface BrowserModuleSourcePolicyOptions {
  config?: VeryfrontConfig;
  rscEnabled?: boolean;
  /**
   * A real on-disk project served by `veryfront dev`. Client boundaries are a
   * hosted-transport concern: the browser hydrates a local project by importing
   * the whole page module (as the non-RSC path does), so local dev must not
   * require an RSC `use client` directive to serve an app-router page (#3662).
   */
  isLocalProject?: boolean;
}

/**
 * Classify an adapter-resolved absolute source path with the same canonical
 * browser policy used for logical module requests. Containment is established
 * before the relative path reaches the policy grammar, so aliases and resolved
 * dependencies cannot bypass protected project roots.
 */
export function classifyBrowserModuleAbsoluteSourcePath(
  sourcePath: string,
  projectDir: string,
  options: BrowserModuleSourcePolicyOptions = {},
): BrowserModuleSourcePolicy {
  const relativePath = relative(projectDir, sourcePath).replaceAll("\\", "/");
  if (
    relativePath.length === 0 ||
    relativePath === "." ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    isAbsolute(relativePath)
  ) {
    return {
      canonicalPath: null,
      protectionReason: "invalid-path",
      requiresClientBoundary: false,
    };
  }
  return classifyBrowserModuleSourcePath(relativePath, options);
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function normalizeRelativePath(value: string, allowLeadingSlash: boolean): string | null {
  if (containsControlCharacter(value)) return null;

  const separated = value.replaceAll("\\", "/");
  if (
    (!allowLeadingSlash && separated.startsWith("/")) ||
    WINDOWS_ABSOLUTE_PATH.test(separated)
  ) {
    return null;
  }

  const parts: string[] = [];
  for (const part of separated.replace(/^\/+/, "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function configuredRoot(value: unknown, fallback: string): string | null {
  if (value === undefined) return fallback;
  if (typeof value !== "string") return null;
  return normalizeRelativePath(value, false);
}

function relativeToRoot(path: string, root: string): string | null {
  if (root === "") return path;
  if (path === root) return "";
  const prefix = `${root}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

function belowRoot(root: string, child: string): string {
  return root ? `${root}/${child}` : child;
}

function isAtOrBelow(path: string, root: string): boolean {
  return relativeToRoot(path, root) !== null;
}

function discoveryRoots(config: VeryfrontConfig | undefined): string[] | null {
  const resolved = createProjectDiscoveryConfig({ projectDir: "", config });
  const roots = [
    ...Object.values(DEFAULT_PROJECT_DISCOVERY_DIRS).flat(),
    ...resolved.toolDirs,
    ...resolved.agentDirs,
    ...resolved.skillDirs,
    ...resolved.resourceDirs,
    ...resolved.promptDirs,
    ...resolved.workflowDirs,
    ...resolved.taskDirs,
    ...resolved.scheduleDirs,
    ...resolved.webhookDirs,
    ...resolved.evalDirs,
  ];

  const canonicalRoots = new Set<string>();
  for (const root of roots) {
    const canonical = configuredRoot(root, "");
    if (canonical === null) return null;
    canonicalRoots.add(canonical);
  }
  return [...canonicalRoots];
}

/**
 * Classify one project-relative source path for the public browser module
 * transport. The same policy is applied before remote fetches and again after
 * local resolution so aliases cannot bypass a server-source boundary.
 */
export function classifyBrowserModuleSourcePath(
  logicalPath: string,
  options: BrowserModuleSourcePolicyOptions = {},
): BrowserModuleSourcePolicy {
  const path = normalizeRelativePath(logicalPath.replace(/[?#].*$/, ""), true);
  if (path === null || path === "") {
    return {
      canonicalPath: path,
      protectionReason: "invalid-path",
      requiresClientBoundary: false,
    };
  }

  const appRoot = configuredRoot(options.config?.directories?.app, "app");
  const pagesRoot = configuredRoot(options.config?.directories?.pages, "pages");
  const primitiveRoots = discoveryRoots(options.config);
  if (appRoot === null || pagesRoot === null || primitiveRoots === null) {
    return {
      canonicalPath: path,
      protectionReason: "invalid-configured-root",
      requiresClientBoundary: false,
    };
  }

  const parts = path.split("/");
  const metadataCandidate = parts.length === 1 ? parts[0]!.replace(/\.(?:mjs|js)$/i, "") : "";
  if (
    parts.length === 1 &&
    (PROJECT_METADATA_FILE.test(parts[0]!) || PROJECT_METADATA_FILE.test(metadataCandidate))
  ) {
    return { canonicalPath: path, protectionReason: "metadata", requiresClientBoundary: false };
  }
  if (parts.some((part) => part.startsWith("."))) {
    return { canonicalPath: path, protectionReason: "hidden-path", requiresClientBoundary: false };
  }
  if (ROOT_MIDDLEWARE_MODULE.test(path)) {
    return { canonicalPath: path, protectionReason: "middleware", requiresClientBoundary: false };
  }
  if (primitiveRoots.some((root) => isAtOrBelow(path, root))) {
    return { canonicalPath: path, protectionReason: "discovery", requiresClientBoundary: false };
  }

  const appRelative = relativeToRoot(path, appRoot);
  const protectedServerRoute = isAtOrBelow(path, belowRoot(appRoot, "actions")) ||
    isAtOrBelow(path, belowRoot(appRoot, "api")) ||
    isAtOrBelow(path, belowRoot(pagesRoot, "api")) ||
    isAtOrBelow(path, "api") ||
    (appRelative !== null && APP_ROUTE_MODULE.test(appRelative));
  if (protectedServerRoute) {
    return {
      canonicalPath: path,
      protectionReason: "server-route",
      requiresClientBoundary: false,
    };
  }

  return {
    canonicalPath: path,
    protectionReason: null,
    requiresClientBoundary: options.rscEnabled === true &&
      appRelative !== null &&
      options.isLocalProject !== true,
  };
}

/** Framework-owned project surfaces that are never browser module entrypoints. */
export function isProtectedBrowserModulePath(
  logicalPath: string,
  config?: VeryfrontConfig,
): boolean {
  return classifyBrowserModuleSourcePath(logicalPath, { config }).protectionReason !== null;
}
