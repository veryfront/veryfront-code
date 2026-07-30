import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "#veryfront/compat/path/index.ts";
import { compilePathGlob } from "#veryfront/build/utils/path-glob.ts";
import { createFileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import { isContainedBuildPath } from "../../bundler/project-module-resolver.ts";
import { hasControlCharacters } from "../../utils/string-validation.ts";
import { MAX_CSS_DIRECTORY_DEPTH, MAX_CSS_DIRECTORY_ENTRIES, MAX_CSS_FILES } from "./constants.ts";
import { runConfiguredCSSOptimization } from "./optimization-engine.ts";
import { isSafeCSSRelativePath } from "./path-validation.ts";

export { isSafeCSSRelativePath } from "./path-validation.ts";

interface DirectoryReader {
  readDir(
    path: string,
  ): AsyncIterable<{
    name: string;
    isFile: boolean;
    isDirectory: boolean;
    isSymlink?: boolean;
  }>;
}

interface DiscoveryOptions {
  fs?: DirectoryReader;
  maxFiles?: number;
}

interface GlobOptions extends DiscoveryOptions {
  baseDir?: string;
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function portablePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function requireSafePath(value: string, label: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH_CHARS ||
    hasControlCharacters(value)
  ) {
    throw new TypeError(`${label} must be a safe non-empty path`);
  }
}

function requireDiscoveryLimit(maxFiles: number): void {
  if (
    !Number.isInteger(maxFiles) ||
    maxFiles <= 0 ||
    maxFiles > MAX_CSS_FILES
  ) {
    throw new TypeError(
      `CSS discovery limit must be an integer from 1 through ${MAX_CSS_FILES}`,
    );
  }
}

async function collectMatchingFiles(options: {
  rootDir: string;
  reader: DirectoryReader;
  matches: (path: string) => boolean;
  maxFiles: number;
  allowMissingRoot?: boolean;
}): Promise<string[]> {
  const files: string[] = [];
  let visitedEntries = 0;

  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_CSS_DIRECTORY_DEPTH) {
      throw new TypeError(
        `CSS source tree exceeds ${MAX_CSS_DIRECTORY_DEPTH} directory levels`,
      );
    }

    const entries = [];
    let readAnyEntry = false;
    try {
      for await (const entry of options.reader.readDir(directory)) {
        readAnyEntry = true;
        visitedEntries++;
        if (visitedEntries > MAX_CSS_DIRECTORY_ENTRIES) {
          throw new TypeError(
            `CSS source tree exceeds ${MAX_CSS_DIRECTORY_ENTRIES} entries`,
          );
        }
        if (
          typeof entry.name !== "string" ||
          entry.name.length === 0 ||
          entry.name.length > MAX_PATH_LENGTH_CHARS ||
          entry.name === "." ||
          entry.name === ".." ||
          entry.name.includes("/") ||
          entry.name.includes("\\") ||
          hasControlCharacters(entry.name) ||
          typeof entry.isFile !== "boolean" ||
          typeof entry.isDirectory !== "boolean" ||
          (entry.isSymlink !== undefined &&
            typeof entry.isSymlink !== "boolean")
        ) {
          throw new TypeError("CSS source tree contains an invalid directory entry");
        }
        entries.push(entry);
      }
    } catch (error) {
      if (
        depth === 0 &&
        !readAnyEntry &&
        options.allowMissingRoot === true &&
        isNotFoundError(error)
      ) {
        return;
      }
      throw error;
    }
    entries.sort((left, right) => comparePaths(left.name, right.name));

    for (const entry of entries) {
      if (entry.isSymlink) continue;
      if (entry.isFile === entry.isDirectory) {
        throw new TypeError("CSS source tree contains an invalid directory entry");
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory) {
        await visit(path, depth + 1);
        continue;
      }
      if (!entry.isFile || !options.matches(path)) continue;
      files.push(path);
      if (files.length > options.maxFiles) {
        throw new TypeError(
          `CSS discovery exceeds the configured limit of ${options.maxFiles} files`,
        );
      }
    }
  };

  await visit(options.rootDir, 0);
  return files.sort(comparePaths);
}

export function findCSSFiles(
  dir: string,
  options: DiscoveryOptions = {},
): Promise<string[]> {
  requireSafePath(dir, "CSS input directory");
  const maxFiles = options.maxFiles ?? MAX_CSS_FILES;
  requireDiscoveryLimit(maxFiles);

  return collectMatchingFiles({
    rootDir: resolve(dir),
    reader: options.fs ?? createFileSystem(),
    maxFiles,
    matches: (path) => extname(path).toLowerCase() === ".css",
  });
}

