/**
 * Demo command handler
 */

import { defineSchema } from "veryfront/schemas";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";
import type { DemoOptions } from "./index.ts";

const getDemoArgsSchema = defineSchema((v) =>
  v.object({
    projectName: v.string().optional(),
    auto: v.boolean().default(false),
    loginMethod: v.enum(["google", "github", "microsoft", "token"]).optional(),
  })
);

const DemoArgsSchema = getDemoArgsSchema();

export const parseDemoArgs = createArgParser(DemoArgsSchema, {
  projectName: { keys: ["project-name"], type: "string", positional: 0 },
  auto: { keys: ["auto"], type: "boolean" },
  loginMethod: { keys: ["login"], type: "string" },
});

export async function handleDemoCommand(args: ParsedArgs): Promise<void> {
  const data = parseArgsOrThrow(parseDemoArgs, "demo", args);
  const { demoCommand } = await import("./index.ts");
  await demoCommand(data as DemoOptions);
}
