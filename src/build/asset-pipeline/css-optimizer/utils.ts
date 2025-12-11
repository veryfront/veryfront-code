import { dirname, join, relative, SEPARATOR } from "std/path/mod.ts";
import { walk } from "std/fs/mod.ts";
import { logger } from "@veryfront/utils";
import type { BrowserTargets } from "@veryfront/types";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";
import { cwd } from "../../../platform/compat/process.ts";

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

  const parts = pattern.split("**");
  const baseDir = parts[0] ? parts[0] : ".";
  const _filePattern = parts[1] ? parts[1] : "";

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
  // Order matters: expand braces first, then escape dots, then handle
    .replace(/\*/g, "[^/]*");

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

  const classNameMatches = content.matchAll(/className=["']([^"']+)["']/g);
  for (const match of classNameMatches) {
    if (match[1]) {
      const classNames = match[1].split(/\s+/);
      classes.push(...classNames);
      classNames.forEach((cn) => selectors.add(`.${cn}`));
    }
  }

  const classMatches = content.matchAll(/class=["']([^"']+)["']/g);
  for (const match of classMatches) {
    if (match[1]) {
      const classNames = match[1].split(/\s+/);
      classes.push(...classNames);
      classNames.forEach((cn) => selectors.add(`.${cn}`));
    }
  }

  const idMatches = content.matchAll(/id=["']([^"']+)["']/g);
  for (const match of idMatches) {
    if (match[1]) {
      ids.push(match[1]);
      selectors.add(`#${match[1]}`);
    }
  }

  const tagMatches = content.matchAll(/<(\w+)[\s>]/g);
  for (const match of tagMatches) {
    if (match[1]) {
      const tag = match[1].toLowerCase();
      if (!tags.includes(tag)) {
        tags.push(tag);
        selectors.add(tag);
      }
    }
  }

  return { classes, ids, tags, selectors };
}

export function extractSelectorsFromHTML(html: string): string[] {
  const result = extractSelectors(html);
  return Array.from(result.selectors);
}

export function shouldKeepSelector(selector: string, usedSelectors: Set<string>): boolean {
  const universal = ["*", ":root", "html", "body", "@"];
  if (universal.some((u) => selector.includes(u))) {
    return true;
  }

  if (usedSelectors.has(selector)) {
    return true;
  }

  const parts = selector.split(/[\s>+~]/).map((p) => p.trim());
  return parts.some((part) => usedSelectors.has(part));
}

export function basicMinify(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\
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
