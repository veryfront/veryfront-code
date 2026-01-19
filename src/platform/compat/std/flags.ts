/**
 * Portable @std/flags shim for Node.js and Bun.
 *
 * In Deno: Uses @std/flags
 * In Node.js/Bun: Provides a minimal arg parser implementation
 *
 * @module
 */

import { isDeno } from "../runtime.ts";

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Node.js/Bun implementation
// ============================================================================

function nodeParse(args: string[], options: ParseOptions = {}): Args {
  const result: Args = { _: [] };
  const alias = options.alias || {};
  const defaults = options.default || {};
  const booleans = new Set(
    options.boolean === true
      ? []
      : typeof options.boolean === "string"
      ? [options.boolean]
      : options.boolean || [],
  );
  const strings = new Set(
    typeof options.string === "string" ? [options.string] : options.string || [],
  );

  // Build reverse alias map and forward alias map
  const aliasMap: Record<string, string> = {};
  const aliasGroups: Record<string, string[]> = {};

  for (const [key, aliases] of Object.entries(alias)) {
    const aliasList = Array.isArray(aliases) ? aliases : [aliases];
    // Map each alias to the primary key
    for (const a of aliasList) {
      aliasMap[a] = key;
    }
    // Store all keys in a group (primary key + all aliases)
    aliasGroups[key] = [key, ...aliasList];
    for (const a of aliasList) {
      aliasGroups[a] = [key, ...aliasList];
    }
  }

  // Get collect keys as a Set for fast lookup
  const collectKeys = new Set(
    options.collect
      ? typeof options.collect === "string" ? [options.collect] : options.collect
      : [],
  );

  // Helper to set value for a key and all its aliases
  const setWithAliases = (key: string, value: unknown) => {
    const group = aliasGroups[key];
    const keysToSet = group || [key];

    for (const k of keysToSet) {
      if (collectKeys.has(k)) {
        // For collect keys, push to array
        if (!Array.isArray(result[k])) {
          result[k] = result[k] !== undefined ? [result[k]] : [];
        }
        (result[k] as unknown[]).push(value);
      } else {
        result[k] = value;
      }
    }
  };

  // Apply defaults
  for (const [key, value] of Object.entries(defaults)) {
    result[key] = value;
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Handle -- separator
    if (arg === "--") {
      if (options["--"]) {
        result["--"] = args.slice(i + 1);
      } else {
        result._.push(...args.slice(i + 1));
      }
      break;
    }

    // Handle --flag=value
    if (arg.startsWith("--")) {
      const eqIndex = arg.indexOf("=");
      if (eqIndex !== -1) {
        const key = arg.slice(2, eqIndex);
        const value = arg.slice(eqIndex + 1);
        const realKey = aliasMap[key] || key;
        setWithAliases(realKey, strings.has(realKey) ? value : parseValue(value));
      } else {
        const key = arg.slice(2);
        const realKey = aliasMap[key] || key;

        // Handle --no-* flags
        if (key.startsWith("no-") && options.negatable) {
          const negatables = typeof options.negatable === "string"
            ? [options.negatable]
            : options.negatable;
          const baseKey = key.slice(3);
          if (negatables.includes(baseKey)) {
            setWithAliases(baseKey, false);
            continue;
          }
        }

        if (booleans.has(realKey) || options.boolean === true) {
          setWithAliases(realKey, true);
        } else if (strings.has(realKey)) {
          const nextArg = args[i + 1];
          if (nextArg !== undefined && !nextArg.startsWith("-")) {
            setWithAliases(realKey, nextArg);
            i++;
          } else {
            setWithAliases(realKey, "");
          }
        } else {
          const nextArg = args[i + 1];
          if (nextArg !== undefined && !nextArg.startsWith("-")) {
            setWithAliases(realKey, parseValue(nextArg));
            i++;
          } else {
            setWithAliases(realKey, true);
          }
        }
      }
    } // Handle -f or -abc (short flags)
    else if (arg.startsWith("-") && arg.length > 1) {
      const chars = arg.slice(1);

      // Handle -f=value
      const eqIndex = chars.indexOf("=");
      if (eqIndex !== -1) {
        const key = chars.slice(0, eqIndex);
        const value = chars.slice(eqIndex + 1);
        const realKey = aliasMap[key] || key;
        setWithAliases(realKey, strings.has(realKey) ? value : parseValue(value));
      } else if (chars.length === 1) {
        // Single short flag
        const key = chars;
        const realKey = aliasMap[key] || key;

        if (booleans.has(realKey) || options.boolean === true) {
          setWithAliases(realKey, true);
        } else {
          const nextArg = args[i + 1];
          if (nextArg !== undefined && !nextArg.startsWith("-")) {
            setWithAliases(realKey, strings.has(realKey) ? nextArg : parseValue(nextArg));
            i++;
          } else {
            setWithAliases(realKey, true);
          }
        }
      } else {
        // Multiple short flags: -abc
        for (const char of chars) {
          const realKey = aliasMap[char] || char;
          setWithAliases(realKey, true);
        }
      }
    } // Positional argument
    else {
      if (options.stopEarly) {
        result._.push(arg, ...args.slice(i + 1));
        break;
      }
      result._.push(parseValue(arg));
    }
  }

  return result;
}

function parseValue(value: string): string | number | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  const num = Number(value);
  if (!isNaN(num) && value !== "") return num;
  return value;
}

// ============================================================================
// Exports
// ============================================================================

export let parse: (args: string[], options?: ParseOptions) => Args;

if (isDeno) {
  // Deno: Use @std/flags
  const stdFlags = await import("#std/flags.ts");
  parse = stdFlags.parse as (args: string[], options?: ParseOptions) => Args;
} else {
  // Node.js/Bun: Use our implementation
  parse = nodeParse;
}
