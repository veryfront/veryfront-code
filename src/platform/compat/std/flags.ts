/**
 * Portable argument parsing compatible with `@std/cli/parse-args`.
 *
 * Deno delegates to the standard library. Node.js and Bun use the same
 * parsing semantics locally so repository scripts behave consistently.
 *
 * @module
 */

import { isDeno } from "../runtime.ts";

export interface ParseOptions {
  "--"?: boolean;
  alias?: Record<string, string | readonly string[] | undefined>;
  boolean?: string | readonly string[] | boolean;
  default?: Record<string, unknown>;
  stopEarly?: boolean;
  string?: string | readonly string[];
  collect?: string | readonly string[];
  negatable?: string | readonly string[];
  unknown?: (arg: string, key?: string, value?: unknown) => unknown;
}

export interface Args {
  _: (string | number)[];
  "--"?: string[];
  [key: string]: unknown;
}

interface NestedMapping {
  [key: string]: NestedMapping | unknown;
}

const FLAG_REGEXP = /^(?:-(?:(?<doubleDash>-)(?<negated>no-)?)?)(?<key>.+?)(?:=(?<value>.*))?$/s;
const LETTER_REGEXP = /[A-Za-z]/;
const NUMBER_REGEXP = /-?\d+(\.\d*)?(e-?\d+)?$/;
const HYPHEN_REGEXP = /^(-|--)[^-]/;
const VALUE_REGEXP = /=(?<value>.+)/;
const FLAG_NAME_REGEXP = /^--[^=]+$/;
const SPECIAL_CHAR_REGEXP = /\W/;
const NON_WHITESPACE_REGEXP = /\S/;

function isNumber(value: string): boolean {
  return NON_WHITESPACE_REGEXP.test(value) && Number.isFinite(Number(value));
}

function isConstructorOrProto(object: NestedMapping, key: string): boolean {
  return (key === "constructor" && typeof object[key] === "function") ||
    key === "__proto__";
}

function setNested(
  object: NestedMapping,
  inputKeys: string[],
  inputValue: unknown,
  collect = false,
): void {
  const keys = [...inputKeys];
  const key = keys.pop()!;

  for (const nestedKey of keys) {
    if (isConstructorOrProto(object, nestedKey)) return;
    object = (object[nestedKey] ??= {}) as NestedMapping;
  }

  if (isConstructorOrProto(object, key)) return;

  let value = inputValue;
  if (collect) {
    const current = object[key];
    if (Array.isArray(current)) {
      current.push(value);
      return;
    }
    value = current ? [current, value] : [value];
  }

  object[key] = value;
}

function hasNested(object: NestedMapping, keys: string[]): boolean {
  for (const key of keys) {
    const value = object[key];
    if (!Object.hasOwn(object, key)) return false;
    object = value as NestedMapping;
  }
  return true;
}

function aliasIsBoolean(
  aliasMap: Map<string, Set<string>>,
  booleanSet: Set<string>,
  key: string,
): boolean {
  const aliases = aliasMap.get(key);
  if (aliases === undefined) return false;
  for (const alias of aliases) if (booleanSet.has(alias)) return true;
  return false;
}

function isBooleanString(value: string): boolean {
  return value === "true" || value === "false";
}

function parseBooleanString(value: unknown): boolean {
  return value !== "false";
}

