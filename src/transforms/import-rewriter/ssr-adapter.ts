import {
  DEFAULT_REACT_VERSION,
  getReactImportMap,
} from "#veryfront/transforms/esm/package-registry.ts";
import { isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";
import { getLocalReactPaths } from "#veryfront/platform/compat/react-paths.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import { applyImportEdits, parseImportEdits } from "./import-edit.ts";

type CacheBuster = number | string;
const MAX_SSR_QUERY_IDENTITY_CODE_UNITS = 1_024;
const SSR_RELATIVE_MODULE_SPECIFIER = /^(?:\.\.?\/|\/).+\.(?:mjs|js)$/i;
const EXPLICIT_SPECIFIER_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export interface SSRImportRewriteTarget {
  specifier: string;
  kind: "alias" | "relative";
  modulePath: string;
  rewrittenPath: string;
}

export function stripSSRModuleJsExtensionCompat(path: string): string {
  return path.replace(/\.(?:mjs|js)$/i, "");
}

function normalizeSSRModulePath(path: string): string {
  let normalized = path.replace(/^\/+/, "");
  if (normalized.startsWith("_vf_modules/")) {
    normalized = normalized.slice("_vf_modules/".length);
  }
  if (normalized.startsWith("@/")) normalized = normalized.slice(2);
  return normalized;
}

export function resolveSSRImportTargetModulePathCompat(
  target: SSRImportRewriteTarget,
  currentModulePath: string,
): string {
  if (target.kind === "alias") return normalizeSSRModulePath(target.modulePath);

  const currentPath = normalizeSSRModulePath(currentModulePath);
  if (target.specifier.startsWith("/")) {
    return normalizeSSRModulePath(target.specifier);
  }

  const basePath = currentPath.startsWith("/") ? currentPath : `/${currentPath}`;
  const resolved = new URL(target.specifier, `http://veryfront.local${basePath}`).pathname;
  return normalizeSSRModulePath(resolved);
}

export interface SSRRewriteOptions {
  /** Project slug for multi-project routing */
  projectSlug?: string | null;
  /** Branch name for branch-aware routing */
  branch?: string | null;
  /** Cache buster token. When omitted, each rewritten target gets a stable token. */
  cacheBuster?: CacheBuster;
  /** Resolve a cache buster token for each rewritten target. */
  resolveCacheBuster?: (
    target: SSRImportRewriteTarget,
  ) => CacheBuster | null | undefined | Promise<CacheBuster | null | undefined>;
  /** Cross-project reference (e.g., "demo@0.0") for @/ path rewrites */
  crossProjectRef?: string;
  /** React version to use for import rewrites */
  reactVersion?: string;
}

function shouldKeepBareSpecifier(specifier: string): boolean {
  // npm: specifiers are only supported in Deno, not Node.js
  // In Node.js, rewriteBareSpecifier converts them to esm.sh URLs.
  if (specifier.startsWith("npm:")) return isDeno;

  // Runtime protocols (node:, data:, jsr:, bun:, file:, http:, and future
  // schemes) are already complete identities, not npm package names.
  if (EXPLICIT_SPECIFIER_SCHEME.test(specifier)) {
    return true;
  }

  // Node package-import maps use `#`-prefixed specifiers.
  if (specifier.startsWith("#")) return true;
  if (specifier.startsWith("@/")) return true;
  if (specifier.startsWith("veryfront/")) return true;

  return false;
}

function resolveReactForRuntime(specifier: string, version?: string): string | null {
  // For Bun: Use local React paths from veryfront's node_modules.
  // Bun handles CJS/ESM interop correctly with file:// URLs.
  if (!isDeno && !isNode) {
    const localPath = getLocalReactPaths()[specifier];
    if (localPath) return localPath;
    // If not found in local paths, fall through to esm.sh for subpath imports
  }

  // For Deno: Use esm.sh URLs (Deno supports HTTP imports natively).
  // For Node.js: Use esm.sh URLs which will be cached to disk by cacheHttpImportsToLocal.
  // The cached bundles are ESM-compatible and can be imported via file:// URLs.
  const v = version ?? DEFAULT_REACT_VERSION;
  const mapped = getReactImportMap(v)[specifier];
  if (mapped) return mapped;

  if (specifier.startsWith("react/")) {
    const subpath = specifier.slice("react/".length);
    return `https://esm.sh/react@${v}/${subpath}?external=react&target=es2022`;
  }

  if (specifier.startsWith("react-dom/")) {
    const subpath = specifier.slice("react-dom/".length);
    return `https://esm.sh/react-dom@${v}/${subpath}?external=react&target=es2022`;
  }

  return null;
}

function rewriteBareSpecifier(specifier: string, version?: string): string {
  const v = version ?? DEFAULT_REACT_VERSION;
  const bareSpecifier = specifier.startsWith("npm:") ? specifier.slice(4) : specifier;

  const reactUrl = resolveReactForRuntime(bareSpecifier, v);
  if (reactUrl) return reactUrl;

  if (shouldKeepBareSpecifier(specifier)) return specifier;

  return `https://esm.sh/${bareSpecifier}?external=react&target=es2022`;
}

function getDefaultCacheBuster(target: SSRImportRewriteTarget, options: SSRRewriteOptions): string {
  return hashString([
    target.kind,
    target.modulePath,
    target.rewrittenPath,
    options.projectSlug ?? "",
    options.branch ?? "",
    options.crossProjectRef ?? "",
    options.reactVersion ?? "",
  ].join("\0"));
}

async function getCacheBusterAsync(
  target: SSRImportRewriteTarget,
  options: SSRRewriteOptions,
): Promise<string> {
  if (options.cacheBuster !== undefined) return String(options.cacheBuster);
  const resolved = await options.resolveCacheBuster?.(target);
  if (resolved !== undefined && resolved !== null) return String(resolved);
  return getDefaultCacheBuster(target, options);
}

function buildAliasRewrite(
  specifierPath: string,
  options: SSRRewriteOptions,
): { target: SSRImportRewriteTarget; prefix: string } {
  const { crossProjectRef } = options;
  const jsPath = /\.(?:mjs|js)$/i.test(specifierPath) ? specifierPath : `${specifierPath}.js`;

  if (crossProjectRef) {
    const rewrittenPath = `/_vf_modules/_cross/${crossProjectRef}/@/${jsPath}`;
    return {
      target: {
        specifier: `@/${specifierPath}`,
        kind: "alias",
        modulePath: jsPath,
        rewrittenPath,
      },
      prefix: `${rewrittenPath}?ssr=true`,
    };
  }

  const rewrittenPath = `/_vf_modules/${jsPath}`;
  return {
    target: {
      specifier: `@/${specifierPath}`,
      kind: "alias",
      modulePath: jsPath,
      rewrittenPath,
    },
    prefix: `${rewrittenPath}?ssr=true`,
  };
}

function buildRelativeRewrite(
  specifier: string,
): { target: SSRImportRewriteTarget; prefix: string } {
  return {
    target: {
      specifier,
      kind: "relative",
      modulePath: specifier,
      rewrittenPath: specifier,
    },
    prefix: `${specifier}?ssr=true`,
  };
}

function encodeSSRQueryIdentity(value: string, label: string): string {
  let containsControlCharacter = false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      containsControlCharacter = true;
      break;
    }
  }
  if (
    value.length === 0 ||
    value.length > MAX_SSR_QUERY_IDENTITY_CODE_UNITS ||
    value !== value.trim() ||
    containsControlCharacter
  ) {
    throw new TypeError(`${label} must be a bounded non-empty query identity`);
  }
  try {
    return encodeURIComponent(value);
  } catch {
    throw new TypeError(`${label} contains malformed text encoding`);
  }
}

