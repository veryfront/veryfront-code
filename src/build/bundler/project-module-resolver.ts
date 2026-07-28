import { fromFileUrl, isAbsolute, join, relative, resolve } from "#veryfront/compat/path/index.ts";
import { MODULE_NOT_FOUND, SECURITY_VIOLATION } from "#veryfront/errors";
import { type FileSystem, isNotFoundError, realPath } from "#veryfront/platform/compat/fs.ts";
import { hasControlCharacters } from "../utils/string-validation.ts";

const MAX_MODULE_SPECIFIER_CHARACTERS = 4_096;

export const PROJECT_MODULE_SUFFIXES = [
  "",
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
  ".json",
  ".css",
  ".mdx",
  ".md",
] as const;

export interface ResolvedProjectModule {
  /** Logical path used for module identity and relative resolution. */
  path: string;
  /** Canonical physical path that is safe to read. */
  readPath: string;
  /** Query/fragment suffix preserved from the authored specifier. */
  suffix: string;
}

export interface ProjectModuleCandidates {
  paths: string[];
  suffix: string;
}

export function isContainedBuildPath(basePath: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(basePath), resolve(candidatePath));
  return relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith("../") &&
      !relativePath.startsWith("..\\") &&
      !isAbsolute(relativePath));
}

export function isNodeModulesPath(path: string): boolean {
  return /(^|[/\\])node_modules([/\\]|$)/.test(path);
}

export function resolveProjectSourcePath(
  sourcePath: string,
  projectDir: string,
  label: string,
): string {
  if (
    typeof sourcePath !== "string" ||
    sourcePath.length === 0 ||
    sourcePath.length > MAX_MODULE_SPECIFIER_CHARACTERS ||
    hasControlCharacters(sourcePath)
  ) {
    throw new TypeError(`${label} source path must be a safe non-empty path`);
  }
  if (!isAbsolute(projectDir)) {
    throw new TypeError(`${label} project directory must be absolute`);
  }

  const absolutePath = isAbsolute(sourcePath)
    ? resolve(sourcePath)
    : resolve(projectDir, sourcePath);
  if (
    absolutePath === resolve(projectDir) ||
    !isContainedBuildPath(projectDir, absolutePath)
  ) {
    throw SECURITY_VIOLATION.create({
      detail: `${label} source path resolves outside the project directory`,
    });
  }
  return absolutePath;
}

function splitSpecifierSuffix(specifier: string): {
  path: string;
  suffix: string;
} {
  const queryIndex = specifier.indexOf("?");
  const fragmentIndex = specifier.indexOf("#");
  const suffixIndex = queryIndex === -1
    ? fragmentIndex
    : fragmentIndex === -1
    ? queryIndex
    : Math.min(queryIndex, fragmentIndex);
  return suffixIndex === -1 ? { path: specifier, suffix: "" } : {
    path: specifier.slice(0, suffixIndex),
    suffix: specifier.slice(suffixIndex),
  };
}

function localImportBase(
  specifier: string,
  resolveDir: string,
  projectDir: string,
): { path: string; suffix: string } | null {
  if (
    typeof specifier !== "string" ||
    specifier.length === 0 ||
    specifier.length > MAX_MODULE_SPECIFIER_CHARACTERS ||
    hasControlCharacters(specifier)
  ) {
    throw MODULE_NOT_FOUND.create({
      detail: "Local module specifier must be a safe non-empty string",
    });
  }

  if (specifier.startsWith("file:")) {
    let url: URL;
    try {
      url = new URL(specifier);
    } catch (error) {
      throw MODULE_NOT_FOUND.create({
        detail: `Malformed local module URL: ${JSON.stringify(specifier)}`,
        cause: error,
      });
    }
    if (url.protocol !== "file:") return null;
    const suffix = `${url.search}${url.hash}`;
    url.search = "";
    url.hash = "";
    return { path: fromFileUrl(url), suffix };
  }

  const local = splitSpecifierSuffix(specifier);
  if (local.path.startsWith("@/")) {
    return {
      path: resolve(projectDir, local.path.slice(2)),
      suffix: local.suffix,
    };
  }
  if (local.path.startsWith("/")) {
    return {
      path: resolve(projectDir, local.path.slice(1)),
      suffix: local.suffix,
    };
  }
  if (local.path.startsWith(".")) {
    return {
      path: resolve(resolveDir, local.path),
      suffix: local.suffix,
    };
  }
  return null;
}

function moduleCandidates(basePath: string): string[] {
  const lowerPath = basePath.toLowerCase();
  const hasKnownSuffix = PROJECT_MODULE_SUFFIXES.slice(1).some((suffix) =>
    lowerPath.endsWith(suffix)
  );
  if (hasKnownSuffix) return [basePath];

  return [
    basePath,
    ...PROJECT_MODULE_SUFFIXES.slice(1).map((suffix) => `${basePath}${suffix}`),
    ...PROJECT_MODULE_SUFFIXES.slice(1).map((suffix) => join(basePath, `index${suffix}`)),
  ];
}

export function getProjectModuleCandidates(
  specifier: string,
  resolveDir: string,
  projectDir: string,
  label: string,
  displaySpecifier = specifier,
): ProjectModuleCandidates | null {
  const local = localImportBase(specifier, resolveDir, projectDir);
  if (!local) return null;
  if (!isContainedBuildPath(projectDir, local.path)) {
    throw SECURITY_VIOLATION.create({
      detail: `${label} module import resolves outside the project directory: ${
        JSON.stringify(displaySpecifier)
      }`,
    });
  }
  return {
    paths: moduleCandidates(local.path),
    suffix: local.suffix,
  };
}

/**
 * Resolve a project-authored local module without permitting lexical or
 * symlink traversal outside the project. Bare and remote specifiers return
 * `null` so the caller can delegate them to its package/URL resolver.
 */
export async function resolveProjectModule(
  specifier: string,
  resolveDir: string,
  projectDir: string,
  fs: FileSystem,
  label: string,
  displaySpecifier = specifier,
): Promise<ResolvedProjectModule | null> {
  const candidates = getProjectModuleCandidates(
    specifier,
    resolveDir,
    projectDir,
    label,
    displaySpecifier,
  );
  if (!candidates) return null;

  let canonicalProject: Promise<string> | undefined;
  for (const candidate of candidates.paths) {
    if (!isContainedBuildPath(projectDir, candidate)) {
      throw SECURITY_VIOLATION.create({
        detail: `${label} module import resolves outside the project directory: ${
          JSON.stringify(displaySpecifier)
        }`,
      });
    }

    try {
      const info = await fs.stat(candidate);
      if (!info.isFile) continue;
      const [canonicalProjectPath, canonicalCandidate] = await Promise.all([
        canonicalProject ??= realPath(projectDir),
        realPath(candidate),
      ]);
      if (!isContainedBuildPath(canonicalProjectPath, canonicalCandidate)) {
        throw SECURITY_VIOLATION.create({
          detail:
            `${label} module import resolves outside the project directory through a symbolic link: ${
              JSON.stringify(displaySpecifier)
            }`,
        });
      }
      return {
        path: candidate,
        readPath: canonicalCandidate,
        suffix: candidates.suffix,
      };
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }

  throw MODULE_NOT_FOUND.create({
    detail: `Cannot resolve ${label.toLowerCase()} module ${
      JSON.stringify(displaySpecifier)
    } from ${resolveDir}`,
  });
}
