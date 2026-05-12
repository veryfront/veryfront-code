import { defineSchema } from "veryfront/schemas";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";
import type { CommandCategory } from "../../help/types.ts";
import { generateCommandSchema, generateSchema } from "./command.ts";

const getSchemaArgsSchema = defineSchema((v) =>
  v.object({
    category: v.string().optional(),
  })
);

const SchemaArgsSchema = getSchemaArgsSchema();

const parseSchemaArgs = createArgParser(SchemaArgsSchema, {
  category: { keys: ["category", "c"], type: "string" },
});

export async function handleSchemaCommand(args: ParsedArgs): Promise<void> {
  const opts = parseArgsOrThrow(parseSchemaArgs, "schema", args);
  const commandName = args._[1] as string | undefined;

  if (commandName) {
    const schema = generateCommandSchema(commandName);
    if (!schema) {
      console.error(`Unknown command: ${commandName}`);
      Deno.exit(1);
    }
    console.log(JSON.stringify(schema, null, 2));
    return;
  }

  const schema = generateSchema(opts.category as CommandCategory | undefined);
  console.log(JSON.stringify(schema, null, 2));
}