function buildScopedParams(options: SSRRewriteOptions): string {
  const projectParam = options.projectSlug
    ? `&project=${encodeSSRQueryIdentity(options.projectSlug, "SSR project slug")}`
    : "";
  const branchParam = options.branch
    ? `&branch=${encodeSSRQueryIdentity(options.branch, "SSR branch")}`
    : "";
  return `${projectParam}${branchParam}`;
}

async function rewriteAliasSpecifierAsync(
  specifier: string,
  options: SSRRewriteOptions,
): Promise<string> {
  const scopedParams = buildScopedParams(options);
  const { target, prefix } = buildAliasRewrite(specifier.slice(2), options);
  const cacheBuster = await getCacheBusterAsync(target, options);
  return `${prefix}${scopedParams}&v=${encodeSSRQueryIdentity(cacheBuster, "SSR cache buster")}`;
}

async function rewriteRelativeSpecifierAsync(
  specifier: string,
  options: SSRRewriteOptions,
): Promise<string> {
  const scopedParams = buildScopedParams(options);
  const { target, prefix } = buildRelativeRewrite(specifier);
  const cacheBuster = await getCacheBusterAsync(target, options);
  return `${prefix}${scopedParams}&v=${encodeSSRQueryIdentity(cacheBuster, "SSR cache buster")}`;
}

async function rewriteSSRSpecifierAsync(
  specifier: string,
  options: SSRRewriteOptions,
): Promise<string | null> {
  if (specifier.startsWith("@/")) {
    return await rewriteAliasSpecifierAsync(specifier, options);
  }

  if (SSR_RELATIVE_MODULE_SPECIFIER.test(specifier)) {
    return await rewriteRelativeSpecifierAsync(specifier, options);
  }

  if (
    specifier.length === 0 ||
    specifier.startsWith(".") ||
    specifier.startsWith("/")
  ) {
    return null;
  }

  const rewritten = rewriteBareSpecifier(specifier, options.reactVersion);
  return rewritten === specifier ? null : rewritten;
}

/**
 * Rewrite literal ESM import specifiers for the SSR runtime.
 *
 * A single module-lexer parse bounds every edit to a real static import,
 * re-export, side-effect import, or literal dynamic import. Import-looking
 * text in comments and strings is never considered.
 */
export async function rewriteSSRImportsCompatAsync(
  code: string,
  options: SSRRewriteOptions = {},
): Promise<string> {
  const parsed = await parseImportEdits(code);
  const rewrites = new Map<number, { specifier: string }>();

  for (let index = 0; index < parsed.imports.length; index++) {
    const imported = parsed.imports[index]!;
    const replacement = await rewriteSSRSpecifierAsync(
      imported.specifier,
      options,
    );
    if (replacement !== null && replacement !== imported.specifier) {
      rewrites.set(index, { specifier: replacement });
    }
  }

  return rewrites.size === 0 ? code : applyImportEdits(parsed, rewrites);
}
