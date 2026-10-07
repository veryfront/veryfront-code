import { defineSchema, lazySchema } from "veryfront/schemas";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";
import { INVALID_ARGUMENT } from "veryfront/errors";
import { COMMAND_CATEGORIES } from "../../help/types.ts";
import { generateCommandSchema, generateSchema } from "./command.ts";

const getSchemaArgsSchema = defineSchema((v) =>
  v.object({
    category: v.enum(COMMAND_CATEGORIES).optional(),
  })
);

const SchemaArgsSchema = lazySchema(getSchemaArgsSchema);

export const parseSchemaArgs = createArgParser(SchemaArgsSchema, {
  category: { keys: ["category", "c"], type: "string" },
}, { rejectUnknown: true });

export async function handleSchemaCommand(args: ParsedArgs): Promise<void> {
  const opts = parseArgsOrThrow(parseSchemaArgs, "schema", args);
  const commandName = args._[1] as string | undefined;

  if (commandName) {
    const schema = generateCommandSchema(commandName);
    if (!schema) {
      throw INVALID_ARGUMENT.create({
        detail: `Unknown command: ${commandName}`,
        context: { command: "schema", requestedCommand: commandName },
      });
    }
    console.log(JSON.stringify(schema, null, 2));
    return;
  }

  const schema = generateSchema(opts.category);
  console.log(JSON.stringify(schema, null, 2));
}
