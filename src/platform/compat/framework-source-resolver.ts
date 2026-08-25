import { dirname, join, resolve } from "#veryfront/compat/path/index.ts";
import type { FileInfo } from "#veryfront/platform/adapters/base.ts";
import { isWithinDirectory } from "#veryfront/utils/path-utils.ts";
import { isCompiledBinary } from "#veryfront/utils/platform.ts";
import { createFileSystem, isNotFoundError } from "./fs.ts";
import { PUBLISHED_RUNTIME_HELPERS } from "./published-runtime-helpers.ts";
import { getFrameworkRoot, getFrameworkRootFromMeta } from "./vfs-paths.ts";

/**
 * Reject candidate paths that contain traversal indicators — plain `..`,
 * NUL, or any percent-encoded variant (including multiply-encoded forms such
 * as `%252e` or `%25252e`). The public `/_vf_modules/...` route reaches this
 * resolver, so a malicious basePath like
 * `_veryfront/%2e%2e%2fsecret.ts` would otherwise be joined with the
 * framework lookupDir and escape it.
 */
function hasDangerousSegments(candidate: string): boolean {
  if (candidate.includes("\0")) return true;
  // Plain-text traversal (post URL-decode).
  if (/(^|[/\\])\.\.([/\\]|$)/.test(candidate)) return true;
  // Any occurrence of a percent sign is treated as suspicious: this resolver
  // is called with inputs taken from URL path segments which have already
  // been decoded once upstream. A lingering `%` means the attacker
  // double-encoded the input, or that decoding missed a sequence — either
  // way, refuse to probe the filesystem. Framework source paths never
  // legitimately contain `%`.
  if (candidate.includes("%")) return true;
  return false;
}

/** Return whether an untrusted framework-relative source key is safe to probe. */
export function isSafeFrameworkSourceKey(candidate: string): boolean {
  return !hasDangerousSegments(candidate);
}

/**
 * Framework subtrees that tenant module loading must never resolve directly.
 *
 * `platform/compat/process` holds the host process seam: `getHostEnv()`, the
 * captured host environment record, the scoped-write bookkeeping, and process
 * mutators. Tenant code reaches framework source through supported package
 * exports (for environment access, `veryfront/platform/env`), and the
 * implementation modules stay reachable for the framework's own transform
 * graph, which resolves transitive imports through separate trusted paths.
 * Serving these modules as tenant-requested entry points would let a project
 * import `getHostEnv` and read host-only secrets while its project
 * environment overlay is active.
 */
const PRIVILEGED_FRAMEWORK_SOURCE_PREFIXES = ["platform/compat/process"] as const;

const FRAMEWORK_SOURCE_KEY_EXT_RE = /\.(?:src|tsx|ts|jsx|js|mjs|cjs|mdx|md|json)$/;

/**
 * Return whether a tenant-supplied framework source key names a privileged
 * implementation module that must not be served to tenant module loading.
 *
 * The key is compared after stripping any query suffix and trailing module
 * extensions (including `.src` embedded-source suffixes), so
 * `platform/compat/process/env`, `platform/compat/process/env.ts`, and
 * `platform/compat/process/env.js?ssr=true` all match.
 */
export function isPrivilegedFrameworkSourceKey(candidate: string): boolean {
  let normalized = candidate.replace(/\?.*$/, "").replace(/\/+$/, "");
  while (FRAMEWORK_SOURCE_KEY_EXT_RE.test(normalized)) {
    normalized = normalized.replace(FRAMEWORK_SOURCE_KEY_EXT_RE, "");
  }
  return PRIVILEGED_FRAMEWORK_SOURCE_PREFIXES.some((prefix) =>
    normalized === prefix || normalized.startsWith(`${prefix}/`)
  );
}

export const FRAMEWORK_ROOT = getFrameworkRootFromMeta(import.meta.url);
export const FRAMEWORK_SRC_DIR = join(FRAMEWORK_ROOT, "src");
export const FRAMEWORK_EMBEDDED_SRC_DIR = join(FRAMEWORK_ROOT, "dist", "framework-src");

