/**
 * Demo command handler
 */

import { z } from "zod";
import { createArgParser } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

const DemoArgsSchema = z.object({
  projectName: z.string().optional(),
  auto: z.boolean().default(false),
  loginMethod: z.enum(["google", "github", "microsoft", "token"]).optional(),
});

export const parseDemoArgs = createArgParser(DemoArgsSchema, {
  projectName: { keys: ["project-name"], type: "string", positional: 0 },
  auto: { keys: ["auto"], type: "boolean" },
  loginMethod: { keys: ["login"], type: "string" },
});

export async function handleDemoCommand(args: ParsedArgs): Promise<void> {
  const result = parseDemoArgs(args);
  if (!result.success) {
    throw new Error(`Invalid demo arguments: ${result.error.message}`);
  }
  const { demoCommand } = await import("./index.ts");
  await demoCommand(result.data);
}
