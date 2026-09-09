import {
  privateTextEndsWith,
  privateTextIncludes,
  privateTextStartsWith,
} from "#veryfront/security/private-text.ts";
import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";

const apply = Reflect.apply;
const regexpExec = RegExp.prototype.exec;
const regexpReplace = RegExp.prototype[Symbol.replace];
const trim = String.prototype.trim;
const toLowerCase = String.prototype.toLowerCase;

/** Captured operations for framework-owned artifact prompts and paths. */
export const privateArtifactText = Object.freeze({
  trim: (value: string): string => apply(trim, value, []),
  toLowerCase: (value: string): string => apply(toLowerCase, value, []),
  startsWith: privateTextStartsWith,
  endsWith: privateTextEndsWith,
  includes: privateTextIncludes,
  match(value: string, pattern: RegExp): RegExpExecArray | null {
    pattern.lastIndex = 0;
    return apply(regexpExec, pattern, [value]);
  },
  replace(value: string, pattern: RegExp, replacement: string): string {
    // Every caller owns its pattern. Pin exec so the captured replacement
    // intrinsic cannot redispatch private input through the mutable prototype.
    defineOwnDataProperty(pattern, "exec", regexpExec);
    return apply(regexpReplace, pattern, [value, replacement]);
  },
});