export const DEFAULT_FRAMEWORK_SOURCE_EXTENSIONS = [
  ".tsx.src",
  ".ts.src",
  ".jsx.src",
  ".js.src",
  ".mdx.src",
  ".md.src",
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mdx",
  ".md",
] as const;

export interface FrameworkSourceFileSystem {
  stat(path: string): Promise<FileInfo>;
}

export interface FrameworkSourceLookupResult {
  path: string;
  lookupDir: string;
}

export interface ResolveFrameworkSourcePathOptions {
  fileSystem?: FrameworkSourceFileSystem;
  extraLookupDirs?: string[];
  extensions?: readonly string[];
  includeIndexFallback?: boolean;
  /** Override runtime detection, primarily for deterministic tests. */
  compiled?: boolean;
}

export interface ResolveRelativeFrameworkSourceImportOptions {
  fileSystem?: FrameworkSourceFileSystem;
  exists?: (path: string) => Promise<boolean>;
  extensions?: readonly string[];
  /** Override runtime detection, primarily for deterministic tests. */
  compiled?: boolean;
}

export function getFrameworkSourceLookupDirs(
  extraLookupDirs: string[] = [],
  compiled = isCompiledBinary(),
): string[] {
  const seen = new Set<string>();
  const runtimeDirs = compiled
    ? [FRAMEWORK_EMBEDDED_SRC_DIR, FRAMEWORK_SRC_DIR]
    : [FRAMEWORK_SRC_DIR, FRAMEWORK_EMBEDDED_SRC_DIR];
  const ordered = [...runtimeDirs, ...extraLookupDirs];

  return ordered.filter((dir) => {
    if (seen.has(dir)) return false;
    seen.add(dir);
    return true;
  });
}

export function isFrameworkSourcePath(path: string): boolean {
  return path.startsWith(`${FRAMEWORK_SRC_DIR}/`) ||
    path.startsWith(`${FRAMEWORK_EMBEDDED_SRC_DIR}/`);
}

function expandFrameworkCandidatePaths(
  candidatePath: string,
  compiled = isCompiledBinary(),
): string[] {
  const candidateRoot = getFrameworkRoot(candidatePath);
  const candidateSrcDir = candidateRoot ? join(candidateRoot, "src") : FRAMEWORK_SRC_DIR;
  const candidateEmbeddedDir = candidateRoot
    ? join(candidateRoot, "dist", "framework-src")
    : FRAMEWORK_EMBEDDED_SRC_DIR;

  if (candidatePath.startsWith(`${candidateSrcDir}/`)) {
    const relativePath = candidatePath.slice(candidateSrcDir.length + 1);
    const embeddedPath = join(candidateEmbeddedDir, relativePath);
    const embeddedCandidates = embeddedPath.endsWith(".src")
      ? [embeddedPath]
      : [`${embeddedPath}.src`, embeddedPath];
    return compiled
      ? [...new Set([...embeddedCandidates, candidatePath])]
      : [...new Set([candidatePath, ...embeddedCandidates])];
  }

  if (candidatePath.startsWith(`${candidateEmbeddedDir}/`)) {
    const relativePath = candidatePath.slice(candidateEmbeddedDir.length + 1);
    const sourcePath = join(candidateSrcDir, relativePath).replace(/\.src$/, "");
    const embeddedCandidates = candidatePath.endsWith(".src")
      ? [candidatePath]
      : [`${candidatePath}.src`, candidatePath];
    return compiled
      ? [...new Set([...embeddedCandidates, sourcePath])]
      : [...new Set([sourcePath, ...embeddedCandidates])];
  }

  return [candidatePath];
}

