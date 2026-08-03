// Parsing behavior is adapted from @std/cli's MIT-licensed parse_args.ts.
/**
 * Cross-runtime command-line argument parser.
 *
 * This is one implementation for Deno, Node.js, and Bun so aliases, boolean
 * defaults, collection, negation, dotted keys, and unknown-argument handling
 * cannot drift by runtime.
 *
 * @module
 */

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
  _: Array<string | number>;
  "--"?: string[];
  [key: string]: unknown;
}

interface NestedMapping {
  [key: string]: NestedMapping | unknown;
}

const FLAG_PATTERN = /^(?:-(?:(?<doubleDash>-)(?<negated>no-)?)?)(?<key>.+?)(?:=(?<value>.*))?$/s;
const LETTER_PATTERN = /[A-Za-z]/;
const NUMBER_PATTERN = /-?\d+(\.\d*)?(e-?\d+)?$/;
const HYPHEN_PATTERN = /^(-|--)[^-]/;
const VALUE_PATTERN = /=(?<value>.+)/;
const LONG_FLAG_PATTERN = /^--[^=]+$/;
const SPECIAL_CHARACTER_PATTERN = /\W/;
const NON_WHITESPACE_PATTERN = /\S/;

function isNumber(value: string): boolean {
  return NON_WHITESPACE_PATTERN.test(value) &&
    Number.isFinite(Number(value));
}

function isBlockedObjectKey(object: NestedMapping, key: string): boolean {
  return key === "__proto__" ||
    (key === "constructor" && typeof object[key] === "function");
}

function setNested(
  target: NestedMapping,
  keys: readonly string[],
  value: unknown,
  collect = false,
): void {
  const remaining = [...keys];
  const key = remaining.pop();
  if (key === undefined || key.length === 0) return;

  for (const segment of remaining) {
    if (segment.length === 0 || isBlockedObjectKey(target, segment)) return;
    const existing = target[segment];
    if (existing === undefined) {
      const nested: NestedMapping = {};
      target[segment] = nested;
      target = nested;
      continue;
    }
    if (typeof existing !== "object" || existing === null) return;
    target = existing as NestedMapping;
  }

  if (isBlockedObjectKey(target, key)) return;

  if (collect) {
    const existing = target[key];
    if (Array.isArray(existing)) {
      existing.push(value);
      return;
    }
    value = Object.hasOwn(target, key) ? [existing, value] : [value];
  }

  target[key] = value;
}

function hasNested(target: NestedMapping, keys: readonly string[]): boolean {
  for (const key of keys) {
    if (!Object.hasOwn(target, key)) return false;
    const value = target[key];
    if (value === null || typeof value !== "object") {
      return key === keys.at(-1);
    }
    target = value as NestedMapping;
  }
  return true;
}

function aliasIsBoolean(
  aliases: ReadonlyMap<string, ReadonlySet<string>>,
  booleans: ReadonlySet<string>,
  key: string,
): boolean {
  const group = aliases.get(key);
  if (!group) return false;
  for (const alias of group) {
    if (booleans.has(alias)) return true;
  }
  return false;
}

function isBooleanString(value: string): boolean {
  return value === "true" || value === "false";
}

function parseBooleanString(value: unknown): boolean {
  return value !== "false";
}

function toArray(
  value: string | readonly string[] | undefined,
): readonly string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value as string];
}

