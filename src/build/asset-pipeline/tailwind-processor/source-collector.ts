import { globToRegExp } from "#std/path";
import { isAbsolute, join, relative, resolve } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createSecureFs } from "#veryfront/security";
import { isContainedBuildPath } from "../../bundler/project-module-resolver.ts";
import { hasControlCharacters } from "../../utils/string-validation.ts";

const MAX_PATTERN_CHARACTERS = 4_096;
const MAX_DIRECTORY_DEPTH = 64;
const MAX_DIRECTORY_ENTRIES = 100_000;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mdx"]);
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".veryfront",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

interface CompiledContentPattern {
  source: string;
  regex: RegExp;
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
      source: pattern,
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
}): Promise<Array<{ path: string; content: string }>> {
  const projectDir = resolve(options.projectDir);
  if (!isAbsolute(options.projectDir)) {
    throw new TypeError("Tailwind projectDir must be an absolute path");
  }
  const patterns = compileContentPatterns(projectDir, options.patterns);
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

  const scan = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_DIRECTORY_DEPTH) {
      throw new TypeError(
        `Tailwind source tree exceeds ${MAX_DIRECTORY_DEPTH} directory levels`,
      );
    }

    const entries = [];
    for await (const entry of secureFs.readDir(directory)) {
      entries.push(entry);
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      visitedEntries++;
      if (visitedEntries > MAX_DIRECTORY_ENTRIES) {
        throw new TypeError(
          `Tailwind source tree exceeds ${MAX_DIRECTORY_ENTRIES} entries`,
        );
      }
      if (entry.isSymlink) continue;

      const fullPath = join(directory, entry.name);
      if (entry.isDirectory) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
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
      sourceBytes += info.size;
      if (sourceBytes > MAX_SOURCE_BYTES) {
        throw new TypeError(
          `Tailwind source content exceeds ${MAX_SOURCE_BYTES} bytes`,
        );
      }
      files.push({
        path: fullPath,
        content: await secureFs.readFile(fullPath),
      });
    }
  };

  await scan(projectDir, 0);
  return files;
}