async function findExistingFrameworkCandidate(
  candidatePath: string,
  options: ResolveRelativeFrameworkSourceImportOptions = {},
): Promise<string | null> {
  const fs = options.fileSystem ?? createFileSystem();
  const exists = options.exists ?? (async (path: string) => {
    try {
      const stat = await fs.stat(path);
      return stat.isFile;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  });

  for (const candidate of expandFrameworkCandidatePaths(candidatePath, options.compiled)) {
    if (await exists(candidate)) return candidate;
  }

  return null;
}

export async function resolveFrameworkSourcePath(
  relativePathWithoutExt: string,
  options: ResolveFrameworkSourcePathOptions = {},
): Promise<FrameworkSourceLookupResult | null> {
  // VULN-FS-3: Reject any candidate containing traversal indicators
  // (plain or percent-encoded) before joining with the framework lookup dir.
  // The public /_vf_modules/... route reaches this function with user input.
  if (!isSafeFrameworkSourceKey(relativePathWithoutExt)) return null;

  const fs = options.fileSystem ?? createFileSystem();
  const lookupDirs = getFrameworkSourceLookupDirs(options.extraLookupDirs, options.compiled);
  const extensions = options.extensions ?? DEFAULT_FRAMEWORK_SOURCE_EXTENSIONS;
  const candidates = [relativePathWithoutExt];

  if (options.includeIndexFallback !== false) {
    candidates.push(`${relativePathWithoutExt}/index`);
  }

  for (const lookupDir of lookupDirs) {
    for (const candidate of candidates) {
      for (const ext of extensions) {
        const candidatePath = join(lookupDir, candidate + ext);

        // Defence in depth: even if the candidate passed the textual gate
        // above, confirm the joined path is physically within the lookup dir.
        if (!isWithinDirectory(lookupDir, candidatePath)) continue;

        try {
          const stat = await fs.stat(candidatePath);
          if (stat.isFile) {
            return {
              path: candidatePath,
              lookupDir,
            };
          }
        } catch (error) {
          if (!isNotFoundError(error)) throw error;
        }
      }
    }
  }

  return null;
}

export async function resolveRelativeFrameworkSourceImport(
  specifier: string,
  fromSourcePath: string,
  options: ResolveRelativeFrameworkSourceImportOptions = {},
): Promise<string | null> {
  if (
    (!specifier.startsWith("./") && !specifier.startsWith("../")) ||
    specifier.includes("\0") ||
    specifier.includes("\\")
  ) {
    return null;
  }

  const candidateRoot = getFrameworkRoot(fromSourcePath);
  if (!candidateRoot) return null;

  const candidateSourceDir = join(candidateRoot, "src");
  const candidateEmbeddedDir = join(candidateRoot, "dist", "framework-src");
  const containingTree = isWithinDirectory(candidateSourceDir, fromSourcePath)
    ? candidateSourceDir
    : isWithinDirectory(candidateEmbeddedDir, fromSourcePath)
    ? candidateEmbeddedDir
    : null;
  if (!containingTree) return null;

  const extensions = options.extensions ?? DEFAULT_FRAMEWORK_SOURCE_EXTENSIONS;
  const basePath = resolve(dirname(fromSourcePath), specifier);
  const isPublishedRuntimeHelper = PUBLISHED_RUNTIME_HELPERS.some(
    (helper) => basePath === join(candidateRoot, helper),
  );
  if (!isWithinDirectory(containingTree, basePath) && !isPublishedRuntimeHelper) return null;
  if (isPublishedRuntimeHelper) {
    return await findExistingFrameworkCandidate(basePath, options);
  }

  if (/\.(tsx?|jsx?|mjs)$/.test(specifier)) {
    const explicitCandidates = [basePath, `${basePath}.src`];

    if (basePath.endsWith(".js") || basePath.endsWith(".mjs")) {
      const stem = basePath.replace(/\.(?:m?js)$/, "");
      for (const ext of [".ts", ".tsx", ".jsx", ".js", ".mjs"]) {
        explicitCandidates.push(`${stem}${ext}.src`, `${stem}${ext}`);
      }
    }

    for (const candidate of explicitCandidates) {
      const resolved = await findExistingFrameworkCandidate(candidate, options);
      if (resolved) return resolved;
    }

    return null;
  }

  for (const ext of extensions) {
    const candidate = await findExistingFrameworkCandidate(basePath + ext, options);
    if (candidate) return candidate;
  }

  for (const ext of extensions) {
    const candidate = await findExistingFrameworkCandidate(join(basePath, "index" + ext), options);
    if (candidate) return candidate;
  }

  return null;
}
