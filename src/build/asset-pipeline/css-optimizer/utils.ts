import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  SEPARATOR,
} from "#veryfront/compat/path/index.ts";
import type { BrowserTargets } from "./types/index.ts";
import { createError, toError } from "#veryfront/errors";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { minifyCSSLexically } from "../../utils/css-minifier.ts";
import {
  findCSSFiles as findCSSFilesShared,
  globFiles as globFilesShared,
  matchesGlob,
} from "../../utils/asset-utils.ts";
import { selectorReferencesUsed } from "./css-rule-parser.ts";

export const findCSSFiles = findCSSFilesShared;
export const globFiles = globFilesShared;

export function matchPattern(path: string, pattern: string): boolean {
  return matchesGlob(path, pattern);
}

export function getOutputPath(inputPath: string, outputDir: string): string {
  if (!outputDir.trim()) throw new TypeError("CSS output directory must not be blank");
  if (extname(inputPath).toLowerCase() !== ".css") {
    throw new TypeError("CSS input path must use the .css extension");
  }
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

  const outputFilename = `${filename.slice(0, -extname(filename).length)}.min.css`;
  const absoluteInput = isAbsolute(inputPath);
  const relativePath = absoluteInput ? relative(cwd(), dir) : dir;
  if (
    isAbsolute(relativePath) || relativePath.split(/[\\/]/).some((segment) => segment === "..")
  ) {
    throw new TypeError("CSS input path must not escape the current project");
  }

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
  if ([...UNIVERSAL_SELECTORS].some((universal) => selector === universal)) return true;
  return selectorReferencesUsed(selector, usedSelectors);
}

export function basicMinify(css: string): string {
  return minifyCSSLexically(css);
}

export function calculateSavings(originalSize: number, minifiedSize: number): number {
  if (originalSize === 0) return 0;
  return Math.round(((originalSize - minifiedSize) / originalSize) * 100);
}

export function parseBrowserTargets(
  targets: string | string[] | BrowserTargets | undefined,
): BrowserTargets | undefined {
  if (!targets) return undefined;

  const encodeVersion = (version: number, browser: string): number => {
    if (!Number.isFinite(version) || version <= 0) {
      throw new TypeError(`Invalid ${browser} browser version`);
    }
    const parts = String(version).split(".").map(Number);
    if (parts.length > 3 || parts.some((part) => !Number.isInteger(part) || part > 255)) {
      throw new TypeError(`Invalid ${browser} browser version`);
    }
    const [major = 0, minor = 0, patch = 0] = parts;
    return (major << 16) | (minor << 8) | patch;
  };

  if (typeof targets === "string" || Array.isArray(targets)) {
    const entries = typeof targets === "string" ? [targets] : targets;
    if (entries.length === 0) return undefined;
    const result: BrowserTargets = {};
    for (const entry of entries) {
      const match = /^(chrome|firefox|safari|edge)\s+(\d+(?:\.\d{1,2}){0,2})$/i.exec(
        entry.trim(),
      );
      if (!match?.[1] || !match[2]) {
        throw new TypeError(
          `Unsupported browser target "${entry}". Use explicit versions such as "chrome 120"`,
        );
      }
      const browser = match[1].toLowerCase() as keyof BrowserTargets;
      if (result[browser] !== undefined) {
        throw new TypeError(`Duplicate browser target: ${browser}`);
      }
      result[browser] = encodeVersion(Number(match[2]), browser);
    }
    return result;
  }

  const result: BrowserTargets = {};
  for (const [browser, version] of Object.entries(targets)) {
    if (!(["chrome", "firefox", "safari", "edge"] as const).includes(browser as never)) {
      throw new TypeError(`Unsupported browser target: ${browser}`);
    }
    if (version !== undefined) {
      result[browser as keyof BrowserTargets] = encodeVersion(version, browser);
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
