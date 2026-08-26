/**
 * Generate command handler
 */

import { INVALID_ARGUMENT } from "veryfront/errors";
import { defineSchema, lazySchema } from "veryfront/schemas";
import { generateCommand } from "./index.ts";
import { showHeader } from "#cli/utils";
import { createArgParser } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";
import { cwd } from "veryfront/platform";
import { AUTH_PRESETS, isAuthPreset, SCAFFOLD_TYPES } from "../../scaffold/engine.ts";

const VALID_TYPES = [...SCAFFOLD_TYPES, "auth", "integration"] as const;

const getGenerateArgsSchema = defineSchema((v) =>
  v.object({
    type: v.enum(VALID_TYPES).optional(),
    name: v.string().optional(),
  })
);

const GenerateArgsSchema = lazySchema(getGenerateArgsSchema);

export const parseGenerateArgs = createArgParser(GenerateArgsSchema, {
  type: { keys: ["type"], type: "string", positional: 0 },
  name: { keys: ["name"], type: "string", positional: 1 },
});

export async function handleGenerateCommand(args: ParsedArgs): Promise<void> {
  showHeader();
  const result = parseGenerateArgs(args);
  if (!result.success) {
    throw INVALID_ARGUMENT.create({
      detail: `Invalid arguments. Usage: veryfront generate <type> <name>\n\nValid types: ${
        VALID_TYPES.join(", ")
      }`,
    });
  }
  const { type, name } = result.data;

  // Integration type doesn't require a name (prompts interactively)
  if (type === "integration") {
    await generateCommand(cwd(), type, name ?? "");
    return;
  }

  if (type === "auth" && (!name || !isAuthPreset(name))) {
    throw INVALID_ARGUMENT.create({
      detail: `Invalid arguments. Usage: veryfront generate auth <preset>\n\nValid presets: ${
        AUTH_PRESETS.join(", ")
      }`,
    });
  }

  if (!type || !name) {
    throw INVALID_ARGUMENT.create({
      detail: `Invalid arguments. Usage: veryfront generate <type> <name>\n\nValid types: ${
        VALID_TYPES.join(", ")
      }`,
    });
  }

  await generateCommand(cwd(), type, name);
}
