import { parseCliArgs } from "../../shared/args.ts";
import type { ParsedArgs } from "../../shared/types.ts";

/** Preserve the complete docs command before project/config initialization. */
export function earlyDocsArguments(args: readonly string[]): string[] | undefined {
  if (parseCliArgs([...args])._[0] !== "docs") return undefined;
  const index = args.findIndex((argument, position) =>
    argument === "docs" && parseCliArgs(args.slice(0, position + 1))._[0] === "docs"
  );
  return index < 0 ? undefined : [...args.slice(0, index), ...args.slice(index + 1)];
}

/** The router must forward unknown/malformed options so the command can reject them. */
export function parsedDocsArguments(args: ParsedArgs): string[] {
  const positionals = args._.slice(1).map(String);
  const result: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (key === "_" || key === "__explicit") continue;
    const option = `${key.length === 1 ? "-" : "--"}${key}`;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === true) result.push(option);
      else if (item === false) result.push(`${option}=false`);
      else result.push(option, String(item));
    }
  }
  return positionals.length ? [...result, "--", ...positionals] : result;
}