/** Parse command-line arguments using the `@std/cli/parse-args` contract. */
export function parseArgs(
  inputArgs: readonly string[],
  options: ParseOptions = {},
): Args {
  const {
    "--": separateDoubleDash = false,
    alias = {},
    boolean = false,
    default: defaults = {},
    stopEarly = false,
    string = [],
    collect = [],
    negatable = [],
    unknown = () => true,
  } = options;

  const aliasMap = new Map<string, Set<string>>();
  const booleanSet = new Set<string>();
  const stringSet = new Set<string>();
  const collectSet = new Set<string>();
  const negatableSet = new Set<string>();
  let allLongFlagsAreBoolean = false;

  for (const [key, configuredAliases] of Object.entries(alias)) {
    if (configuredAliases === undefined) {
      throw new TypeError("Alias value must be defined");
    }
    const aliases = Array.isArray(configuredAliases)
      ? [...configuredAliases]
      : [configuredAliases as string];
    aliasMap.set(key, new Set(aliases));
    for (const aliasName of aliases) {
      aliasMap.set(
        aliasName,
        new Set([key, ...aliases.filter((value) => value !== aliasName)]),
      );
    }
  }

  if (typeof boolean === "boolean") {
    allLongFlagsAreBoolean = boolean;
  } else {
    addKeysAndAliases(booleanSet, toArray(boolean), aliasMap);
  }
  addKeysAndAliases(stringSet, toArray(string), aliasMap);
  addKeysAndAliases(collectSet, toArray(collect), aliasMap);
  addKeysAndAliases(negatableSet, toArray(negatable), aliasMap);

  const result: Args = { _: [] };
  const doubleDashIndex = inputArgs.indexOf("--");
  const trailingArgs = doubleDashIndex === -1 ? [] : inputArgs.slice(doubleDashIndex + 1);
  const args = doubleDashIndex === -1 ? [...inputArgs] : inputArgs.slice(0, doubleDashIndex);

  function setArgument(
    key: string,
    value: string | number | boolean,
    originalArgument: string,
    allowCollection: boolean,
  ): void {
    const known = booleanSet.has(key) ||
      stringSet.has(key) ||
      aliasMap.has(key) ||
      collectSet.has(key) ||
      (allLongFlagsAreBoolean && LONG_FLAG_PATTERN.test(originalArgument));
    if (!known && unknown(originalArgument, key, value) === false) return;

    if (typeof value === "string" && !stringSet.has(key) && isNumber(value)) {
      value = Number(value);
    }

    const shouldCollect = allowCollection && collectSet.has(key);
    setNested(result, key.split("."), value, shouldCollect);
    for (const aliasName of aliasMap.get(key) ?? []) {
      setNested(result, aliasName.split("."), value, shouldCollect);
    }
  }

  argsLoop:
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    const groups = argument.match(FLAG_PATTERN)?.groups;

    if (groups) {
      const isLongFlag = groups.doubleDash !== undefined;
      const isNegated = groups.negated !== undefined;
      let key = groups.key!;
      let value: string | number | boolean | undefined = groups.value;

      if (isLongFlag) {
        if (value !== undefined) {
          if (booleanSet.has(key)) value = parseBooleanString(value);
          setArgument(key, value, argument, true);
          continue;
        }

        if (isNegated) {
          if (negatableSet.has(key)) {
            setArgument(key, false, argument, false);
            continue;
          }
          key = `no-${key}`;
        }

        const next = args[index + 1];
        if (next !== undefined) {
          const acceptsValue = !booleanSet.has(key) &&
            !allLongFlagsAreBoolean &&
            !next.startsWith("-") &&
            (!aliasMap.has(key) ||
              !aliasIsBoolean(aliasMap, booleanSet, key));
          if (acceptsValue) {
            setArgument(key, next, argument, true);
            index++;
            continue;
          }
          if (isBooleanString(next)) {
            setArgument(key, parseBooleanString(next), argument, true);
            index++;
            continue;
          }
        }

        setArgument(
          key,
          stringSet.has(key) ? "" : true,
          argument,
          true,
        );
        continue;
      }

      const letters = argument.slice(1, -1).split("");
      for (const [letterIndex, letter] of letters.entries()) {
        const remainder = argument.slice(letterIndex + 2);

        if (remainder === "-") {
          setArgument(letter, remainder, argument, true);
          continue;
        }
        if (remainder === "=") {
          setArgument(letter, "", argument, true);
          continue argsLoop;
        }
        if (LETTER_PATTERN.test(letter)) {
          const inlineValue = VALUE_PATTERN.exec(remainder)?.groups?.value;
          if (inlineValue !== undefined) {
            setArgument(letter, inlineValue, argument, true);
            continue argsLoop;
          }
          if (NUMBER_PATTERN.test(remainder)) {
            setArgument(letter, remainder, argument, true);
            continue argsLoop;
          }
        }
        if (SPECIAL_CHARACTER_PATTERN.test(letters[letterIndex + 1] ?? "")) {
          setArgument(letter, argument.slice(letterIndex + 2), argument, true);
          continue argsLoop;
        }
        setArgument(
          letter,
          stringSet.has(letter) ? "" : true,
          argument,
          true,
        );
      }

      key = argument.slice(-1);
      if (key === "-") continue;

      const next = args[index + 1];
      if (next !== undefined) {
        const acceptsValue = !HYPHEN_PATTERN.test(next) &&
          !booleanSet.has(key) &&
          (!aliasMap.has(key) ||
            !aliasIsBoolean(aliasMap, booleanSet, key));
        if (acceptsValue) {
          setArgument(key, next, argument, true);
          index++;
          continue;
        }
        if (isBooleanString(next)) {
          setArgument(key, parseBooleanString(next), argument, true);
          index++;
          continue;
        }
      }

      setArgument(
        key,
        stringSet.has(key) ? "" : true,
        argument,
        true,
      );
      continue;
    }

    if (unknown(argument) !== false) {
      result._.push(
        stringSet.has("_") || !isNumber(argument) ? argument : Number(argument),
      );
    }
    if (stopEarly) {
      result._.push(...args.slice(index + 1));
      break;
    }
  }

  for (const [key, value] of Object.entries(defaults)) {
    const path = key.split(".");
    if (hasNested(result, path)) continue;
    setNested(result, path, value);
    for (const aliasName of aliasMap.get(key) ?? []) {
      setNested(result, aliasName.split("."), value);
    }
  }

  for (const key of booleanSet) {
    const path = key.split(".");
    if (!hasNested(result, path)) {
      setNested(result, path, collectSet.has(key) ? [] : false);
    }
  }
  for (const key of stringSet) {
    const path = key.split(".");
    if (!hasNested(result, path) && collectSet.has(key)) {
      setNested(result, path, []);
    }
  }

  if (separateDoubleDash) result["--"] = [...trailingArgs];
  else result._.push(...trailingArgs);

  return result;
}

function addKeysAndAliases(
  target: Set<string>,
  keys: readonly string[],
  aliases: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  for (const key of keys) {
    if (!key) continue;
    target.add(key);
    for (const alias of aliases.get(key) ?? []) target.add(alias);
  }
}

/** @deprecated Use {@link parseArgs}; retained for the former shim API. */
export const parse = parseArgs;
