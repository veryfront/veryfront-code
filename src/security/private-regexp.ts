import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";

const NativeRegExp = RegExp;
const apply = Reflect.apply;
const exec = RegExp.prototype.exec;
const replace = RegExp.prototype[Symbol.replace];
const source = Object.getOwnPropertyDescriptor(RegExp.prototype, "source")!.get!;
const flagNames = [
  ["hasIndices", "d"],
  ["global", "g"],
  ["ignoreCase", "i"],
  ["multiline", "m"],
  ["dotAll", "s"],
  ["unicode", "u"],
  ["unicodeSets", "v"],
  ["sticky", "y"],
] as const;
const flagGetters = flagNames.map(([name, flag]) => ({
  name,
  flag,
  get: Object.getOwnPropertyDescriptor(RegExp.prototype, name)?.get,
}));

/** Match private text without dispatching through a mutable matcher method. */
export function execPrivateRegExp(pattern: RegExp, text: string): RegExpExecArray | null {
  return apply(exec, copyPrivateMatcher(pattern), [text]) as RegExpExecArray | null;
}

/** Test private text with the captured native matcher. */
export function testPrivateRegExp(pattern: RegExp, text: string): boolean {
  return execPrivateRegExp(pattern, text) !== null;
}

function copyPrivateMatcher(pattern: RegExp): RegExp {
  let flags = "";
  const enabled: boolean[] = [];
  for (let index = 0; index < flagGetters.length; index++) {
    const entry = flagGetters[index]!;
    const active = entry.get !== undefined && apply(entry.get, pattern, []);
    defineOwnDataProperty(enabled, index, active as boolean);
    if (active) flags += entry.flag;
  }
  const matcher = new NativeRegExp(apply(source, pattern, []), flags);
  matcher.lastIndex = pattern.lastIndex;
  defineOwnDataProperty(matcher, "exec", exec);
  for (let index = 0; index < flagGetters.length; index++) {
    defineOwnDataProperty(matcher, flagGetters[index]!.name, enabled[index]);
  }
  return matcher;
}

/** Replace text using a private matcher without mutating caller-owned regex state. */
export function replacePrivateRegExp(pattern: RegExp, text: string, replacement: string): string {
  return apply(replace, copyPrivateMatcher(pattern), [text, replacement]) as string;
}
