import { cwd } from "#veryfront/platform/compat/process.ts";
import type { z } from "zod";
import { parseArgsOrThrow } from "./args.ts";
import type { ParsedArgs } from "./types.ts";
import { showLogo } from "#cli/utils";

type ArgParser<T> = (args: ParsedArgs) => z.SafeParseReturnType<unknown, T>;

export async function handleProjectDirCommand<T extends { projectDir: string }>(
  args: ParsedArgs,
  parser: ArgParser<T>,
  commandName: string,
  command: (options: T) => Promise<void>,
): Promise<void> {
  showLogo();
  const data = parseArgsOrThrow(parser, commandName, args);
  await command({ ...data, projectDir: data.projectDir || cwd() });
}
