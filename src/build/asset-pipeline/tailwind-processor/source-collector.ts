import { globToRegExp } from "#std/path";
import { isAbsolute, join, relative, resolve } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createSecureFs } from "#veryfront/security";
import { isContainedBuildPath } from "../../bundler/project-module-resolver.ts";
import { hasControlCharacters } from "../../utils/string-validation.ts";

const MAX_PATTERN_CHARACTERS = 4_096;
const MAX_CONTENT_PATTERNS = 256;
const MAX_IGNORED_DIRECTORIES = 256;
const MAX_DIRECTORY_DEPTH = 64;
const MAX_DIRECTORY_ENTRIES = 100_000;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
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
  regex: RegExp;
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
    throw new TypeError(`Tailwind content patterns cannot exceed ${MAX_CONTENT_PATTERNS} entries`);
  }

  return patterns.map((pattern) => {
    if (
      typeof pattern !== "string" ||
      pattern.length === 0 ||
      pattern.length > MAX_PATTERN_CHARACTERS ||
      hasControlCharacters(pattern)
    ) {
      throw new TypeError("Tailwind content patterns must be safe non-empty strings");
    }

    const absolutePattern = isAbsolute(pattern) ? resolve(pattern) : resolve(projectDir, pattern);
    if (!isContainedBuildPath(projectDir, absolutePattern)) {
      throw new TypeError(
        `Tailwind content pattern resolves outside the project: ${JSON.stringify(pattern)}`,
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
      throw new TypeError(`Invalid Tailwind content pattern: ${JSON.stringify(pattern)}`);
    }

    return {
      regex: globToRegExp(projectRelativePattern, {
        extended: true,
        globstar: true,
      }),
    };
  });
}

/**
 * Read the bounded set of project source files selected for Tailwind candidate
 * extraction. Symlinks and generated/dependency directories are never
 * traversed.
 */
export async function collectTailwindSourceFiles(options: {
  projectDir: string;
  patterns: string[];
  adapter: RuntimeAdapter;
  ignoredDirs?: string[];
}): Promise<Array<{ path: string; content: string }>> {
  const projectDir = resolve(options.projectDir);
  if (!isAbsolute(options.projectDir)) {
    throw new TypeError("Tailwind projectDir must be an absolute path");
  }
  const patterns = compileContentPatterns(projectDir, options.patterns);
  const configuredIgnoredDirs = options.ignoredDirs ?? [];
  if (
    !Array.isArray(configuredIgnoredDirs) ||
    configuredIgnoredDirs.length > MAX_IGNORED_DIRECTORIES
  ) {
    throw new TypeError(
      `Tailwind ignored directories cannot exceed ${MAX_IGNORED_DIRECTORIES} entries`,
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
        throw new TypeError("Tailwind ignored directories must be safe non-empty paths");
      }
      return resolve(path);
    })
    .filter((path) => isContainedBuildPath(projectDir, path));
  if (ignoredDirs.includes(projectDir)) {
    throw new TypeError("Tailwind ignored directories cannot include the project root");
  }
  const isIgnored = (path: string): boolean =>
    ignoredDirs.some((ignoredDir) => isContainedBuildPath(ignoredDir, path));

  if (patterns.length === 0) return [];

  const secureFs = createSecureFs({
    baseDir: projectDir,
    adapter: options.adapter,
    context: "build",
    throwOnError: true,
    validationOptions: {
      followSymlinks: false,
    },
  });
  const files: Array<{ path: string; content: string }> = [];
  let visitedEntries = 0;
  let sourceBytes = 0;
  const encoder = new TextEncoder();

  const scan = async (directory: string, depth: number): Promise<void> => {
    if (isIgnored(directory)) return;
    if (depth > MAX_DIRECTORY_DEPTH) {
      throw new TypeError(
        `Tailwind source tree exceeds ${MAX_DIRECTORY_DEPTH} directory levels`,
      );
    }

    const entries = [];
    for await (const entry of secureFs.readDir(directory)) {
      visitedEntries++;
      if (visitedEntries > MAX_DIRECTORY_ENTRIES) {
        throw new TypeError(
          `Tailwind source tree exceeds ${MAX_DIRECTORY_ENTRIES} entries`,
        );
      }
      entries.push(entry);
    }
    entries.sort(compareDirectoryEntries);

    for (const entry of entries) {
      if (entry.isSymlink) continue;

      const fullPath = join(directory, entry.name);
      if (entry.isDirectory) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name) && !isIgnored(fullPath)) {
          await scan(fullPath, depth + 1);
        }
        continue;
      }
      if (!entry.isFile || !SOURCE_EXTENSIONS.has(extension(entry.name))) {
        continue;
      }

      const relativePath = portablePath(relative(projectDir, fullPath));
      if (!patterns.some((pattern) => pattern.regex.test(relativePath))) {
        continue;
      }

      const info = await secureFs.stat(fullPath);
      if (!Number.isSafeInteger(info.size) || info.size < 0) {
        throw new TypeError(`Tailwind source file has an invalid size: ${relativePath}`);
      }
      if (info.size > MAX_SOURCE_BYTES - sourceBytes) {
        throw new TypeError(
          `Tailwind source content exceeds ${MAX_SOURCE_BYTES} bytes`,
        );
      }
      const content = await secureFs.readFile(fullPath);
      const contentBytes = encoder.encode(content).byteLength;
      if (contentBytes > MAX_SOURCE_BYTES - sourceBytes) {
        throw new TypeError(
          `Tailwind source content exceeds ${MAX_SOURCE_BYTES} bytes`,
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
