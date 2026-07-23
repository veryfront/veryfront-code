/**
 * Tailwind CSS candidate extraction from source files.
 *
 * Extracts class name candidates from source code for Tailwind CSS compilation.
 *
 * @module html/styles-builder/candidate-extractor
 */

import type { StyleScopeProfile } from "./style-scope-profile.ts";
import { shouldIncludeStylePath } from "./style-scope-profile.ts";
import {
  MAX_CSS_CANDIDATE_BYTES,
  MAX_CSS_CANDIDATES,
  MAX_STYLE_SOURCE_FILE_BYTES,
  MAX_STYLE_SOURCE_FILES,
  MAX_STYLE_SOURCE_PATH_BYTES,
  MAX_TOTAL_CSS_CANDIDATE_BYTES,
  MAX_TOTAL_STYLE_SOURCE_BYTES,
  utf8ByteLength,
} from "./resource-limits.ts";

const CANDIDATE_PATTERN =
  /!?-?@?(?:[a-zA-Z0-9]|\[&?)[a-zA-Z0-9_\-:\/\.\[\]%#,()!'=<>$@{}|*+?;^~]*/g;
const MAX_INPUT_FILES = 100_000;

function byteLengthWithinLimit(value: string, limit: number, label: string): number {
  if (value.length > limit) throw new TypeError(`${label} exceeds the size limit`);
  const bytes = utf8ByteLength(value);
  if (bytes > limit) throw new TypeError(`${label} exceeds the size limit`);
  return bytes;
}

function addCandidates(
  content: string,
  candidates: Set<string>,
  currentCandidateBytes: number,
  maxContentBytes: number,
): number {
  byteLengthWithinLimit(content, maxContentBytes, "Candidate source content");
  CANDIDATE_PATTERN.lastIndex = 0;

  for (
    let match = CANDIDATE_PATTERN.exec(content);
    match;
    match = CANDIDATE_PATTERN.exec(content)
  ) {
    const candidate = match[0];
    if (candidates.has(candidate)) continue;
    const candidateBytes = byteLengthWithinLimit(
      candidate,
      MAX_CSS_CANDIDATE_BYTES,
      "CSS candidate",
    );
    if (candidates.size >= MAX_CSS_CANDIDATES) {
      throw new TypeError("Too many CSS candidates");
    }
    currentCandidateBytes += candidateBytes;
    if (currentCandidateBytes > MAX_TOTAL_CSS_CANDIDATE_BYTES) {
      throw new TypeError("CSS candidates exceed the total size limit");
    }
    candidates.add(candidate);
  }

  return currentCandidateBytes;
}

/**
 * Extract potential Tailwind class name candidates from source code content.
 * Uses a comprehensive regex pattern matching Tailwind v4 utility patterns.
 */
export function extractCandidates(content: string): string[] {
  if (typeof content !== "string") throw new TypeError("Candidate source content must be a string");
  const candidates = new Set<string>();
  addCandidates(content, candidates, 0, MAX_TOTAL_STYLE_SOURCE_BYTES);
  return [...candidates];
}

export function extractCandidatesFromFiles(
  files: Array<{ path: string; content?: string }>,
  options: {
    projectDir?: string;
    styleProfile?: StyleScopeProfile;
  } = {},
): Set<string> {
  if (!Array.isArray(files) || files.length > MAX_INPUT_FILES) {
    throw new TypeError("Style source file list exceeds the limit");
  }
  const candidates = new Set<string>();
  const sourceExtensions = [".tsx", ".jsx", ".ts", ".js", ".mdx"];
  let sourceFileCount = 0;
  let sourceBytes = 0;
  let candidateBytes = 0;

  for (const file of files) {
    if (
      !file || typeof file.path !== "string" || file.path.length === 0 ||
      file.path.length > MAX_STYLE_SOURCE_PATH_BYTES
    ) {
      throw new TypeError("Style source file path is invalid");
    }
    if (!file.content) continue;
    if (
      options.styleProfile &&
      !shouldIncludeStylePath(options.styleProfile, file.path, options.projectDir)
    ) {
      continue;
    }
    if (!sourceExtensions.some((ext) => file.path.endsWith(ext))) continue;
    if (typeof file.content !== "string") {
      throw new TypeError("Style source file content must be a string");
    }
    sourceFileCount++;
    if (sourceFileCount > MAX_STYLE_SOURCE_FILES) {
      throw new TypeError("Style source file count exceeds the limit");
    }
    const fileBytes = byteLengthWithinLimit(
      file.content,
      MAX_STYLE_SOURCE_FILE_BYTES,
      "Style source file",
    );
    sourceBytes += fileBytes;
    if (sourceBytes > MAX_TOTAL_STYLE_SOURCE_BYTES) {
      throw new TypeError("Style source files exceed the total size limit");
    }

    candidateBytes = addCandidates(
      file.content,
      candidates,
      candidateBytes,
      MAX_STYLE_SOURCE_FILE_BYTES,
    );
  }

  return candidates;
}

function hash32(bytes: Uint8Array, seed: number): number {
  let hash = seed >>> 0;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Compute a deterministic 64-bit hexadecimal hash from two independent FNV-1a streams. */
export function hashString(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const high = hash32(bytes, 0x811c9dc5).toString(16).padStart(8, "0");
  const low = hash32(bytes, 0x9e3779b9).toString(16).padStart(8, "0");
  return high + low;
}

export function hashCSS(css: string): string {
  return hashString(css);
}

/**
 * Hash a set of candidates for cache key generation.
 * Uses sorted array to ensure consistent hash regardless of Set iteration order.
 */
export function hashCandidates(candidates: Set<string>): string {
  return hashString(JSON.stringify(Array.from(candidates).sort()));
}
