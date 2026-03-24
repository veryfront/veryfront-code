import { z } from "zod";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

const StylesArgsSchema = z.object({
  subcommand: z.literal("build-artifact"),
  config: z.string().optional(),
  debug: z.boolean().default(false),
});

export type StylesArgs = z.infer<typeof StylesArgsSchema>;

export const parseStylesArgs = createArgParser(StylesArgsSchema, {
  subcommand: { keys: ["subcommand"], type: "string", positional: 0 },
  config: { keys: ["config"], type: "string" },
  debug: { keys: ["debug"], type: "boolean" },
});

export async function handleStylesCommand(args: ParsedArgs): Promise<void> {
  const opts = parseArgsOrThrow(parseStylesArgs, "styles", args);
  const { stylesCommand } = await import("./command.ts");
  await stylesCommand(opts);
}
