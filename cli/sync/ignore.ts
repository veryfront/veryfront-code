/**
 * Ignore patterns for sync - similar to .gitignore
 */

import { join } from "veryfront/platform/path";
import { createFileSystem } from "veryfront/platform";
import { cliLogger } from "#cli/utils";

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

/**
 * Load ignore patterns from .vfignore file
 */
export async function loadIgnorePatterns(projectPath: string): Promise<string[]> {
  const fs = createFileSystem();
  const ignorePath = join(projectPath, ".vfignore");
  const patterns = [...DEFAULT_IGNORE_PATTERNS];

  try {
    if (!(await fs.exists(ignorePath))) return patterns;

    const content = await fs.readTextFile(ignorePath);
    const customPatterns = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    patterns.push(...customPatterns);
  } catch (error) {
    cliLogger.debug("Failed to read .vfignore:", error);
  }

  return patterns;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/**
 * Convert a single ignore pattern to a RegExp
 */
function patternToRegex(pattern: string): RegExp {
  if (pattern.endsWith("/")) {
    const dirName = pattern.slice(0, -1);
    return new RegExp(`(^|/)${escapeRegex(dirName)}(/|$)`);
  }

  const regex = escapeRegex(pattern)
    .replace(/\\\*/g, ".*") // * matches anything
    .replace(/\\\?/g, "."); // ? matches single char

  if (pattern.startsWith("*")) return new RegExp(`(^|/)${regex}$`);

  return new RegExp(`(^|/)${regex}(/|$)`);
}

/**
 * Create an ignore checker with loaded patterns
 */
export function createIgnoreChecker(patterns: readonly string[]): IgnoreChecker {
  const regexPatterns = patterns.map(patternToRegex);

  function isIgnored(relativePath: string): boolean {
    const normalizedPath = relativePath.replace(/\\/g, "/");
    return regexPatterns.some((regex) => regex.test(normalizedPath));
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
