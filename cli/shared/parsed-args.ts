import type { ParsedArgs } from "./types.ts";

export function getStringArg(args: ParsedArgs, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}
