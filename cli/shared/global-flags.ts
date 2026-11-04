import { parseBooleanValue } from "./boolean-value.ts";

/** Boolean options accepted by every command, including configuration-independent entry paths. */
export const GLOBAL_BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  "help",
  "version",
  "json",
  "yes",
  "quiet",
  "verbose",
  "no-input",
  "no-color",
  "color",
  "no-animation",
]);

export const CLI_FLAG_ALIASES: Readonly<Record<string, string>> = {
  h: "help",
  v: "version",
  q: "quiet",
  f: "force",
  s: "strict",
  j: "json",
  o: "output",
  y: "yes",
  m: "mode",
};

export function readGlobalBooleanFlag(
  argument: string,
): { name: string; value: boolean } | undefined {
  const match = /^(--[^=]+|-[a-z])(?:=(.*))?$/.exec(argument);
  if (!match?.[1]) return undefined;
  const name = match[1].startsWith("--") ? match[1].slice(2) : CLI_FLAG_ALIASES[match[1].slice(1)];
  const value = match[2] === undefined ? true : parseBooleanValue(match[2]);
  return name && GLOBAL_BOOLEAN_FLAGS.has(name) && value !== undefined
    ? { name, value }
    : undefined;
}
