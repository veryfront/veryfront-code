/**
 * Portable @std/flags shim for Node.js and Bun.
 *
 * In Deno: Uses @std/flags
 * In Node.js/Bun: Provides a minimal arg parser implementation
 *
 * @module
 */

import { isDeno } from "../runtime.ts";

interface ParseOptions {
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

function toStringArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getBooleanKeys(value: string | string[] | boolean | undefined): string[] {
  if (value === true || !value) return [];
  return Array.isArray(value) ? value : [value];
}

function nodeParse(args: string[], options: ParseOptions = {}): Args {
  const result: Args = { _: [] };

  const alias = options.alias ?? {};
  const defaults = options.default ?? {};

  const booleans = new Set(getBooleanKeys(options.boolean));
  const strings = new Set(toStringArray(options.string));
  const collectKeys = new Set(toStringArray(options.collect));
  const negatables = new Set(toStringArray(options.negatable));

  const aliasMap: Record<string, string> = {};
  const aliasGroups: Record<string, string[]> = {};

  for (const [key, aliases] of Object.entries(alias)) {
    const aliasList = Array.isArray(aliases) ? aliases : [aliases];

    for (const a of aliasList) aliasMap[a] = key;

    const group = [key, ...aliasList];
    aliasGroups[key] = group;
    for (const a of aliasList) aliasGroups[a] = group;
  }

  function setWithAliases(key: string, value: unknown): void {
    const keysToSet = aliasGroups[key] ?? [key];

    for (const k of keysToSet) {
      if (!collectKeys.has(k)) {
        result[k] = value;
        continue;
      }

      const existing = result[k];
      if (!Array.isArray(existing)) {
        result[k] = existing !== undefined ? [existing] : [];
      }
      (result[k] as unknown[]).push(value);
    }
  }

  for (const [key, value] of Object.entries(defaults)) {
    result[key] = value;
  }

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

      if (key.startsWith("no-") && negatables.size > 0) {
        const baseKey = key.slice(3);
        if (negatables.has(baseKey)) {
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
