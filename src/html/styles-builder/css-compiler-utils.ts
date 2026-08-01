/** Pure helper utilities for CSS compiler cache parsing and error classification. */

import { normalizeCSSCandidates } from "#veryfront/utils/css-candidate-admission.ts";
import { assertCSSOutputContent } from "#veryfront/utils/css-content-admission.ts";
import {
  MAX_CSS_OUTPUT_FILE_BYTES,
  MAX_CSS_SELECTOR_EVIDENCE_BYTES,
  MAX_CSS_SELECTOR_TOKEN_CHARACTERS,
  MAX_CSS_SELECTOR_TOKENS,
} from "#veryfront/utils/constants/css.ts";
import {
  assertCSSSerializedCacheValue,
  MAX_CSS_SERIALIZED_CACHE_ENTRY_BYTES,
  MAX_PROJECT_CSS_SERIALIZED_CACHE_ENTRY_BYTES,
} from "./css-cache-limits.ts";

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

export type SerializedCSSCacheFrameKind = "inputs" | "prepared" | "project" | "unified";
type SerializedCSSCacheFieldKind = "candidates" | "css" | "hash" | "stylesheet";

class MalformedSerializedCSSCacheFrame extends Error {}

interface ScannedJSONString {
  end: number;
  utf8Bytes: number;
  codeUnits: number;
}

function malformedSerializedCSSCacheFrame(): never {
  throw new MalformedSerializedCSSCacheFrame();
}

function skipJSONWhitespace(raw: string, start: number): number {
  let index = start;
  while (
    raw[index] === " " || raw[index] === "\n" || raw[index] === "\r" || raw[index] === "\t"
  ) {
    index++;
  }
  return index;
}

function hexadecimalCodeUnit(raw: string, start: number): number {
  if (start + 4 > raw.length) malformedSerializedCSSCacheFrame();
  let value = 0;
  for (let index = start; index < start + 4; index++) {
    const code = raw.charCodeAt(index);
    const digit = code >= 0x30 && code <= 0x39
      ? code - 0x30
      : code >= 0x41 && code <= 0x46
      ? code - 0x41 + 10
      : code >= 0x61 && code <= 0x66
      ? code - 0x61 + 10
      : -1;
    if (digit < 0) malformedSerializedCSSCacheFrame();
    value = value * 16 + digit;
  }
  return value;
}

function utf8Width(codeUnit: number): number {
  if (codeUnit <= 0x7f) return 1;
  if (codeUnit <= 0x7ff) return 2;
  return 3;
}

function scanJSONString(raw: string, start: number): ScannedJSONString {
  if (raw[start] !== '"') malformedSerializedCSSCacheFrame();
  let index = start + 1;
  let utf8Bytes = 0;
  let codeUnits = 0;

  while (index < raw.length) {
    const codeUnit = raw.charCodeAt(index);
    if (codeUnit === 0x22) {
      return { end: index + 1, utf8Bytes, codeUnits };
    }
    if (codeUnit <= 0x1f) malformedSerializedCSSCacheFrame();

    if (codeUnit === 0x5c) {
      const escape = raw.charCodeAt(index + 1);
      if (
        escape === 0x22 || escape === 0x2f || escape === 0x5c ||
        escape === 0x62 || escape === 0x66 || escape === 0x6e ||
        escape === 0x72 || escape === 0x74
      ) {
        utf8Bytes++;
        codeUnits++;
        index += 2;
        continue;
      }
      if (escape !== 0x75) malformedSerializedCSSCacheFrame();
      const escapedCodeUnit = hexadecimalCodeUnit(raw, index + 2);
      codeUnits++;
      index += 6;
      if (
        escapedCodeUnit >= 0xd800 && escapedCodeUnit <= 0xdbff &&
        raw[index] === "\\" && raw[index + 1] === "u"
      ) {
        const lowSurrogate = hexadecimalCodeUnit(raw, index + 2);
        if (lowSurrogate >= 0xdc00 && lowSurrogate <= 0xdfff) {
          codeUnits++;
          utf8Bytes += 4;
          index += 6;
          continue;
        }
      }
      utf8Bytes += escapedCodeUnit >= 0xd800 && escapedCodeUnit <= 0xdfff
        ? 3
        : utf8Width(escapedCodeUnit);
      continue;
    }

    codeUnits++;
    if (
      codeUnit >= 0xd800 && codeUnit <= 0xdbff &&
      index + 1 < raw.length
    ) {
      const nextCodeUnit = raw.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
        codeUnits++;
        utf8Bytes += 4;
        index += 2;
        continue;
      }
    }
    utf8Bytes += codeUnit >= 0xd800 && codeUnit <= 0xdfff ? 3 : utf8Width(codeUnit);
    index++;
  }

  return malformedSerializedCSSCacheFrame();
}

