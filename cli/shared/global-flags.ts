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
