/**
 * Ignore patterns for sync - similar to .gitignore
 */

import { join } from "#veryfront/platform/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";

/** Default patterns always ignored */
const DEFAULT_IGNORE_PATTERNS = [
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
    if (await fs.exists(ignorePath)) {
      const content = await fs.readTextFile(ignorePath);
      const customPatterns = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
      patterns.push(...customPatterns);
    }
  } catch {
    // Ignore errors reading .vfignore
  }

  return patterns;
}

/**
 * Create an ignore checker with loaded patterns
 */
export function createIgnoreChecker(patterns: string[]): IgnoreChecker {
  // Convert glob patterns to regex
  const regexPatterns = patterns.map((pattern) => {
    // Handle directory patterns (ending with /)
    if (pattern.endsWith("/")) {
      const dirName = pattern.slice(0, -1);
      return new RegExp(`(^|/)${escapeRegex(dirName)}(/|$)`);
    }

    // Handle glob patterns
    let regex = escapeRegex(pattern);
    regex = regex.replace(/\\\*/g, ".*"); // * matches anything
    regex = regex.replace(/\\\?/g, "."); // ? matches single char

    // If pattern starts with *, match anywhere in filename
    if (pattern.startsWith("*")) {
      return new RegExp(`(^|/)${regex}$`);
    }

    // Otherwise match as directory or exact path
    return new RegExp(`(^|/)${regex}(/|$)`);
  });

  return {
    isIgnored(relativePath: string): boolean {
      const normalizedPath = relativePath.replace(/\\/g, "/");
      return regexPatterns.some((regex) => regex.test(normalizedPath));
    },

    isSupportedExtension(filename: string): boolean {
      const lastDot = filename.lastIndexOf(".");
      if (lastDot === -1) return false;
      return SUPPORTED_EXTENSIONS.has(filename.slice(lastDot).toLowerCase());
    },
  };
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/**
 * Create default ignore checker (without loading .vfignore)
 */
export function createDefaultIgnoreChecker(): IgnoreChecker {
  return createIgnoreChecker(DEFAULT_IGNORE_PATTERNS);
}