function resolveSerializedCSSCacheField(
  frameKind: SerializedCSSCacheFrameKind,
  key: string,
): SerializedCSSCacheFieldKind | undefined {
  if (frameKind === "unified") {
    if (key === "css" || key === "stylesheet" || key === "candidates") return key;
    return undefined;
  }
  if (frameKind === "inputs") {
    if (key === "stylesheet" || key === "candidates") return key;
    return undefined;
  }
  if (frameKind === "prepared") {
    if (key === "css" || key === "hash") return key;
    return undefined;
  }
  if (key === "css" || key === "hash") return key;
  if (key === "candidatesHash") return "hash";
  return undefined;
}

function scanCandidateArray(raw: string, start: number): number {
  if (raw[start] !== "[") {
    throw new TypeError("CSS cache candidates must be an array of strings");
  }
  let index = skipJSONWhitespace(raw, start + 1);
  if (raw[index] === "]") return index + 1;

  let candidates = 0;
  let evidenceBytes = 0;
  while (index < raw.length) {
    if (raw[index] !== '"') {
      throw new TypeError("CSS cache candidates must be an array of strings");
    }
    const candidate = scanJSONString(raw, index);
    candidates++;
    if (candidates > MAX_CSS_SELECTOR_TOKENS) {
      throw new TypeError(
        `CSS cache candidates cannot exceed ${MAX_CSS_SELECTOR_TOKENS} candidates`,
      );
    }
    if (candidate.codeUnits > MAX_CSS_SELECTOR_TOKEN_CHARACTERS) {
      throw new TypeError(
        `CSS cache candidates cannot exceed ${MAX_CSS_SELECTOR_TOKEN_CHARACTERS} characters per candidate`,
      );
    }
    if (candidate.utf8Bytes > MAX_CSS_SELECTOR_EVIDENCE_BYTES - evidenceBytes) {
      throw new TypeError(
        `CSS cache candidates cannot exceed ${MAX_CSS_SELECTOR_EVIDENCE_BYTES} UTF-8 bytes`,
      );
    }
    evidenceBytes += candidate.utf8Bytes;
    index = skipJSONWhitespace(raw, candidate.end);
    if (raw[index] === "]") return index + 1;
    if (raw[index] !== ",") malformedSerializedCSSCacheFrame();
    index = skipJSONWhitespace(raw, index + 1);
  }
  return malformedSerializedCSSCacheFrame();
}

