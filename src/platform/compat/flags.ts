// Import as namespace to handle both Deno std (named export) and mri (default export)
import * as flagsModule from "#std/flags.ts";

export interface ParseOptions {
  alias?: Record<string, string | string[]>;
  boolean?: string | string[];
  default?: Record<string, unknown>;
  stopEarly?: boolean;
  string?: string | string[];
  collect?: string | string[];
  negatable?: string | string[];
  unknown?: (arg: string) => boolean;
}

export interface Args {
  _: string[];
  [key: string]: unknown;
}

type ParseFn = (args: string[], options?: ParseOptions) => Args;

function getParser(): ParseFn {
  const mod = flagsModule as { default?: unknown; parse?: unknown };

  if (typeof mod.default === "function") return mod.default as ParseFn;
  if (typeof mod.parse === "function") return mod.parse as ParseFn;

  throw new Error("flags module has no parse function");
}

const flagsParse = getParser();

function toArray(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function parse(args: string[], options: ParseOptions = {}): Args {
  const parsed = flagsParse(args, options);

  for (const key of toArray(options.collect)) {
    const value = parsed[key];
    if (key in parsed && !Array.isArray(value)) {
      parsed[key] = [value];
    }
  }

  for (const key of toArray(options.negatable)) {
    const noKey = `no-${key}`;
    if (!(noKey in parsed)) continue;

    parsed[key] = !parsed[noKey];
    delete parsed[noKey];
  }

  return parsed;
}
