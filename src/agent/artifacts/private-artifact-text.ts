import {
  privateTextEndsWith,
  privateTextIncludes,
  privateTextStartsWith,
  privateTextToLowerCase,
  privateTextTrim,
} from "#veryfront/security/private-text.ts";
import { execPrivateRegExp, replacePrivateRegExp } from "#veryfront/security/private-regexp.ts";

/** Captured operations for framework-owned artifact prompts and paths. */
export const privateArtifactText = Object.freeze({
  trim: privateTextTrim,
  toLowerCase: privateTextToLowerCase,
  startsWith: privateTextStartsWith,
  endsWith: privateTextEndsWith,
  includes: privateTextIncludes,
  match(value: string, pattern: RegExp): RegExpExecArray | null {
    return execPrivateRegExp(pattern, value);
  },
  replace(value: string, pattern: RegExp, replacement: string): string {
    return replacePrivateRegExp(pattern, value, replacement);
  },
});
