import { dirname, join, normalize } from "#veryfront/compat/path/index.ts";
import type { FileInfo } from "#veryfront/platform/adapters/base.ts";
import { isWithinDirectory } from "#veryfront/utils/path-utils.ts";
import { isCompiledBinary } from "#veryfront/utils/platform.ts";
import { createFileSystem, isNotFoundError, realPath } from "./fs.ts";
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
  realPath?(path: string): Promise<string>;
}

export interface FrameworkSourceLookupResult {
  path: string;
  lookupDir: string;
}

export interface ResolveFrameworkSourcePathOptions {
  fileSystem?: FrameworkSourceFileSystem;
  realPath?: (path: string) => Promise<string>;
  extraLookupDirs?: string[];
  extensions?: readonly string[];
  includeIndexFallback?: boolean;
  /** Override runtime detection, primarily for deterministic tests. */
  compiled?: boolean;
}

export interface ResolveRelativeFrameworkSourceImportOptions {
  fileSystem?: FrameworkSourceFileSystem;
  exists?: (path: string) => Promise<boolean>;
  realPath?: (path: string) => Promise<string>;
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
  allowedLocations: ReadonlyArray<AllowedSourceLocation>,
  options: ResolveRelativeFrameworkSourceImportOptions = {},
): Promise<string | null> {
  const fs = options.fileSystem ?? createFileSystem();
  const resolveRealPath = options.realPath ?? fs.realPath?.bind(fs) ?? realPath;
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
    if (!allowedLocations.some((location) => isAllowedSourcePath(location, candidate, false))) {
      continue;
    }
    if (!await exists(candidate)) continue;

    let canonicalCandidate: string;
    try {
      canonicalCandidate = await resolveRealPath(candidate);
    } catch (error) {
      if (isNotFoundError(error)) continue;
      throw error;
    }

    if (
      allowedLocations.some((location) => isAllowedSourcePath(location, canonicalCandidate, true))
    ) {
      return canonicalCandidate;
    }
  }

  return null;
}

interface AllowedSourceLocation {
  kind: "directory" | "file";
  lexical: string;
  canonical: string;
}

function isAllowedSourcePath(
  location: AllowedSourceLocation,
  candidate: string,
  canonical: boolean,
): boolean {
  const allowedPath = canonical ? location.canonical : location.lexical;
  return location.kind === "directory"
    ? isWithinDirectory(allowedPath, candidate)
    : normalize(candidate) === normalize(allowedPath);
}

