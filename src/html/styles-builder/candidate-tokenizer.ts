/** Bounded, dependency-free CSS candidate tokenization. */

import {
  MAX_CSS_SELECTOR_TOKEN_CHARACTERS,
  MAX_CSS_SELECTOR_TOKENS,
} from "#veryfront/utils/constants/css.ts";
import { assertCSSFileContent } from "#veryfront/utils/css-content-admission.ts";

const candidateBodyCharacterClass = "[a-zA-Z0-9_\\-:\\/\\.\\[\\]%#,()!'=<>$@{}|*+?;^~]";
const candidatePattern = new RegExp(
  `!?-?@?(?:[a-zA-Z0-9]|\\[&?)${candidateBodyCharacterClass}{0,${
    MAX_CSS_SELECTOR_TOKEN_CHARACTERS - 1
  }}`,
  "g",
);
const candidateContinuationPattern = new RegExp(candidateBodyCharacterClass);
const apply = Reflect.apply;
const NativeTypeError = TypeError;
const arrayPush = Array.prototype.push;
const regExpExec = RegExp.prototype.exec;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const SetConstructor = Set;
const stringCharAt = String.prototype.charAt;

function hasCandidateContinuation(content: string, index: number): boolean {
  if (index >= content.length) return false;
  const nextCharacter = apply(stringCharAt, content, [index]) as string;
  return apply(regExpExec, candidateContinuationPattern, [nextCharacter]) !== null;
}

export interface ExtractedCSSCandidates {
  readonly candidates: string[];
  readonly sourceBytes: number;
}

/** Extract a bounded, deduplicated candidate snapshot and admitted byte count. */
export function extractCandidatesWithByteLength(
  content: string,
  label = "CSS candidate source",
): ExtractedCSSCandidates {
  const sourceBytes = assertCSSFileContent(content, label);
  const candidates: string[] = [];
  const seenCandidates = new SetConstructor<string>();
  candidatePattern.lastIndex = 0;
  try {
    let match: RegExpExecArray | null;
    while (
      (match = apply(regExpExec, candidatePattern, [content]) as RegExpExecArray | null) !== null
    ) {
      const candidate = match[0];
      if (
        candidate.length > MAX_CSS_SELECTOR_TOKEN_CHARACTERS ||
        hasCandidateContinuation(content, candidatePattern.lastIndex)
      ) {
        // Skip the over-long run instead of aborting the extraction.
        //
        // This used to throw, and the throw reached generateHTMLShellParts, so
        // one oversized token anywhere in a page took down stylesheet
        // generation for that whole page -- the page rendered unstyled. A run
        // longer than the bound is not a plausible class name (a base64 data
        // URI or a minified blob in prose will do it), so dropping it loses
        // nothing, while dropping the stylesheet loses the site.
        //
        // The bound still holds: no candidate over the limit is emitted, and
        // advancing past the run keeps the scan moving without re-matching it.
        while (hasCandidateContinuation(content, candidatePattern.lastIndex)) {
          candidatePattern.lastIndex += 1;
        }
        continue;
      }
      if (apply(setHas, seenCandidates, [candidate])) continue;
      if (candidates.length >= MAX_CSS_SELECTOR_TOKENS) {
        throw new NativeTypeError(
          `CSS source cannot contain more than ${MAX_CSS_SELECTOR_TOKENS} candidates`,
        );
      }
      apply(setAdd, seenCandidates, [candidate]);
      apply(arrayPush, candidates, [candidate]);
    }
  } finally {
    candidatePattern.lastIndex = 0;
  }
  return { candidates, sourceBytes };
}

export function extractCandidates(content: string): string[] {
  return extractCandidatesWithByteLength(content).candidates;
}
