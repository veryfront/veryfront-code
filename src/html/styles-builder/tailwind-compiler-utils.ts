/**
 * Pure helper utilities for Tailwind compiler cache parsing and error classification.
 */

export interface ParsedCSSCacheEntry {
  css: string;
  candidates: string[];
  stylesheet: string;
}

export interface ParsedProjectCSSCacheEntry {
  css: string;
  hash: string;
  candidatesHash: string;
}

export interface CSSErrorDescriptor {
  title: string;
  message: string;
  suggestion: string;
}

export type ProjectCSSLocalCacheState = "miss" | "expired" | "mismatch" | "hit";

interface RawCSSCacheEntry {
  css?: unknown;
  candidates?: unknown;
  stylesheet?: unknown;
}

interface RawProjectCSSCacheEntry {
  css?: unknown;
  hash?: unknown;
  candidatesHash?: unknown;
}

interface CSSErrorRule {
  matches: (message: string) => boolean;
  format: (message: string) => CSSErrorDescriptor;
}

export function resolveStylesheet(
  stylesheet: string | undefined,
  defaultStylesheet: string,
): string {
  return stylesheet ?? defaultStylesheet;
}

export function buildCSSCacheEntry(
  css: string,
  inputs: { candidates: string[] | Set<string>; stylesheet: string } | undefined,
  defaultStylesheet: string,
): ParsedCSSCacheEntry {
  return {
    css,
    candidates: inputs ? normalizeCandidates(inputs.candidates) : [],
    stylesheet: resolveStylesheet(inputs?.stylesheet, defaultStylesheet),
  };
}

function normalizeCandidates(candidates: string[] | Set<string>): string[] {
  return Array.isArray(candidates) ? candidates : [...candidates];
}

export function parseCSSCacheEntry(raw: string, defaultStylesheet: string): ParsedCSSCacheEntry {
  const parsed = tryParseStructuredCSSCacheEntry(raw, defaultStylesheet);
  if (parsed) return parsed;

  // Legacy format: plain CSS string (no inputs available)
  return {
    css: raw,
    candidates: [],
    stylesheet: defaultStylesheet,
  };
}

function tryParseStructuredCSSCacheEntry(
  raw: string,
  defaultStylesheet: string,
): ParsedCSSCacheEntry | undefined {
  if (!raw.startsWith("{")) return undefined;

  try {
    const parsed = JSON.parse(raw) as RawCSSCacheEntry;
    if (typeof parsed.css !== "string") return undefined;

    return {
      css: parsed.css,
      candidates: isStringArray(parsed.candidates) ? parsed.candidates : [],
      stylesheet: typeof parsed.stylesheet === "string" ? parsed.stylesheet : defaultStylesheet,
    };
  } catch {
    return undefined;
  }
}

export function parseProjectCSSCacheEntry(raw: string): ParsedProjectCSSCacheEntry | undefined {
  try {
    const parsed = JSON.parse(raw) as RawProjectCSSCacheEntry;
    if (
      typeof parsed.css !== "string" ||
      typeof parsed.hash !== "string" ||
      typeof parsed.candidatesHash !== "string"
    ) {
      return undefined;
    }

    return {
      css: parsed.css,
      hash: parsed.hash,
      candidatesHash: parsed.candidatesHash,
    };
  } catch {
    return undefined;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function evaluateProjectCSSLocalCacheState(
  entry: { expiresAt: number; candidatesHash: string } | undefined,
  candidatesHash: string,
  now = Date.now(),
): ProjectCSSLocalCacheState {
  if (!entry) return "miss";
  if (now > entry.expiresAt) return "expired";
  if (entry.candidatesHash !== candidatesHash) return "mismatch";
  return "hit";
}

const CSS_ERROR_RULES: CSSErrorRule[] = [
  {
    matches: (message) => message.includes("does not accept options"),
    format: (message) => {
      const pluginName = extractQuotedToken(message) ?? "unknown plugin";
      return {
        title: "Plugin Options Not Supported",
        message: `${pluginName} does not accept options in Tailwind CSS v4`,
        suggestion: `Remove the options block from @plugin. Use: @plugin "${pluginName}";`,
      };
    },
  },
  {
    matches: (message) =>
      message.includes("Could not resolve") || message.includes("Failed to load plugin"),
    format: (message) => {
      const pluginName = extractPluginName(message) ?? "unknown";
      return {
        title: "Plugin Not Found",
        message: `Could not load plugin: ${pluginName}`,
        suggestion: `Check the plugin name is correct. Try: https://esm.sh/${pluginName}`,
      };
    },
  },
  {
    matches: (message) => message.includes("@theme") || message.includes("Invalid theme"),
    format: (message) => ({
      title: "Invalid @theme",
      message,
      suggestion: "Check @theme syntax: @theme { --color-name: value; }",
    }),
  },
  {
    matches: (message) => message.includes("Unexpected") || message.includes("Expected"),
    format: (message) => ({
      title: "CSS Syntax Error",
      message,
      suggestion: "Check for missing semicolons, brackets, or typos",
    }),
  },
];

function extractQuotedToken(message: string): string | undefined {
  const match = message.match(/"([^"]+)"/);
  return match?.[1];
}

function extractPluginName(message: string): string | undefined {
  const pluginMatch = message.match(/plugin\s*["']([^"']+)["']/i) ?? message.match(/"([^"]+)"/);
  return pluginMatch?.[1];
}

export function formatCSSErrorMessage(message: string): CSSErrorDescriptor {
  for (const rule of CSS_ERROR_RULES) {
    if (rule.matches(message)) {
      return rule.format(message);
    }
  }

  return {
    title: "Tailwind CSS Error",
    message,
    suggestion: "Check your stylesheet for errors",
  };
}