async function canonicalizeExistingRoot(
  path: string,
  resolveRealPath: (path: string) => Promise<string>,
): Promise<string | null> {
  try {
    return await resolveRealPath(path);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

function getRelativeSourceRoots(fromSourcePath: string): {
  primary: string;
  directories: string[];
  files: string[];
} | null {
  const normalizedPath = fromSourcePath.replaceAll("\\", "/");
  const embeddedMarker = "/dist/framework-src/";
  const embeddedIndex = normalizedPath.lastIndexOf(embeddedMarker);

  if (embeddedIndex >= 0) {
    const frameworkRoot = normalizedPath.slice(0, embeddedIndex);
    const embeddedRoot = `${frameworkRoot}/dist/framework-src`;
    return {
      primary: embeddedRoot,
      directories: [`${frameworkRoot}/src`, embeddedRoot],
      files: [
        `${frameworkRoot}/_dnt.shims.js`,
        `${frameworkRoot}/_dnt.polyfills.js`,
      ],
    };
  }

  const sourceMarker = "/src/";
  const sourceIndex = normalizedPath.lastIndexOf(sourceMarker);
  if (sourceIndex < 0) return null;

  const frameworkRoot = normalizedPath.slice(0, sourceIndex);
  const sourceRoot = `${frameworkRoot}/src`;
  return {
    primary: sourceRoot,
    directories: [sourceRoot, `${frameworkRoot}/dist/framework-src`],
    files: [
      `${frameworkRoot}/_dnt.shims.js`,
      `${frameworkRoot}/_dnt.polyfills.js`,
    ],
  };
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
  const resolveRealPath = options.realPath ?? fs.realPath?.bind(fs) ?? realPath;
  const lookupDirs = getFrameworkSourceLookupDirs(options.extraLookupDirs, options.compiled);
  const extensions = options.extensions ?? DEFAULT_FRAMEWORK_SOURCE_EXTENSIONS;
  const candidates = [relativePathWithoutExt];

  if (options.includeIndexFallback !== false) {
    candidates.push(`${relativePathWithoutExt}/index`);
  }

  for (const lookupDir of lookupDirs) {
    const canonicalLookupDir = await canonicalizeExistingRoot(lookupDir, resolveRealPath);
    if (!canonicalLookupDir) continue;

    for (const candidate of candidates) {
      for (const ext of extensions) {
        const candidatePath = join(lookupDir, candidate + ext);

        // Defence in depth: even if the candidate passed the textual gate
        // above, confirm the joined path is physically within the lookup dir.
        if (!isWithinDirectory(lookupDir, candidatePath)) continue;

        try {
          const stat = await fs.stat(candidatePath);
          if (!stat.isFile) continue;

          const canonicalCandidate = await resolveRealPath(candidatePath);
          if (!isWithinDirectory(canonicalLookupDir, canonicalCandidate)) continue;

          return {
            path: canonicalCandidate,
            lookupDir: canonicalLookupDir,
          };
        } catch (error) {
          if (isNotFoundError(error)) continue;
          throw error;
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
    specifier.includes("\0") || specifier.includes("\\")
  ) {
    return null;
  }

  const sourceRoots = getRelativeSourceRoots(fromSourcePath);
  if (!sourceRoots) return null;

  const fs = options.fileSystem ?? createFileSystem();
  const resolveRealPath = options.realPath ?? fs.realPath?.bind(fs) ?? realPath;
  const allowedLocations: AllowedSourceLocation[] = [];
  for (const lexicalRoot of sourceRoots.directories) {
    const canonicalRoot = await canonicalizeExistingRoot(lexicalRoot, resolveRealPath);
    if (canonicalRoot) {
      allowedLocations.push({
        kind: "directory",
        lexical: lexicalRoot,
        canonical: canonicalRoot,
      });
    }
  }
  for (const lexicalFile of sourceRoots.files) {
    const canonicalFile = await canonicalizeExistingRoot(lexicalFile, resolveRealPath);
    if (canonicalFile) {
      allowedLocations.push({ kind: "file", lexical: lexicalFile, canonical: canonicalFile });
    }
  }
  if (allowedLocations.length === 0) return null;

  const extensions = options.extensions ?? DEFAULT_FRAMEWORK_SOURCE_EXTENSIONS;
  const basePath = normalize(join(dirname(fromSourcePath), specifier));
  const isAllowedBasePath = isWithinDirectory(sourceRoots.primary, basePath) ||
    sourceRoots.files.some((path) => normalize(path) === basePath);
  if (!isAllowedBasePath) return null;

  if (/\.(tsx?|jsx?|mjs)$/.test(specifier)) {
    const explicitCandidates = [basePath, `${basePath}.src`];

    if (basePath.endsWith(".js") || basePath.endsWith(".mjs")) {
      const stem = basePath.replace(/\.(?:m?js)$/, "");
      for (const ext of [".ts", ".tsx", ".jsx", ".js", ".mjs"]) {
        explicitCandidates.push(`${stem}${ext}.src`, `${stem}${ext}`);
      }
    }

    for (const candidate of explicitCandidates) {
      const resolved = await findExistingFrameworkCandidate(candidate, allowedLocations, options);
      if (resolved) return resolved;
    }

    return null;
  }

  for (const ext of extensions) {
    const candidate = await findExistingFrameworkCandidate(
      basePath + ext,
      allowedLocations,
      options,
    );
    if (candidate) return candidate;
  }

  for (const ext of extensions) {
    const candidate = await findExistingFrameworkCandidate(
      join(basePath, "index" + ext),
      allowedLocations,
      options,
    );
    if (candidate) return candidate;
  }

  return null;
}
