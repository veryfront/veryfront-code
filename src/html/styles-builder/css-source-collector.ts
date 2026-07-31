import { compilePathGlob, type PathGlobMatcher } from "#veryfront/build/utils/path-glob.ts";
import { isAbsolute, join, relative, resolve } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { captureBoundedTextReader } from "#veryfront/platform/adapters/bounded-text-reader.ts";
import { createSecureFs } from "#veryfront/security";
import {
  MAX_CSS_DIRECTORY_DEPTH,
  MAX_CSS_DIRECTORY_ENTRIES,
  MAX_CSS_FILE_BYTES,
  MAX_CSS_FILES,
  MAX_CSS_TOTAL_BYTES,
} from "#veryfront/utils/constants/css.ts";
import { isContainedBuildPath } from "../../build/bundler/project-module-resolver.ts";
import { hasControlCharacters } from "../../build/utils/string-validation.ts";
import {
  shouldIncludeStylePath,
  shouldTraverseStyleDirectory,
  type StyleScopeProfile,
} from "./style-scope-profile.ts";

const MAX_PATTERN_CHARACTERS = 4_096;
const MAX_CONTENT_PATTERNS = 256;
const MAX_IGNORED_DIRECTORIES = 256;
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mdx"]);
const EXCLUDED_DIRECTORIES = new Set([
  ".deno_cache",
  ".git",
  ".veryfront",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

interface CompiledContentPattern {
  matcher: PathGlobMatcher;
}

function compareDirectoryEntries(
  left: { name: string },
  right: { name: string },
): number {
  if (left.name === right.name) return 0;
  return left.name < right.name ? -1 : 1;
}

function portablePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function extension(path: string): string {
  const filename = portablePath(path).split("/").at(-1) ?? "";
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
}

function compileContentPatterns(
  projectDir: string,
  patterns: string[],
): CompiledContentPattern[] {
  if (!Array.isArray(patterns) || patterns.length > MAX_CONTENT_PATTERNS) {
    throw new TypeError(`CSS candidate patterns cannot exceed ${MAX_CONTENT_PATTERNS} entries`);
  }

  return patterns.map((pattern) => {
    if (
      typeof pattern !== "string" ||
      pattern.length === 0 ||
      pattern.length > MAX_PATTERN_CHARACTERS ||
      hasControlCharacters(pattern)
    ) {
      throw new TypeError("CSS candidate patterns must be safe non-empty strings");
    }

    const absolutePattern = isAbsolute(pattern) ? resolve(pattern) : resolve(projectDir, pattern);
    if (!isContainedBuildPath(projectDir, absolutePattern)) {
      throw new TypeError(
        `CSS candidate pattern resolves outside the project: ${JSON.stringify(pattern)}`,
      );
    }

    const projectRelativePattern = portablePath(
      relative(projectDir, absolutePattern),
    );
    if (
      projectRelativePattern === "" ||
      projectRelativePattern === ".." ||
      projectRelativePattern.startsWith("../")
    ) {
      throw new TypeError(`Invalid CSS candidate pattern: ${JSON.stringify(pattern)}`);
    }

    return {
      matcher: compilePathGlob(projectRelativePattern),
    };
  });
}

/**
 * Read the bounded set of project source files selected for CSS candidate
 * extraction. Symlinks and generated/dependency directories are never
 * traversed.
 */
export async function collectCSSCandidateSourceFiles(options: {
  projectDir: string;
  patterns: string[];
  adapter: RuntimeAdapter;
  ignoredDirs?: string[];
  styleProfile?: StyleScopeProfile;
}): Promise<Array<{ path: string; content: string }>> {
  const projectDir = resolve(options.projectDir);
  if (!isAbsolute(options.projectDir)) {
    throw new TypeError("CSS candidate projectDir must be an absolute path");
  }
  const patterns = compileContentPatterns(projectDir, options.patterns);
  const configuredIgnoredDirs = options.ignoredDirs ?? [];
  if (
    !Array.isArray(configuredIgnoredDirs) ||
    configuredIgnoredDirs.length > MAX_IGNORED_DIRECTORIES
  ) {
    throw new TypeError(
      `CSS candidate ignored directories cannot exceed ${MAX_IGNORED_DIRECTORIES} entries`,
    );
  }
  const ignoredDirs = configuredIgnoredDirs
    .map((path) => {
      if (
        typeof path !== "string" ||
        path.length === 0 ||
        path.length > MAX_PATTERN_CHARACTERS ||
        hasControlCharacters(path)
      ) {
        throw new TypeError("CSS candidate ignored directories must be safe non-empty paths");
      }
      return resolve(path);
    })
    .filter((path) => isContainedBuildPath(projectDir, path));
  if (ignoredDirs.includes(projectDir)) {
    throw new TypeError("CSS candidate ignored directories cannot include the project root");
  }
  const isIgnored = (path: string): boolean =>
    ignoredDirs.some((ignoredDir) => isContainedBuildPath(ignoredDir, path));

  if (patterns.length === 0) return [];

  const secureFs = createSecureFs({
    baseDir: projectDir,
    adapter: options.adapter,
    context: "build",
    validationOptions: {
      followSymlinks: false,
    },
  });
  const sourceReader = captureBoundedTextReader(
    secureFs,
    "CSS candidate source filesystem",
  );
  const files: Array<{ path: string; content: string }> = [];
  let visitedEntries = 0;
  let sourceBytes = 0;
  let selectedFiles = 0;

  const scan = async (directory: string, depth: number): Promise<void> => {
    if (isIgnored(directory)) return;
    if (depth > MAX_CSS_DIRECTORY_DEPTH) {
      throw new TypeError(
        `CSS candidate source tree exceeds ${MAX_CSS_DIRECTORY_DEPTH} directory levels`,
      );
    }

    const entries = [];
    for await (const entry of secureFs.readDir(directory)) {
      visitedEntries++;
      if (visitedEntries > MAX_CSS_DIRECTORY_ENTRIES) {
        throw new TypeError(
          `CSS candidate source tree exceeds ${MAX_CSS_DIRECTORY_ENTRIES} entries`,
        );
      }
      entries.push(entry);
    }
    entries.sort(compareDirectoryEntries);

    for (const entry of entries) {
      if (entry.isSymlink) continue;

      const fullPath = join(directory, entry.name);
      if (entry.isDirectory) {
        if (
          !EXCLUDED_DIRECTORIES.has(entry.name) &&
          !isIgnored(fullPath) &&
          (!options.styleProfile ||
            shouldTraverseStyleDirectory(options.styleProfile, fullPath, projectDir))
        ) {
          await scan(fullPath, depth + 1);
        }
        continue;
      }
      if (!entry.isFile || !SOURCE_EXTENSIONS.has(extension(entry.name))) {
        continue;
      }
      if (
        options.styleProfile &&
        !shouldIncludeStylePath(options.styleProfile, fullPath, projectDir)
      ) {
        continue;
      }

      const relativePath = portablePath(relative(projectDir, fullPath));
      if (!patterns.some((pattern) => pattern.matcher.test(relativePath))) {
        continue;
      }

      selectedFiles++;
      if (selectedFiles > MAX_CSS_FILES) {
        throw new TypeError(`CSS candidate source content exceeds ${MAX_CSS_FILES} files`);
      }

      const info = await secureFs.stat(fullPath);
      if (!Number.isSafeInteger(info.size) || info.size < 0) {
        throw new TypeError(`CSS candidate source file has an invalid size: ${relativePath}`);
      }
      if (info.size > MAX_CSS_FILE_BYTES) {
        throw new TypeError(
          `CSS candidate source file exceeds ${MAX_CSS_FILE_BYTES} bytes: ${relativePath}`,
        );
      }
      if (info.size > MAX_CSS_TOTAL_BYTES - sourceBytes) {
        throw new TypeError(
          `CSS candidate source content exceeds ${MAX_CSS_TOTAL_BYTES} total bytes`,
        );
      }
      const { content, byteLength: contentBytes } = await sourceReader.readUtf8(
        fullPath,
        MAX_CSS_FILE_BYTES,
        `CSS candidate source file ${relativePath}`,
      );
      if (contentBytes > MAX_CSS_TOTAL_BYTES - sourceBytes) {
        throw new TypeError(
          `CSS candidate source content exceeds ${MAX_CSS_TOTAL_BYTES} total bytes`,
        );
      }
      sourceBytes += contentBytes;
      files.push({
        path: fullPath,
        content,
      });
    }
  };

  await scan(projectDir, 0);
  return files;
}
