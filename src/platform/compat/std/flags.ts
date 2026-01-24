/**
 * Portable @std/flags shim for Node.js and Bun.
 *
 * In Deno: Uses @std/flags
 * In Node.js/Bun: Provides a minimal arg parser implementation
 *
 * @module
 */

import { isDeno } from "../runtime.ts";

export interface ParseOptions {
  alias?: Record<string, string | string[]>;
  boolean?: string | string[] | boolean;
  string?: string | string[];
  default?: Record<string, unknown>;
  stopEarly?: boolean;
  collect?: string | string[];
  negatable?: string | string[];
  unknown?: (arg: string) => boolean;
  "--"?: boolean;
}

export interface Args {
  _: (string | number)[];
  "--"?: string[];
  [key: string]: unknown;
}

function parseValue(value: string): string | number | boolean {
  if (value === "true") return true;
  if (value === "false") return false;

  const num = Number(value);
  if (!isNaN(num) && value !== "") return num;

  return value;
}

function nodeParse(args: string[], options: ParseOptions = {}): Args {
  const result: Args = { _: [] };

  const alias = options.alias ?? {};
  const defaults = options.default ?? {};

  const booleans = new Set(
    options.boolean === true
      ? []
      : typeof options.boolean === "string"
      ? [options.boolean]
      : options.boolean ?? [],
  );

  const strings = new Set(
    typeof options.string === "string" ? [options.string] : options.string ?? [],
  );

  const aliasMap: Record<string, string> = {};
  const aliasGroups: Record<string, string[]> = {};

  for (const [key, aliases] of Object.entries(alias)) {
    const aliasList = Array.isArray(aliases) ? aliases : [aliases];

    for (const a of aliasList) aliasMap[a] = key;

    const group = [key, ...aliasList];
    aliasGroups[key] = group;
    for (const a of aliasList) aliasGroups[a] = group;
  }

  const collectKeys = new Set(
    options.collect
      ? typeof options.collect === "string" ? [options.collect] : options.collect
      : [],
  );

  function setWithAliases(key: string, value: unknown): void {
    const keysToSet = aliasGroups[key] ?? [key];

    for (const k of keysToSet) {
      if (!collectKeys.has(k)) {
        result[k] = value;
        continue;
      }

      if (!Array.isArray(result[k])) {
        result[k] = result[k] !== undefined ? [result[k]] : [];
      }
      (result[k] as unknown[]).push(value);
    }
  }

  for (const [key, value] of Object.entries(defaults)) {
    result[key] = value;
  }

  const negatables = options.negatable
    ? typeof options.negatable === "string" ? [options.negatable] : options.negatable
    : undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--") {
      const rest = args.slice(i + 1);
      if (options["--"]) result["--"] = rest;
      else result._.push(...rest);
      break;
    }

    if (arg.startsWith("--")) {
      const eqIndex = arg.indexOf("=");
      if (eqIndex !== -1) {
        const key = arg.slice(2, eqIndex);
        const value = arg.slice(eqIndex + 1);
        const realKey = aliasMap[key] ?? key;
        setWithAliases(realKey, strings.has(realKey) ? value : parseValue(value));
        continue;
      }

      const key = arg.slice(2);
      const realKey = aliasMap[key] ?? key;

      if (key.startsWith("no-") && negatables) {
        const baseKey = key.slice(3);
        if (negatables.includes(baseKey)) {
          setWithAliases(baseKey, false);
          continue;
        }
      }

      if (booleans.has(realKey) || options.boolean === true) {
        setWithAliases(realKey, true);
        continue;
      }

      const nextArg = args[i + 1];
      const hasValue = nextArg !== undefined && !nextArg.startsWith("-");

      if (strings.has(realKey)) {
        if (hasValue) {
          setWithAliases(realKey, nextArg);
          i++;
        } else {
          setWithAliases(realKey, "");
        }
        continue;
      }

      if (hasValue) {
        setWithAliases(realKey, parseValue(nextArg));
        i++;
      } else {
        setWithAliases(realKey, true);
      }
      continue;
    }

    if (arg.startsWith("-") && arg.length > 1) {
      const chars = arg.slice(1);
      const eqIndex = chars.indexOf("=");

      if (eqIndex !== -1) {
        const key = chars.slice(0, eqIndex);
        const value = chars.slice(eqIndex + 1);
        const realKey = aliasMap[key] ?? key;
        setWithAliases(realKey, strings.has(realKey) ? value : parseValue(value));
        continue;
      }

      if (chars.length === 1) {
        const key = chars;
        const realKey = aliasMap[key] ?? key;

        if (booleans.has(realKey) || options.boolean === true) {
          setWithAliases(realKey, true);
          continue;
        }

        const nextArg = args[i + 1];
        const hasValue = nextArg !== undefined && !nextArg.startsWith("-");

        if (hasValue) {
          setWithAliases(realKey, strings.has(realKey) ? nextArg : parseValue(nextArg));
          i++;
        } else {
          setWithAliases(realKey, true);
        }
        continue;
      }

      for (const char of chars) {
        const realKey = aliasMap[char] ?? char;
        setWithAliases(realKey, true);
      }
      continue;
    }

    if (options.stopEarly) {
      result._.push(arg, ...args.slice(i + 1));
      break;
    }

    result._.push(parseValue(arg));
  }

  return result;
}

export let parse: (args: string[], options?: ParseOptions) => Args;

if (isDeno) {
  const stdFlags = await import("#std/flags.ts");
  parse = stdFlags.parse as (args: string[], options?: ParseOptions) => Args;
} else {
  parse = nodeParse;
}
