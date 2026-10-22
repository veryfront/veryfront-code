import { readGlobalBooleanFlag } from "../../shared/global-flags.ts";
import type { ParsedArgs } from "../../shared/types.ts";

/** Preserve the complete docs command before project/config initialization. */
export function earlyDocsArguments(args: readonly string[]): string[] | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "docs") return [...args.slice(0, index), ...args.slice(index + 1)];
    if (arg === "--output" || arg === "-o") {
      index++;
      continue;
    }
    if (arg.startsWith("--output=")) continue;
    if (!readGlobalBooleanFlag(arg) && !arg.startsWith("-")) return undefined;
  }
  return undefined;
}

/** The router must forward unknown/malformed options so the command can reject them. */
export function parsedDocsArguments(args: ParsedArgs): string[] {
  const result = args._.slice(1).map(String);
  for (const [key, value] of Object.entries(args)) {
    if (key === "_" || key === "__explicit") continue;
    const option = `${key.length === 1 ? "-" : "--"}${key}`;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === true) result.push(option);
      else if (item === false) result.push(`${option}=false`);
      else result.push(option, String(item));
    }
  }
  return result;
}
