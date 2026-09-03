/**
 * Ignore patterns for sync - similar to .gitignore
 */

import { join } from "veryfront/platform/path";
import { createFileSystem } from "veryfront/platform";
import { cliLogger, logWarning } from "#cli/utils";
import { isJsonMode } from "../shared/json-output.ts";
import { isNotFoundError, lstat } from "veryfront/fs";
import { sanitizeTerminalDiagnosticText } from "veryfront/errors";

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

/**
 * Safety patterns that project-controlled `.vfignore` rules can never re-include.
 * They hold credentials, local CLI state, and Git internals, so a negation such
 * as `!.env*.json` must not make `veryfront push` read and upload them.
 *
 * The two `.env` entries are deliberately stricter than the `.env*` default:
 * they cover `.env` itself and dot-suffixed variants such as `.env.local` and
 * `.env.production.json`, but not unrelated names that merely start with `.env`
 * (`.envoy`, `.environments`, `.envs`). Those keep the `.env*` default ignore
 * and stay negatable, so a project that publishes files from such a directory
 * is not forced to rename it. Both entries end in `/` so they match a directory
 * too: a directory-only pattern compiles to a suffix of `/` or end of string,
 * which also matches the plain file form.
 *
 * The set stays narrower than `DEFAULT_IGNORE_PATTERNS`. Build caches and
 * third-party tool metadata such as `.cache`, `.deno`, `.turbo`, `.vercel`, and
 * `.netlify` hold no Veryfront credential, and a project can have a real reason
 * to publish a file under them, so those stay negatable.
 */
const PROTECTED_IGNORE_PATTERNS: readonly string[] = [
  ".env/",
  ".env.*/",
  ".veryfront",
  ".git",
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

  /** Check if a path is protected even when a project ignore rule negates it. */
  isProtected(relativePath: string): boolean;

  /** Check if a file extension is supported */
  isSupportedExtension(filename: string): boolean;
}

interface IgnoreRule {
  negated: boolean;
  regex: RegExp;
  anchored: boolean;
  literalPrefix: string;
  descendantPrefixRegexes: RegExp[];
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

function patternToRule(rawPattern: string, caseInsensitive = false): IgnoreRule | null {
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
  const wildcardIndex = pattern.search(/[*?]/);
  const literalPrefix = (wildcardIndex === -1 ? pattern : pattern.slice(0, wildcardIndex))
    .replace(/\/+$/, "");
  const pathSegments = pattern.split("/");
  const descendantPrefixRegexes = pathSegments.slice(0, -1).map((_, index) => {
    const prefixBody = globToRegex(pathSegments.slice(0, index + 1).join("/"));
    return new RegExp(`${anchored ? "^" : "(^|/)"}${prefixBody}$`, caseInsensitive ? "i" : "");
  });

  return {
    negated,
    regex: new RegExp(`${prefix}${body}${suffix}`, caseInsensitive ? "i" : ""),
    anchored,
    literalPrefix,
    descendantPrefixRegexes,
  };
}

function toRules(patterns: readonly string[], caseInsensitive = false): IgnoreRule[] {
  return patterns.flatMap((pattern) => {
    const rule = patternToRule(pattern, caseInsensitive);
    return rule ? [rule] : [];
  });
}

const PROTECTED_RULES = toRules(PROTECTED_IGNORE_PATTERNS, true);

function normalizeIgnorePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function isProtectedPath(normalizedPath: string): boolean {
  return PROTECTED_RULES.some((rule) => rule.regex.test(normalizedPath));
}

function isProtected(relativePath: string): boolean {
  return isProtectedPath(normalizeIgnorePath(relativePath));
}

function negatedRuleTargetsDescendant(rule: IgnoreRule, normalizedPath: string): boolean {
  if (!rule.negated || rule.regex.test(normalizedPath)) return false;
  // A wildcard before the first literal segment can match a descendant below
  // any directory, so a protected directory stops that negation from ever
  // being evaluated on a concrete child.
  if (!rule.literalPrefix) {
    return !rule.anchored ||
      rule.descendantPrefixRegexes.some((prefix) => prefix.test(normalizedPath));
  }
  if (rule.descendantPrefixRegexes.some((prefix) => prefix.test(normalizedPath))) return true;
  const candidates = rule.anchored
    ? [normalizedPath]
    : normalizedPath.split("/").map((_, index, parts) => parts.slice(index).join("/"));
  return candidates.some((candidate) =>
    rule.literalPrefix === candidate || rule.literalPrefix.startsWith(`${candidate}/`)
  );
}

/**
 * Create an ignore checker with loaded patterns
 */
export function createIgnoreChecker(patterns: readonly string[]): IgnoreChecker {
  const rules = toRules(patterns);
  // A dropped negation silently changes what push and pull reconcile, so warn
  // at the default log level. Deduplicated per checker because every path is
  // tested many times during a single scan.
  const warnedOverrides = new Set<string>();

  function isIgnored(relativePath: string): boolean {
    const normalizedPath = normalizeIgnorePath(relativePath);
    let ignored = false;
    let lastMatchedRule: IgnoreRule | undefined;

    for (const rule of rules) {
      if (!rule.regex.test(normalizedPath)) continue;
      lastMatchedRule = rule;
      ignored = !rule.negated;
    }

    if (isProtectedPath(normalizedPath)) {
      const droppedNegation = lastMatchedRule?.negated ||
        rules.some((rule) => negatedRuleTargetsDescendant(rule, normalizedPath));
      if (droppedNegation && !isJsonMode() && !warnedOverrides.has(normalizedPath)) {
        warnedOverrides.add(normalizedPath);
        logWarning(
          `Ignoring protected path "${sanitizeTerminalDiagnosticText(normalizedPath)}". ` +
            "A .vfignore negation cannot re-include " +
            "a path under .env, .veryfront, or .git.",
        );
      }
      return true;
    }

    return ignored;
  }

  function isSupportedExtension(filename: string): boolean {
    const lastDot = filename.lastIndexOf(".");
    if (lastDot === -1) return false;
    return SUPPORTED_EXTENSIONS.has(filename.slice(lastDot).toLowerCase());
  }

  return { isIgnored, isProtected, isSupportedExtension };
}

/**
 * Create default ignore checker (without loading .vfignore)
 */
export function createDefaultIgnoreChecker(): IgnoreChecker {
  return createIgnoreChecker(DEFAULT_IGNORE_PATTERNS);
}
