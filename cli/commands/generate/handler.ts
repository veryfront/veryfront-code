/**
 * Generate command handler
 */

import { defineSchema } from "veryfront/schemas";
import { generateCommand } from "./index.ts";
import { showLogo } from "#cli/utils";
import { createArgParser } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";
import { cwd } from "veryfront/platform";

const VALID_TYPES = ["page", "layout", "provider", "api", "integration"] as const;

const getGenerateArgsSchema = defineSchema((v) =>
  v.object({
    type: v.enum(VALID_TYPES).optional(),
    name: v.string().optional(),
  })
);

const GenerateArgsSchema = getGenerateArgsSchema();

export const parseGenerateArgs = createArgParser(GenerateArgsSchema, {
  type: { keys: ["type"], type: "string", positional: 0 },
  name: { keys: ["name"], type: "string", positional: 1 },
});

export async function handleGenerateCommand(args: ParsedArgs): Promise<void> {
  showLogo();
  const result = parseGenerateArgs(args);
  if (!result.success) {
    throw new Error(
      `Invalid arguments. Usage: veryfront generate <type> <name>\n\nValid types: ${
        VALID_TYPES.join(", ")
      }`,
    );
  }
  const { type, name } = result.data;

  // Integration type doesn't require a name (prompts interactively)
  if (type === "integration") {
    await generateCommand(cwd(), type, name ?? "");
    return;
  }

  if (!type || !name) {
    throw new Error(
      `Invalid arguments. Usage: veryfront generate <type> <name>\n\nValid types: ${
        VALID_TYPES.join(", ")
      }`,
    );
  }

  await generateCommand(cwd(), type, name);
}
