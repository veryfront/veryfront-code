
import type { ParsedArgs } from "./types.ts";
import { DEFAULT_PORT } from "@veryfront/config/defaults.ts";

const ARRAY_FLAGS = new Set(["with"]);

function parse(
  args: string[],
  options: {
    alias?: Record<string, string>;
    default?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  const result: Record<string, unknown> = { _: [] as string[], ...options.default };
  const aliasMap = new Map<string, string>();

  if (options.alias) {
    for (const [short, long] of Object.entries(options.alias)) {
      aliasMap.set(short, long);
    }
  }

  const setValue = (key: string, value: unknown) => {
    if (ARRAY_FLAGS.has(key)) {
      if (!result[key]) {
        result[key] = [];
      }
      (result[key] as unknown[]).push(value);
    } else {
      result[key] = value;
    }
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        setValue(key, arg.slice(eqIdx + 1));
      } else {
        const key = arg.slice(2);
        const next = args[i + 1];
        if (next && !next.startsWith("-")) {
          setValue(key, next);
          i++;
        } else {
          setValue(key, true);
        }
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const short = arg.slice(1);
      const key = aliasMap.get(short) || short;
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        setValue(key, next);
        i++;
      } else {
        setValue(key, true);
      }
    } else if (!result._) {
      result._ = [arg];
    } else {
      (result._ as string[]).push(arg);
    }
  }

  return result;
}

export function parseArrayArg(arg: unknown): string[] | undefined {
  if (Array.isArray(arg)) return arg as string[];
  if (arg) return [String(arg)];
  return undefined;
}

export function parseCliArgs(args: string[]): ParsedArgs {
  return parse(args, {
    alias: {
      p: "port",
      h: "help",
      v: "version",
      q: "quiet",
      f: "force",
      s: "strict",
      t: "template",
      j: "json",
      w: "with",
    },
    default: { port: DEFAULT_PORT },
  }) as ParsedArgs;
}
