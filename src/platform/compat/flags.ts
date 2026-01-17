import { parse as denoFlagsParse } from "@std/flags";

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

export function parse(
  args: string[],
  options: ParseOptions = {},
) {
  const parsed = denoFlagsParse(args, options);

  if (options.collect) {
    const collectKeys = Array.isArray(options.collect) ? options.collect : [options.collect];
    for (const key of collectKeys) {
      if (key in parsed && !Array.isArray(parsed[key])) {
        parsed[key] = [parsed[key]];
      }
    }
  }

  if (options.negatable) {
    const negatableKeys = Array.isArray(options.negatable)
      ? options.negatable
      : [options.negatable];
    for (const key of negatableKeys) {
      const noKey = `no-${key}`;
      if (noKey in parsed) {
        parsed[key] = !parsed[noKey];
        delete parsed[noKey];
      }
    }
  }

  return parsed as Args;
}
