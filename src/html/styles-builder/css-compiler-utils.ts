/** Pure helper utilities for CSS compiler cache parsing and error classification. */

interface ParsedCSSCacheEntry {
  css: string;
  candidates: string[];
  stylesheet: string;
}

interface ParsedProjectCSSCacheEntry {
  css: string;
  hash: string;
  candidatesHash: string;
}

interface CSSErrorDescriptor {
  title: string;
  message: string;
  suggestion: string;
}

type ProjectCSSLocalCacheState = "miss" | "expired" | "mismatch" | "hit";

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
  } catch (_) {
    /* expected: malformed JSON in CSS cache entry */
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
  } catch (_) {
    /* expected: malformed JSON in project CSS cache entry */
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

export function formatCSSErrorMessage(message: string): CSSErrorDescriptor {
  if (message.includes("Unexpected") || message.includes("Expected")) {
    return {
      title: "CSS Syntax Error",
      message,
      suggestion: "Check the stylesheet syntax reported by the configured CSS processor",
    };
  }

  return {
    title: "CSS Compilation Error",
    message,
    suggestion: "Check your stylesheet for errors",
  };
}
