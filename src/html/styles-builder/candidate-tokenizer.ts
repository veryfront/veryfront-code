/**
 * Dependency-free CSS candidate tokenization.
 *
 * Kept separate from project style-scope filtering so build tooling can reuse
 * the tokenizer without importing application configuration.
 *
 * @module html/styles-builder/candidate-tokenizer
 */

import {
  MAX_CSS_SELECTOR_TOKEN_CHARACTERS,
  MAX_CSS_SELECTOR_TOKENS,
} from "#veryfront/utils/constants/css.ts";
import { assertCSSFileContent } from "#veryfront/utils/css-content-admission.ts";

const candidatePattern = new RegExp(
  `!?-?@?(?:[a-zA-Z0-9]|\\[&?)[a-zA-Z0-9_\\-:\\/\\.\\[\\]%#,()!'=<>$@{}|*+?;^~]{0,${MAX_CSS_SELECTOR_TOKEN_CHARACTERS}}`,
  "g",
);

export interface ExtractedCSSCandidates {
  readonly candidates: string[];
  readonly sourceBytes: number;
}

/** Extract bounded candidates and report the admitted source byte length. */
export function extractCandidatesWithByteLength(
  content: string,
  label = "CSS candidate source",
): ExtractedCSSCandidates {
  const sourceBytes = assertCSSFileContent(content, label);
  const candidates = new Set<string>();
  candidatePattern.lastIndex = 0;

  try {
    let match: RegExpExecArray | null;
    while ((match = candidatePattern.exec(content)) !== null) {
      const candidate = match[0];
      if (candidate.length > MAX_CSS_SELECTOR_TOKEN_CHARACTERS) {
        throw new TypeError(
          `CSS candidate tokens cannot exceed ${MAX_CSS_SELECTOR_TOKEN_CHARACTERS} characters`,
        );
      }
      if (candidates.has(candidate)) continue;
      if (candidates.size >= MAX_CSS_SELECTOR_TOKENS) {
        throw new TypeError(
          `CSS source cannot contain more than ${MAX_CSS_SELECTOR_TOKENS} candidates`,
        );
      }
      candidates.add(candidate);
    }
  } finally {
    candidatePattern.lastIndex = 0;
  }

  return { candidates: [...candidates], sourceBytes };
}

/** Extract potential class-name candidates from source content. */
export function extractCandidates(content: string): string[] {
  return extractCandidatesWithByteLength(content).candidates;
}
