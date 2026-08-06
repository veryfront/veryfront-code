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

/**
 * Advance past the remainder of a run that exceeded the token ceiling.
 *
 * The run is discarded whole rather than split: a fragment of it is not a
 * candidate anybody wrote, and emitting fragments would pollute the snapshot.
 * Each character is visited once, so skipping stays linear in the source.
 */
function skipOverlongCandidateRun(content: string, index: number): number {
  let cursor = index;
  while (cursor < content.length) {
    const character = apply(stringCharAt, content, [cursor]) as string;
    if (apply(regExpExec, candidateContinuationPattern, [character]) === null) break;
    cursor++;
  }
  return cursor;
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
        // A run this long is not a class anyone authored -- an inline base64
        // sourcemap is the common case, and its alphabet lies entirely inside
        // the candidate body class. Skip it. Failing here would take down the
        // whole render or release for a token that could never match a rule.
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