function compileProjectGlob(
  pattern: string,
  baseDir: string,
): { rootDir: string; matches: (path: string) => boolean } {
  requireSafePath(pattern, "CSS content pattern");
  const absoluteBase = resolve(baseDir);
  const absolutePattern = isAbsolute(pattern) ? resolve(pattern) : resolve(absoluteBase, pattern);
  if (!isContainedBuildPath(absoluteBase, absolutePattern)) {
    throw new TypeError(
      `CSS content pattern resolves outside the project: ${JSON.stringify(pattern)}`,
    );
  }

  const relativePattern = portablePath(relative(absoluteBase, absolutePattern));
  if (
    relativePattern.length === 0 ||
    relativePattern === ".." ||
    relativePattern.startsWith("../")
  ) {
    throw new TypeError(`Invalid CSS content pattern: ${JSON.stringify(pattern)}`);
  }

  const expression = compilePathGlob(relativePattern);
  const staticSegments = expression.staticPrefixSegments.length === expression.segmentCount
    ? expression.staticPrefixSegments.slice(0, -1)
    : expression.staticPrefixSegments;
  const rootDir = resolve(absoluteBase, ...staticSegments);

  return {
    rootDir,
    matches: (path) => expression.test(portablePath(relative(absoluteBase, resolve(path)))),
  };
}

export async function globFiles(
  pattern: string,
  options: GlobOptions = {},
): Promise<string[]> {
  const baseDir = resolve(options.baseDir ?? cwd());
  const maxFiles = options.maxFiles ?? MAX_CSS_FILES;
  requireDiscoveryLimit(maxFiles);
  const compiled = compileProjectGlob(pattern, baseDir);

  return await collectMatchingFiles({
    rootDir: compiled.rootDir,
    reader: options.fs ?? createFileSystem(),
    matches: compiled.matches,
    maxFiles,
    // A static glob root such as the default `pages/` directory is optional.
    // Missing descendants and all other filesystem failures remain fatal.
    allowMissingRoot: true,
  });
}

export function matchPattern(path: string, pattern: string): boolean {
  requireSafePath(path, "CSS glob candidate");
  requireSafePath(pattern, "CSS glob pattern");
  return compilePathGlob(portablePath(pattern)).test(portablePath(path));
}

export function getOutputPath(inputPath: string, outputDir: string): string {
  const portableInput = portablePath(inputPath).normalize("NFC");
  if (!isSafeCSSRelativePath(portableInput)) {
    throw new TypeError(`Invalid relative CSS input path: ${inputPath}`);
  }
  if (extname(portableInput).toLowerCase() !== ".css") {
    throw new TypeError(`CSS input path must end in .css: ${inputPath}`);
  }

  const filename = basename(portableInput);
  const stem = filename.slice(0, -extname(filename).length);
  if (stem.length === 0) {
    throw new TypeError(`CSS input path requires a filename: ${inputPath}`);
  }
  const inputDirectory = dirname(portableInput);
  const outputFilename = `${stem}.min.css`;
  return inputDirectory === "."
    ? join(outputDir, outputFilename)
    : join(outputDir, inputDirectory, outputFilename);
}

export function extractSelectors(content: string): {
  classes: string[];
  ids: string[];
  tags: string[];
  selectors: Set<string>;
} {
  const classes: string[] = [];
  const ids: string[] = [];
  const tags: string[] = [];
  const selectors = new Set<string>();

  for (const match of content.matchAll(/class(?:Name)?=["']([^"']+)["']/g)) {
    const value = match[1];
    if (!value) continue;
    for (const className of value.split(/\s+/)) {
      if (!className) continue;
      classes.push(className);
      selectors.add(`.${className}`);
    }
  }

  for (const match of content.matchAll(/id=["']([^"']+)["']/g)) {
    const value = match[1];
    if (!value) continue;
    ids.push(value);
    selectors.add(`#${value}`);
  }

  const tagSet = new Set<string>();
  for (const match of content.matchAll(/<([A-Za-z][\w-]*)[\s>]/g)) {
    const value = match[1];
    if (!value) continue;
    const tag = value.toLowerCase();
    if (tagSet.has(tag)) continue;
    tagSet.add(tag);
    tags.push(tag);
    selectors.add(tag);
  }

  return { classes, ids, tags, selectors };
}

export function extractSelectorsFromHTML(html: string): string[] {
  return Array.from(extractSelectors(html).selectors);
}

const UNIVERSAL_SELECTORS = new Set(["*", ":root", "html", "body", "@"]);

/**
 * @deprecated Retained for callers that inspect selector heuristics. Production
 * purging is performed by the parser-backed extension contract.
 */
export function shouldKeepSelector(
  selector: string,
  usedSelectors: Set<string>,
): boolean {
  for (const universal of UNIVERSAL_SELECTORS) {
    if (selector.includes(universal)) return true;
  }

  const parts = selector.split(/[\s>+~]/).map((part) => part.trim());
  return parts.some((part) => usedSelectors.has(part));
}

/**
 * Parser-backed compatibility helper. Invalid CSS rejects instead of being
 * rewritten by regular expressions.
 */
export function basicMinify(css: string): string {
  return runConfiguredCSSOptimization({
    css,
    sourcePath: "inline.css",
    minify: true,
    sourceMap: false,
  }).css;
}

export function calculateSavings(
  originalSize: number,
  minifiedSize: number,
): number {
  if (
    !Number.isSafeInteger(originalSize) ||
    !Number.isSafeInteger(minifiedSize) ||
    originalSize < 0 ||
    minifiedSize < 0
  ) {
    throw new TypeError("CSS sizes must be non-negative safe integers");
  }
  if (originalSize === 0) return 0;
  return Math.round(((originalSize - minifiedSize) / originalSize) * 100);
}
