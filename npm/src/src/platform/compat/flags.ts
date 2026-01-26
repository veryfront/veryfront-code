// Import as namespace to handle both Deno std (named export) and mri (default export)
import * as flagsModule from "mri";

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

// Handle both export styles: Deno std uses { parse }, mri uses default
function getParser(): ParseFn {
  const mod = flagsModule as unknown as { default?: ParseFn; parse?: ParseFn };
  if (typeof mod.default === "function") return mod.default;
  if (typeof mod.parse === "function") return mod.parse;
  throw new Error("flags module has no parse function");
}

const flagsParse = getParser();

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function parse(args: string[], options: ParseOptions = {}): Args {
  const parsed = flagsParse(args, options);

  for (const key of toArray(options.collect)) {
    if (key in parsed && !Array.isArray(parsed[key])) {
      parsed[key] = [parsed[key]];
    }
  }

  for (const key of toArray(options.negatable)) {
    const noKey = `no-${key}`;
    if (noKey in parsed) {
      parsed[key] = !parsed[noKey];
      delete parsed[noKey];
    }
  }

  return parsed;
}