export function preflightSerializedCSSCacheFrame(
  raw: string,
  frameKind: SerializedCSSCacheFrameKind,
): boolean {
  try {
    let index = skipJSONWhitespace(raw, 0);
    if (raw[index] !== "{") return false;
    index = skipJSONWhitespace(raw, index + 1);
    if (raw[index] === "}") return skipJSONWhitespace(raw, index + 1) === raw.length;

    const seen = new Set<string>();
    while (index < raw.length) {
      if (raw[index] !== '"') malformedSerializedCSSCacheFrame();
      const keyStart = index;
      const scannedKey = scanJSONString(raw, index);
      if (scannedKey.codeUnits > 32 || scannedKey.utf8Bytes > 32) {
        throw new TypeError("CSS cache serialized entry field name exceeds 32 characters");
      }
      const key = raw.slice(keyStart + 1, scannedKey.end - 1);
      if (key.includes("\\")) {
        throw new TypeError(
          "CSS cache serialized entry field names must use canonical JSON spelling",
        );
      }
      const fieldKind = resolveSerializedCSSCacheField(frameKind, key);
      if (!fieldKind) {
        throw new TypeError(`CSS cache serialized entry contains unsupported field "${key}"`);
      }
      if (seen.has(key)) {
        throw new TypeError(`CSS cache serialized entry contains duplicate field "${key}"`);
      }
      seen.add(key);

      index = skipJSONWhitespace(raw, scannedKey.end);
      if (raw[index] !== ":") malformedSerializedCSSCacheFrame();
      index = skipJSONWhitespace(raw, index + 1);
      if (fieldKind === "candidates") {
        index = scanCandidateArray(raw, index);
      } else {
        if (raw[index] !== '"') {
          throw new TypeError(`CSS cache ${key} must be a string`);
        }
        const value = scanJSONString(raw, index);
        const maximumBytes = fieldKind === "hash" ? 64 : MAX_CSS_OUTPUT_FILE_BYTES;
        if (value.utf8Bytes > maximumBytes) {
          throw new TypeError(`Cached CSS ${key} exceeds ${maximumBytes} bytes`);
        }
        index = value.end;
      }

      index = skipJSONWhitespace(raw, index);
      if (raw[index] === "}") {
        return skipJSONWhitespace(raw, index + 1) === raw.length;
      }
      if (raw[index] !== ",") malformedSerializedCSSCacheFrame();
      index = skipJSONWhitespace(raw, index + 1);
    }
    return false;
  } catch (error) {
    if (error instanceof MalformedSerializedCSSCacheFrame) return false;
    throw error;
  }
}

/** Read an exact own data property without consulting a parsed object's prototype. */
export function readOwnDataProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
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
  assertCSSSerializedCacheValue(raw, MAX_CSS_SERIALIZED_CACHE_ENTRY_BYTES);
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
  if (!preflightSerializedCSSCacheFrame(raw, "unified")) return undefined;

  let parsed: RawCSSCacheEntry;
  try {
    parsed = JSON.parse(raw) as RawCSSCacheEntry;
  } catch (_) {
    /* expected: malformed JSON in CSS cache entry */
    return undefined;
  }
  const css = readOwnDataProperty(parsed, "css");
  const candidates = readOwnDataProperty(parsed, "candidates");
  const stylesheet = readOwnDataProperty(parsed, "stylesheet");
  if (typeof css !== "string") return undefined;

  return buildCSSCacheEntry(
    css,
    {
      candidates: isStringArray(candidates) ? candidates : [],
      stylesheet: typeof stylesheet === "string" ? stylesheet : defaultStylesheet,
    },
    defaultStylesheet,
  );
}

export function parseProjectCSSCacheEntry(raw: string): ParsedProjectCSSCacheEntry | undefined {
  assertCSSSerializedCacheValue(raw, MAX_PROJECT_CSS_SERIALIZED_CACHE_ENTRY_BYTES);
  if (!preflightSerializedCSSCacheFrame(raw, "project")) return undefined;
  let parsed: RawProjectCSSCacheEntry;
  try {
    parsed = JSON.parse(raw) as RawProjectCSSCacheEntry;
  } catch (_) {
    /* expected: malformed JSON in project CSS cache entry */
    return undefined;
  }
  const css = readOwnDataProperty(parsed, "css");
  const hash = readOwnDataProperty(parsed, "hash");
  const candidatesHash = readOwnDataProperty(parsed, "candidatesHash");
  if (typeof css !== "string" || typeof hash !== "string" || typeof candidatesHash !== "string") {
    return undefined;
  }
  assertCSSOutputContent(css, "Cached project CSS output");

  return {
    css,
    hash,
    candidatesHash,
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