function nodeParseArgs(
  inputArgs: readonly string[],
  options: ParseOptions = {},
): Args {
  const {
    "--": doubleDash = false,
    alias = {},
    boolean = false,
    default: defaults = {},
    stopEarly = false,
    string = [],
    collect = [],
    negatable = [],
    unknown: unknownFn = (value: string): unknown => value,
  } = options;
  const aliasMap = new Map<string, Set<string>>();
  const booleanSet = new Set<string>();
  const stringSet = new Set<string>();
  const collectSet = new Set<string>();
  const negatableSet = new Set<string>();
  let allBools = false;

  for (const [key, value] of Object.entries(alias)) {
    if (value === undefined) throw new TypeError("Alias value must be defined");
    const aliases = Array.isArray(value) ? value : [value];
    aliasMap.set(key, new Set(aliases));
    aliases.forEach((alias) => {
      aliasMap.set(
        alias,
        new Set([key, ...aliases.filter((candidate) => candidate !== alias)]),
      );
    });
  }

  if (boolean) {
    if (typeof boolean === "boolean") {
      allBools = boolean;
    } else {
      const booleanArgs = Array.isArray(boolean) ? boolean : [boolean];
      for (const key of booleanArgs.filter(Boolean)) {
        booleanSet.add(key);
        aliasMap.get(key)?.forEach((alias) => booleanSet.add(alias));
      }
    }
  }

  if (string) {
    const stringArgs = Array.isArray(string) ? string : [string];
    for (const key of stringArgs.filter(Boolean)) {
      stringSet.add(key);
      aliasMap.get(key)?.forEach((alias) => stringSet.add(alias));
    }
  }

  if (collect) {
    const collectArgs = Array.isArray(collect) ? collect : [collect];
    for (const key of collectArgs.filter(Boolean)) {
      collectSet.add(key);
      aliasMap.get(key)?.forEach((alias) => collectSet.add(alias));
    }
  }

  if (negatable) {
    const negatableArgs = Array.isArray(negatable) ? negatable : [negatable];
    for (const key of negatableArgs.filter(Boolean)) {
      negatableSet.add(key);
      aliasMap.get(key)?.forEach((alias) => negatableSet.add(alias));
    }
  }

  const parsed: Args = { _: [] };

  function setArgument(
    key: string,
    inputValue: string | number | boolean,
    arg: string,
    collectValue: boolean,
  ): void {
    if (
      !booleanSet.has(key) &&
      !stringSet.has(key) &&
      !aliasMap.has(key) &&
      !collectSet.has(key) &&
      !(allBools && FLAG_NAME_REGEXP.test(arg)) &&
      unknownFn(arg, key, inputValue) === false
    ) {
      return;
    }

    const value = typeof inputValue === "string" && !stringSet.has(key) &&
        isNumber(inputValue)
      ? Number(inputValue)
      : inputValue;
    const collectable = collectValue && collectSet.has(key);
    setNested(parsed, key.split("."), value, collectable);
    aliasMap.get(key)?.forEach((alias) => {
      setNested(parsed, alias.split("."), value, collectable);
    });
  }

  let args = inputArgs;
  let notFlags: readonly string[] = [];
  const doubleDashIndex = args.indexOf("--");
  if (doubleDashIndex !== -1) {
    notFlags = args.slice(doubleDashIndex + 1);
    args = args.slice(0, doubleDashIndex);
  }

  argsLoop:
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    const groups = arg.match(FLAG_REGEXP)?.groups;

    if (groups) {
      const { doubleDash: isDoubleDash, negated } = groups;
      let key = groups.key!;
      let value: string | number | boolean | undefined = groups.value;

      if (isDoubleDash) {
        if (value != null) {
          if (booleanSet.has(key)) value = parseBooleanString(value);
          setArgument(key, value, arg, true);
          continue;
        }

        if (negated) {
          if (negatableSet.has(key)) {
            setArgument(key, false, arg, false);
            continue;
          }
          key = `no-${key}`;
        }

        const next = args[index + 1];
        if (next) {
          if (
            !booleanSet.has(key) &&
            !allBools &&
            !next.startsWith("-") &&
            (!aliasMap.has(key) || !aliasIsBoolean(aliasMap, booleanSet, key))
          ) {
            index++;
            setArgument(key, next, arg, true);
            continue;
          }
          if (isBooleanString(next)) {
            index++;
            setArgument(key, parseBooleanString(next), arg, true);
            continue;
          }
        }

        setArgument(key, stringSet.has(key) ? "" : true, arg, true);
        continue;
      }

      const letters = arg.slice(1, -1).split("");
      for (const [letterIndex, letter] of letters.entries()) {
        const next = arg.slice(letterIndex + 2);
        if (next === "-") {
          setArgument(letter, next, arg, true);
          continue;
        }
        if (next === "=") {
          setArgument(letter, "", arg, true);
          continue argsLoop;
        }
        if (LETTER_REGEXP.test(letter)) {
          const valueGroups = VALUE_REGEXP.exec(next)?.groups;
          if (valueGroups) {
            setArgument(letter, valueGroups.value!, arg, true);
            continue argsLoop;
          }
          if (NUMBER_REGEXP.test(next)) {
            setArgument(letter, next, arg, true);
            continue argsLoop;
          }
        }
        if (letters[letterIndex + 1]?.match(SPECIAL_CHAR_REGEXP)) {
          setArgument(letter, arg.slice(letterIndex + 2), arg, true);
          continue argsLoop;
        }
        setArgument(letter, stringSet.has(letter) ? "" : true, arg, true);
      }

      key = arg.slice(-1);
      if (key === "-") continue;
      const next = args[index + 1];
      if (next) {
        if (
          !HYPHEN_REGEXP.test(next) &&
          !booleanSet.has(key) &&
          (!aliasMap.has(key) || !aliasIsBoolean(aliasMap, booleanSet, key))
        ) {
          setArgument(key, next, arg, true);
          index++;
          continue;
        }
        if (isBooleanString(next)) {
          setArgument(key, parseBooleanString(next), arg, true);
          index++;
          continue;
        }
      }
      setArgument(key, stringSet.has(key) ? "" : true, arg, true);
      continue;
    }

    if (unknownFn(arg) !== false) {
      parsed._.push(stringSet.has("_") || !isNumber(arg) ? arg : Number(arg));
    }
    if (stopEarly) {
      parsed._.push(...args.slice(index + 1));
      break;
    }
  }

  for (const [key, value] of Object.entries(defaults)) {
    const keys = key.split(".");
    if (!hasNested(parsed, keys)) {
      setNested(parsed, keys, value);
      aliasMap.get(key)?.forEach((alias) => {
        setNested(parsed, alias.split("."), value);
      });
    }
  }

  for (const key of booleanSet) {
    const keys = key.split(".");
    if (!hasNested(parsed, keys)) {
      setNested(parsed, keys, collectSet.has(key) ? [] : false);
    }
  }

  for (const key of stringSet) {
    const keys = key.split(".");
    if (!hasNested(parsed, keys) && collectSet.has(key)) {
      setNested(parsed, keys, []);
    }
  }

  if (doubleDash) parsed["--"] = [...notFlags];
  else parsed._.push(...notFlags);
  return parsed;
}

export let parseArgs: (
  args: readonly string[],
  options?: ParseOptions,
) => Args;

if (isDeno) {
  const stdFlags = await import("#std/flags.ts");
  parseArgs = stdFlags.parseArgs as typeof parseArgs;
} else {
  parseArgs = nodeParseArgs;
}

/** @deprecated Use {@linkcode parseArgs}. */
export { parseArgs as parse };
