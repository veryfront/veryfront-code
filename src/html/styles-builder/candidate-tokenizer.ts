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
// Sticky, so the remainder of an overlong run is consumed by one native scan
// instead of a character-at-a-time JS loop. MAX_CSS_FILE_BYTES admits inputs
// where a single base64 blob would otherwise cost millions of iterations.
const candidateRunPattern = new RegExp(`${candidateBodyCharacterClass}+`, "y");
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

/**
 * Index just past the remainder of a run that broke the token ceiling.
 *
 * One sticky match consumes the tail, so skipping stays linear in the source
 * rather than one JS iteration per character.
 */
function skipOverlongCandidateRun(content: string, index: number): number {
  candidateRunPattern.lastIndex = index;
  const run = apply(regExpExec, candidateRunPattern, [content]) as RegExpExecArray | null;
  return run === null ? index : index + run[0].length;
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
      // A run longer than the cap is data, not a class name: a base64 data URI
      // for an inline image or font, or the inline sourcemap esbuild writes into
      // the build cache, is one unbroken run of characters this class accepts.
      //
      // Skip the whole run rather than throwing. The throw propagated out of
      // getProjectCSS through generateHTMLShellPartsImpl, so it did not degrade
      // to an unstyled page -- it aborted shell generation and the request 500'd
      // for a token that could never have matched a rule.
      //
      // Both arms of the condition are load-bearing. The continuation check
      // catches a run that is still going when the match stops; the length check
      // catches one that ends cleanly but is over the cap anyway, which the head
      // `!?-?@?(?:[a-zA-Z0-9]|\[&?)` makes reachable because it admits up to five
      // characters on top of the pattern's MAX - 1 body. Dropping it emitted a
      // 1025-character candidate that then threw in normalizeCSSCandidates.
      if (
        candidate.length > MAX_CSS_SELECTOR_TOKEN_CHARACTERS ||
        hasCandidateContinuation(content, candidatePattern.lastIndex)
      ) {
        candidatePattern.lastIndex = skipOverlongCandidateRun(
          content,
          candidatePattern.lastIndex,
        );
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
