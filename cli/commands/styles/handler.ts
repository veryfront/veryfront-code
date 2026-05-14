import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

const getStylesArgsSchema = defineSchema((v) =>
  v.object({
    subcommand: v.literal("build-artifact"),
    config: v.string().optional(),
    debug: v.boolean().default(false),
  })
);

const StylesArgsSchema = lazySchema(getStylesArgsSchema);

export type StylesArgs = InferSchema<ReturnType<typeof getStylesArgsSchema>>;

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
