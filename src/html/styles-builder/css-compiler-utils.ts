/** Pure helper utilities for CSS compiler cache parsing and error classification. */

import { normalizeCSSCandidates } from "#veryfront/utils/css-candidate-admission.ts";
import { assertCSSOutputContent } from "#veryfront/utils/css-content-admission.ts";

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
  const stylesheet = resolveStylesheet(inputs?.stylesheet, defaultStylesheet);
  assertCSSOutputContent(css, "Cached CSS output");
  assertCSSOutputContent(stylesheet, "Cached CSS regeneration stylesheet");
  return {
    css,
    candidates: inputs ? normalizeCandidates(inputs.candidates) : [],
    stylesheet,
  };
}

function normalizeCandidates(candidates: string[] | Set<string>): string[] {
  return normalizeCSSCandidates(candidates);
}

export function parseCSSCacheEntry(raw: string, defaultStylesheet: string): ParsedCSSCacheEntry {
  const parsed = tryParseStructuredCSSCacheEntry(raw, defaultStylesheet);
  if (parsed) return parsed;

  // Legacy format: plain CSS string (no inputs available)
  return buildCSSCacheEntry(raw, undefined, defaultStylesheet);
}

function tryParseStructuredCSSCacheEntry(
  raw: string,
  defaultStylesheet: string,
): ParsedCSSCacheEntry | undefined {
  if (!raw.startsWith("{")) return undefined;

  let parsed: RawCSSCacheEntry;
  try {
    parsed = JSON.parse(raw) as RawCSSCacheEntry;
  } catch (_) {
    /* expected: malformed JSON in CSS cache entry */
    return undefined;
  }
  if (typeof parsed.css !== "string") return undefined;

  return buildCSSCacheEntry(
    parsed.css,
    {
      candidates: isStringArray(parsed.candidates) ? parsed.candidates : [],
      stylesheet: typeof parsed.stylesheet === "string"
        ? parsed.stylesheet
        : defaultStylesheet,
    },
    defaultStylesheet,
  );
}

export function parseProjectCSSCacheEntry(raw: string): ParsedProjectCSSCacheEntry | undefined {
  let parsed: RawProjectCSSCacheEntry;
  try {
    parsed = JSON.parse(raw) as RawProjectCSSCacheEntry;
  } catch (_) {
    /* expected: malformed JSON in project CSS cache entry */
    return undefined;
  }
  if (
    typeof parsed.css !== "string" ||
    typeof parsed.hash !== "string" ||
    typeof parsed.candidatesHash !== "string"
  ) {
    return undefined;
  }
  assertCSSOutputContent(parsed.css, "Cached project CSS output");

  return {
    css: parsed.css,
    hash: parsed.hash,
    candidatesHash: parsed.candidatesHash,
  };
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
