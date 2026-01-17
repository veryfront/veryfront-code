import { dirname, join, relative, SEPARATOR } from "@veryfront/platform/compat/path/index.ts";
import { walk } from "@std/fs";
import { logger } from "@veryfront/utils";
import type { BrowserTargets } from "@veryfront/types";
import { createError, toError } from "@veryfront/errors/veryfront-error.ts";
import { cwd } from "@veryfront/platform/compat/process.ts";

export async function findCSSFiles(dir: string): Promise<string[]> {
  const cssFiles: string[] = [];

  try {
    for await (const entry of walk(dir, { exts: [".css"], includeDirs: false })) {
      cssFiles.push(entry.path);
    }
  } catch (error) {
    // Directory doesn't exist or can't be read
    logger.warn(`Could not read directory ${dir}`, { error });
  }

  return cssFiles;
}

export async function globFiles(pattern: string): Promise<string[]> {
  const files: string[] = [];

  // Extract base directory and pattern
  const parts = pattern.split("**");
  const baseDir = parts[0] ? parts[0] : ".";
  const _filePattern = parts[1] ? parts[1] : "";

  // Normalize pattern (remove leading ./ for consistent matching)
  const normalizedPattern = pattern.startsWith("./") ? pattern.slice(2) : pattern;

  try {
    for await (const entry of walk(baseDir, { includeDirs: false })) {
      // Normalize entry path (remove leading ./ for consistent matching)
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
  // Handle simple wildcards and braces
  // Order matters: expand braces first, then escape dots, then handle /** / (globstar), then * (wildcard)
  const regexPattern = pattern
    .replace(/\{([^}]+)\}/g, (_, group) => `(${group.split(",").join("|")})`)
    .replace(/\./g, "\\.")
    .replace(/\/\*\*\//g, "/(.*/)?") // /** / matches zero or more directories (slash + optional subdirs)
    .replace(/\*/g, "[^/]*"); // * matches within a directory (not across /)

  const regex = new RegExp("^" + regexPattern + "$");
  return regex.test(path);
}

export function getOutputPath(inputPath: string, outputDir: string): string {
  const dir = dirname(inputPath);
  const filename = inputPath.split(SEPARATOR).pop();
  if (!filename) {
    throw toError(createError({
      type: "config",
      message: `Invalid input path for CSS: ${inputPath}`,
    }));
  }
  const nameWithoutExt = filename.replace(".css", "");
  const outputFilename = `${nameWithoutExt}.min.css`;

  const relativePath = relative(cwd(), dir);
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

  // Extract className (JSX) and class (HTML) attributes
  for (const match of content.matchAll(/class(?:Name)?=["']([^"']+)["']/g)) {
    if (!match[1]) continue;
    for (const cn of match[1].split(/\s+/)) {
      classes.push(cn);
      selectors.add(`.${cn}`);
    }
  }

  // Extract id attributes
  for (const match of content.matchAll(/id=["']([^"']+)["']/g)) {
    if (!match[1]) continue;
    ids.push(match[1]);
    selectors.add(`#${match[1]}`);
  }

  // Extract HTML tags (deduplicated)
  const tagSet = new Set<string>();
  for (const match of content.matchAll(/<(\w+)[\s>]/g)) {
    if (!match[1]) continue;
    const tag = match[1].toLowerCase();
    if (!tagSet.has(tag)) {
      tagSet.add(tag);
      tags.push(tag);
      selectors.add(tag);
    }
  }

  return { classes, ids, tags, selectors };
}

export function extractSelectorsFromHTML(html: string): string[] {
  const result = extractSelectors(html);
  return Array.from(result.selectors);
}

const UNIVERSAL_SELECTORS = new Set(["*", ":root", "html", "body", "@"]);

export function shouldKeepSelector(selector: string, usedSelectors: Set<string>): boolean {
  // Always keep universal rules
  for (const u of UNIVERSAL_SELECTORS) {
    if (selector.includes(u)) return true;
  }

  // Keep if exact match or any part of compound selector is used
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
