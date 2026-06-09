import {
  DEFAULT_REACT_VERSION,
  getReactImportMap,
} from "#veryfront/transforms/esm/package-registry.ts";
import { isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";
import { getLocalReactPaths } from "#veryfront/platform/compat/react-paths.ts";
import { hashString } from "#veryfront/cache/hash.ts";

type CacheBuster = number | string;

export interface SSRImportRewriteTarget {
  specifier: string;
  kind: "alias" | "relative";
  modulePath: string;
  rewrittenPath: string;
}

export function stripSSRModuleJsExtension(path: string): string {
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

export function resolveSSRImportTargetModulePath(
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

interface SSRRewriteOptions {
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
  // In Node.js, we need to convert them to esm.sh URLs (handled in rewriteBareImports)
  if (specifier.startsWith("npm:")) return isDeno;

  if (
    specifier.startsWith("http://") ||
    specifier.startsWith("https://") ||
    specifier.startsWith("file://") ||
    specifier.startsWith("node:")
  ) {
    return true;
  }

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

function rewriteBareImports(code: string, version?: string): string {
  const v = version ?? DEFAULT_REACT_VERSION;

  return code.replace(/from\s+["']([^"'./][^"']*)["']/g, (_match, specifier: string) => {
    const bareSpecifier = specifier.startsWith("npm:") ? specifier.slice(4) : specifier;

    const reactUrl = resolveReactForRuntime(bareSpecifier, v);
    if (reactUrl) return `from "${reactUrl}"`;

    if (shouldKeepBareSpecifier(specifier)) return `from "${specifier}"`;

    return `from "https://esm.sh/${bareSpecifier}?external=react&target=es2022"`;
  });
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

function getCacheBusterSync(
  target: SSRImportRewriteTarget,
  options: SSRRewriteOptions,
): string {
  if (options.cacheBuster !== undefined) return String(options.cacheBuster);
  return getDefaultCacheBuster(target, options);
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
  const jsPath = specifierPath.endsWith(".js") ? specifierPath : `${specifierPath}.js`;

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

function buildScopedParams(options: SSRRewriteOptions): string {
  const projectParam = options.projectSlug ? `&project=${options.projectSlug}` : "";
  const branchParam = options.branch ? `&branch=${options.branch}` : "";
  return `${projectParam}${branchParam}`;
}

function rewritePathAliases(code: string, options: SSRRewriteOptions): string {
  const scopedParams = buildScopedParams(options);

  return code.replace(/from\s+["']@\/([^"']+)["']/g, (_match, path: string) => {
    const { target, prefix } = buildAliasRewrite(path, options);
    const cacheBuster = getCacheBusterSync(target, options);
    return `from "${prefix}${scopedParams}&v=${cacheBuster}"`;
  });
}

function rewriteRelativeImports(code: string, options: SSRRewriteOptions): string {
  const scopedParams = buildScopedParams(options);

  return code.replace(/from\s+["']((?:\.\.?\/|\/)[^"']+\.js)["']/g, (_match, path: string) => {
    const { target, prefix } = buildRelativeRewrite(path);
    const cacheBuster = getCacheBusterSync(target, options);
    return `from "${prefix}${scopedParams}&v=${cacheBuster}"`;
  });
}

export function applySSRImportRewrites(code: string, options: SSRRewriteOptions = {}): string {
  let result = rewriteBareImports(code, options.reactVersion);
  result = rewritePathAliases(result, options);
  result = rewriteRelativeImports(result, options);
  return result;
}

async function replaceAsync(
  code: string,
  pattern: RegExp,
  replacer: (match: RegExpExecArray) => Promise<string>,
): Promise<string> {
  const chunks: string[] = [];
  let lastIndex = 0;
  pattern.lastIndex = 0;

  for (let match = pattern.exec(code); match; match = pattern.exec(code)) {
    chunks.push(code.slice(lastIndex, match.index));
    chunks.push(await replacer(match));
    lastIndex = match.index + match[0].length;
  }

  chunks.push(code.slice(lastIndex));
  return chunks.join("");
}

async function rewritePathAliasesAsync(
  code: string,
  options: SSRRewriteOptions,
): Promise<string> {
  const scopedParams = buildScopedParams(options);
  return await replaceAsync(code, /from\s+["']@\/([^"']+)["']/g, async (match) => {
    const path = match[1] ?? "";
    const { target, prefix } = buildAliasRewrite(path, options);
    const cacheBuster = await getCacheBusterAsync(target, options);
    return `from "${prefix}${scopedParams}&v=${cacheBuster}"`;
  });
}

async function rewriteRelativeImportsAsync(
  code: string,
  options: SSRRewriteOptions,
): Promise<string> {
  const scopedParams = buildScopedParams(options);
  return await replaceAsync(code, /from\s+["']((?:\.\.?\/|\/)[^"']+\.js)["']/g, async (match) => {
    const path = match[1] ?? "";
    const { target, prefix } = buildRelativeRewrite(path);
    const cacheBuster = await getCacheBusterAsync(target, options);
    return `from "${prefix}${scopedParams}&v=${cacheBuster}"`;
  });
}

export async function applySSRImportRewritesAsync(
  code: string,
  options: SSRRewriteOptions = {},
): Promise<string> {
  let result = rewriteBareImports(code, options.reactVersion);
  result = await rewritePathAliasesAsync(result, options);
  result = await rewriteRelativeImportsAsync(result, options);
  return result;
}
