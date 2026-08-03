/**
 * Ignore patterns for sync - similar to .gitignore
 */

import { join } from "veryfront/platform/path";
import { createFileSystem } from "veryfront/platform";
import { cliLogger } from "#cli/utils";
import { isNotFoundError, lstat } from "veryfront/fs";

/** Default patterns always ignored */
const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  // Directories
  "node_modules",
  "dist",
  "build",
  ".next",
  ".cache",
  ".git",
  ".deno",
  ".veryfront",
  ".turbo",
  ".vercel",
  ".netlify",
  "coverage",

  // Files
  "*.log",
  "*.local",
  ".env*",
  ".DS_Store",
  "Thumbs.db",
  "*.swp",
  "*.swo",
  "*~",
];

/** Supported file extensions for sync */
const SUPPORTED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".htm",
  ".md",
  ".mdx",
  ".txt",
  ".svg",
  ".yaml",
  ".yml",
  ".toml",
]);

export interface IgnoreChecker {
  /** Check if a path should be ignored */
  isIgnored(relativePath: string): boolean;

  /** Check if a file extension is supported */
  isSupportedExtension(filename: string): boolean;
}

interface IgnoreRule {
  negated: boolean;
  regex: RegExp;
}

/**
 * Load ignore patterns from .vfignore file
 */
export async function loadIgnorePatterns(projectPath: string): Promise<string[]> {
  const fs = createFileSystem();
  const ignorePath = join(projectPath, ".vfignore");
  const patterns = [...DEFAULT_IGNORE_PATTERNS];

  let ignoreInfo;
  try {
    ignoreInfo = await lstat(ignorePath);
  } catch (error) {
    if (isNotFoundError(error)) return patterns;
    cliLogger.debug("Failed to read .vfignore:", error);
    throw new Error("Failed to read .vfignore. Fix the file permissions or path and try again.", {
      cause: error,
    });
  }

  if (ignoreInfo.isSymlink || !ignoreInfo.isFile) {
    throw new Error(
      ".vfignore must be a regular file inside the project and cannot be a symbolic link.",
    );
  }

  try {
    const content = await fs.readTextFile(ignorePath);
    const customPatterns = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    patterns.push(...customPatterns);
  } catch (error) {
    cliLogger.debug("Failed to read .vfignore:", error);
    throw new Error("Failed to read .vfignore. Fix the file permissions or path and try again.", {
      cause: error,
    });
  }

  return patterns;
}

function escapeRegex(str: string): string {
  return str.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function globToRegex(pattern: string): string {
  let source = "";

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern.charAt(i);
    const next = pattern[i + 1];

    if (char === "*") {
      if (next === "*") {
        const following = pattern[i + 2];
        if (following === "/") {
          source += "(?:.*/)?";
          i += 2;
        } else {
          source += ".*";
          i += 1;
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegex(char);
  }

  return source;
}

function patternToRule(rawPattern: string): IgnoreRule | null {
  let pattern = rawPattern.trim();
  if (!pattern || pattern.startsWith("#")) return null;

  const negated = pattern.startsWith("!");
  if (negated) pattern = pattern.slice(1);
  if (!pattern) return null;

  const anchored = pattern.startsWith("/");
  if (anchored) pattern = pattern.slice(1);

  const directoryOnly = pattern.endsWith("/");
  if (directoryOnly) pattern = pattern.slice(0, -1);
  if (!pattern) return null;

  const hasSlash = pattern.includes("/");
  const hasGlob = /[*?]/.test(pattern);
  const body = globToRegex(pattern);
  const prefix = anchored ? "^" : "(^|/)";
  const suffix = directoryOnly || (!hasSlash && !hasGlob) ? "(/|$)" : "$";

  return {
    negated,
    regex: new RegExp(`${prefix}${body}${suffix}`),
  };
}

/**
 * Create an ignore checker with loaded patterns
 */
export function createIgnoreChecker(patterns: readonly string[]): IgnoreChecker {
  const rules = patterns.flatMap((pattern) => {
    const rule = patternToRule(pattern);
    return rule ? [rule] : [];
  });

  function isIgnored(relativePath: string): boolean {
    const normalizedPath = relativePath.replace(/\\/g, "/");
    let ignored = false;

    for (const rule of rules) {
      if (!rule.regex.test(normalizedPath)) continue;
      ignored = !rule.negated;
    }

    return ignored;
  }

  function isSupportedExtension(filename: string): boolean {
    const lastDot = filename.lastIndexOf(".");
    if (lastDot === -1) return false;
    return SUPPORTED_EXTENSIONS.has(filename.slice(lastDot).toLowerCase());
  }

  return { isIgnored, isSupportedExtension };
}

/**
 * Create default ignore checker (without loading .vfignore)
 */
export function createDefaultIgnoreChecker(): IgnoreChecker {
  return createIgnoreChecker(DEFAULT_IGNORE_PATTERNS);
}
