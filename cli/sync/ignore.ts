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
  isIgnored(relativePath: string, options?: { isDirectory?: boolean }): boolean;

  /** Check if a path is protected even when a project ignore rule negates it. */
  isProtected(relativePath: string): boolean;

  /** Check if a file extension is supported */
  isSupportedExtension(filename: string): boolean;
}

interface IgnoreRule {
  negated: boolean;
  regex: RegExp;
  anchored: boolean;
  implicitDescendants: boolean;
  globTokens: GlobToken[];
}

type GlobToken =
  | { type: "literal"; value: string }
  | { type: "single" }
  | { type: "star" }
  | { type: "globstar-directory" }
  | { type: "double-star" };

const MAX_IGNORE_PATTERN_LENGTH = 4_096;
const MAX_IGNORE_PATTERN_SEGMENTS = 128;
const MAX_IGNORE_RULES = 1_024;
const MAX_IGNORE_FILE_LENGTH = 256 * 1_024;

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

  let content: string;
  try {
    content = await fs.readTextFile(ignorePath);
  } catch (error) {
    cliLogger.debug("Failed to read .vfignore:", error);
    throw new Error("Failed to read .vfignore. Fix the file permissions or path and try again.", {
      cause: error,
    });
  }
  if (content.length > MAX_IGNORE_FILE_LENGTH) {
    throw new Error(`.vfignore must not exceed ${MAX_IGNORE_FILE_LENGTH} characters.`);
  }
  const customPatterns = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (customPatterns.length > MAX_IGNORE_RULES) {
    throw new Error(`.vfignore must not contain more than ${MAX_IGNORE_RULES} rules.`);
  }
  patterns.push(...customPatterns);

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

function tokenizeGlob(pattern: string): GlobToken[] {
  const tokens: GlobToken[] = [];
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]!;
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        if (pattern[index + 2] === "/") {
          tokens.push({ type: "globstar-directory" });
          index += 2;
        } else {
          tokens.push({ type: "double-star" });
          index++;
        }
      } else {
        tokens.push({ type: "star" });
      }
    } else if (character === "?") {
      tokens.push({ type: "single" });
    } else {
      tokens.push({ type: "literal", value: character });
    }
  }
  return tokens;
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

  const pathSegments = pattern.split("/");
  if (
    pattern.length > MAX_IGNORE_PATTERN_LENGTH ||
    pathSegments.length > MAX_IGNORE_PATTERN_SEGMENTS
  ) {
    throw new Error(
      `.vfignore patterns must not exceed ${MAX_IGNORE_PATTERN_LENGTH} characters or ` +
        `${MAX_IGNORE_PATTERN_SEGMENTS} path segments.`,
    );
  }

  const hasSlash = pattern.includes("/");
  const hasGlob = /[*?]/.test(pattern);
  const body = globToRegex(pattern);
  const prefix = anchored ? "^" : "(^|/)";
  const suffix = directoryOnly || (!hasSlash && !hasGlob) ? "(/|$)" : "$";
  return {
    negated,
    regex: new RegExp(`${prefix}${body}${suffix}`, caseInsensitive ? "i" : ""),
    anchored,
    implicitDescendants: directoryOnly || !hasSlash && !hasGlob,
    globTokens: tokenizeGlob(pattern),
  };
}

