import { dirname, join, relative, SEPARATOR } from "../../../platform/compat/path/index.js";
import { walk } from "../../../platform/compat/std/fs.js";
import { logger } from "../../../utils/index.js";
import type { BrowserTargets } from "../../../types/index.js";
import { createError, toError } from "../../../errors/veryfront-error.js";
import { cwd } from "../../../platform/compat/process.js";

export async function findCSSFiles(dir: string): Promise<string[]> {
  const cssFiles: string[] = [];

  try {
    for await (const entry of walk(dir, { exts: [".css"], includeDirs: false })) {
      cssFiles.push(entry.path);
    }
  } catch (error) {
    logger.warn(`Could not read directory ${dir}`, { error });
  }

  return cssFiles;
}

export async function globFiles(pattern: string): Promise<string[]> {
  const files: string[] = [];

  const baseDir = pattern.split("**")[0] || ".";
  const normalizedPattern = pattern.startsWith("./") ? pattern.slice(2) : pattern;

  try {
    for await (const entry of walk(baseDir, { includeDirs: false })) {
      const normalizedPath = entry.path.startsWith("./") ? entry.path.slice(2) : entry.path;

      if (matchPattern(normalizedPath, normalizedPattern)) {
        files.push(entry.path);
      }
    }
  } catch (error) {
    logger.warn(`Could not glob pattern ${pattern}`, { error });
  }

  return files;
}

export function matchPattern(path: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\{([^}]+)\}/g, (_, group: string) => `(${group.split(",").join("|")})`)
    .replace(/\./g, "\\.")
    .replace(/\/\*\*\//g, "/(.*/)?")
    .replace(/\*/g, "[^/]*");

  return new RegExp(`^${regexPattern}$`).test(path);
}

export function getOutputPath(inputPath: string, outputDir: string): string {
  const dir = dirname(inputPath);
  const filename = inputPath.split(SEPARATOR).pop();

  if (!filename) {
    throw toError(
      createError({
        type: "config",
        message: `Invalid input path for CSS: ${inputPath}`,
      }),
    );
  }

  const outputFilename = `${filename.replace(".css", "")}.min.css`;

  const isAbsolute = dir.startsWith("/") || /^[a-zA-Z]:/.test(dir);
  const relativePath = isAbsolute ? relative(cwd(), dir) : dir;

  return join(outputDir, relativePath, outputFilename);
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

    for (const cn of value.split(/\s+/)) {
      classes.push(cn);
      selectors.add(`.${cn}`);
    }
  }

  for (const match of content.matchAll(/id=["']([^"']+)["']/g)) {
    const value = match[1];
    if (!value) continue;

    ids.push(value);
    selectors.add(`#${value}`);
  }

  const tagSet = new Set<string>();
  for (const match of content.matchAll(/<(\w+)[\s>]/g)) {
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

export function shouldKeepSelector(selector: string, usedSelectors: Set<string>): boolean {
  for (const u of UNIVERSAL_SELECTORS) {
    if (selector.includes(u)) return true;
  }

  const parts = selector.split(/[\s>+~]/).map((p) => p.trim());
  return parts.some((part) => usedSelectors.has(part));
}

export function basicMinify(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{};:,])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

export function calculateSavings(originalSize: number, minifiedSize: number): number {
  if (originalSize === 0) return 0;
  return Math.round(((originalSize - minifiedSize) / originalSize) * 100);
}

export function parseBrowserTargets(
  targets: string | string[] | BrowserTargets | undefined,
): BrowserTargets | undefined {
  if (!targets) return undefined;

  if (typeof targets === "string" || Array.isArray(targets)) {
    return {
      chrome: 90,
      firefox: 88,
      safari: 14,
      edge: 90,
    };
  }

  return targets;
}