function toRules(
  patterns: readonly string[],
  caseInsensitive = false,
  maxRules = MAX_IGNORE_RULES,
): IgnoreRule[] {
  if (patterns.length > maxRules) {
    throw new Error(`.vfignore must not contain more than ${MAX_IGNORE_RULES} rules.`);
  }
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

function epsilonClosure(tokens: readonly GlobToken[], states: ReadonlySet<number>): Set<number> {
  const closure = new Set(states);
  const pending = [...states];
  while (pending.length > 0) {
    const state = pending.pop()!;
    const token = tokens[state];
    if (
      token?.type !== "star" && token?.type !== "double-star" &&
      token?.type !== "globstar-directory"
    ) continue;
    const next = state + 1;
    if (closure.has(next)) continue;
    closure.add(next);
    pending.push(next);
  }
  return closure;
}

function anchoredGlobCanMatchDescendant(
  tokens: readonly GlobToken[],
  normalizedPath: string,
): boolean {
  let states = epsilonClosure(tokens, new Set([0]));
  const prefix = `${normalizedPath}/`;
  for (let pathIndex = 0; pathIndex < prefix.length; pathIndex++) {
    const character = prefix[pathIndex]!;
    const nextStates = new Set<number>();
    for (const state of states) {
      const token = tokens[state];
      if (token?.type === "literal" && token.value === character) {
        nextStates.add(state + 1);
      } else if (token?.type === "single" && character !== "/") {
        nextStates.add(state + 1);
      } else if (token?.type === "star" && character !== "/") {
        nextStates.add(state);
      } else if (token?.type === "double-star" || token?.type === "globstar-directory") {
        nextStates.add(state);
      }
    }
    states = epsilonClosure(tokens, nextStates);
    if (states.size === 0) return false;
  }
  return states.size > 0;
}

function anchoredGlobCoversEveryDescendant(
  tokens: readonly GlobToken[],
  normalizedPath: string,
): boolean {
  let states = epsilonClosure(tokens, new Set([0]));
  const prefix = `${normalizedPath}/`;
  for (let pathIndex = 0; pathIndex < prefix.length; pathIndex++) {
    const character = prefix[pathIndex]!;
    const nextStates = new Set<number>();
    for (const state of states) {
      const token = tokens[state];
      if (token?.type === "literal" && token.value === character) {
        nextStates.add(state + 1);
      } else if (token?.type === "single" && character !== "/") {
        nextStates.add(state + 1);
      } else if (token?.type === "star" && character !== "/") {
        nextStates.add(state);
      } else if (token?.type === "double-star" || token?.type === "globstar-directory") {
        nextStates.add(state);
      }
    }
    states = epsilonClosure(tokens, nextStates);
    if (states.size === 0) return false;
  }

  for (const state of states) {
    const token = tokens[state];
    if (token?.type === "double-star") {
      if (epsilonClosure(tokens, new Set([state + 1])).has(tokens.length)) return true;
    }
    if (
      token?.type === "globstar-directory" && tokens[state + 1]?.type === "star" &&
      epsilonClosure(tokens, new Set([state + 2])).has(tokens.length)
    ) return true;
  }
  return false;
}

function negatedRuleTargetsDescendant(rule: IgnoreRule, normalizedPath: string): boolean {
  if (!rule.negated) return false;
  // An unanchored rule can begin at any descendant segment below this
  // protected directory, even when none of its literal segments are present
  // in the directory path itself.
  if (!rule.anchored) return true;
  if (rule.regex.test(`${normalizedPath}/__veryfront_probe__.json`)) return true;
  return anchoredGlobCanMatchDescendant(rule.globTokens, normalizedPath);
}

function hasEffectiveDescendantNegation(
  rules: readonly IgnoreRule[],
  normalizedPath: string,
  canceledNegations: ReadonlySet<IgnoreRule>,
): boolean {
  let lastBroadIgnoreIndex = -1;
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index]!;
    if (
      !rule.negated &&
      (rule.implicitDescendants && rule.regex.test(normalizedPath) ||
        rule.anchored && anchoredGlobCoversEveryDescendant(rule.globTokens, normalizedPath))
    ) {
      lastBroadIgnoreIndex = index;
    }
  }
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index]!;
    if (!negatedRuleTargetsDescendant(rule, normalizedPath)) continue;
    if (index < lastBroadIgnoreIndex) continue;
    if (!canceledNegations.has(rule)) return true;
  }
  return false;
}

function collectCanceledNegations(rules: readonly IgnoreRule[]): ReadonlySet<IgnoreRule> {
  const canceled = new Set<IgnoreRule>();
  const laterPositivePatterns = new Set<string>();
  const laterPositiveRules: IgnoreRule[] = [];
  for (let index = rules.length - 1; index >= 0; index--) {
    const rule = rules[index]!;
    const signature = `${rule.regex.source}\u0000${rule.regex.flags}`;
    if (rule.negated) {
      let literalPath = "";
      for (const token of rule.globTokens) {
        if (token.type !== "literal") {
          literalPath = "";
          break;
        }
        literalPath += token.value;
      }
      if (
        laterPositivePatterns.has(signature) ||
        (literalPath.length > 0 && laterPositiveRules.some((positive) => {
          if (!(rule.anchored || !positive.anchored) || !positive.regex.test(literalPath)) {
            return false;
          }
          return !rule.implicitDescendants || positive.implicitDescendants;
        }))
      ) {
        canceled.add(rule);
      }
    } else {
      laterPositivePatterns.add(signature);
      laterPositiveRules.push(rule);
    }
  }
  return canceled;
}

/**
 * Create an ignore checker with loaded patterns
 */
export function createIgnoreChecker(patterns: readonly string[]): IgnoreChecker {
  const hasDefaultPrefix = DEFAULT_IGNORE_PATTERNS.every(
    (pattern, index) => patterns[index] === pattern,
  );
  const rules = toRules(
    patterns,
    false,
    hasDefaultPrefix ? MAX_IGNORE_RULES + DEFAULT_IGNORE_PATTERNS.length : MAX_IGNORE_RULES,
  );
  const canceledNegations = collectCanceledNegations(rules);
  // A dropped negation silently changes what push and pull reconcile, so warn
  // at the default log level. Deduplicated per checker because every path is
  // tested many times during a single scan.
  const warnedOverrides = new Set<string>();

  function isIgnored(relativePath: string, options: { isDirectory?: boolean } = {}): boolean {
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
        (options.isDirectory === true &&
          hasEffectiveDescendantNegation(rules, normalizedPath, canceledNegations));
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
