import { z } from "zod";
import { startCommand } from "./command.ts";
import { createArgParser } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";
import { DEFAULT_MCP_PORT } from "#cli/shared/constants";

const DEFAULT_START_PORT = 8080;

const StartArgsSchema = z.object({
  port: z.number().default(DEFAULT_START_PORT),
  mcpPort: z.number().default(DEFAULT_MCP_PORT),
  project: z.string().optional(),
  headless: z.boolean().default(false),
});

export const parseStartArgs = createArgParser(StartArgsSchema, {
  port: { keys: ["port", "p"], type: "number" },
  mcpPort: { keys: ["mcp-port"], type: "number" },
  project: { keys: ["project"], type: "string" },
  headless: { keys: ["headless", "no-tui"], type: "boolean" },
});

export async function handleStartCommand(args: ParsedArgs): Promise<void> {
  const result = parseStartArgs(args);
  if (!result.success) {
    throw new Error(`Invalid start arguments: ${result.error.message}`);
  }
  const opts = result.data;
  await startCommand({
    port: opts.port,
    mcpPort: opts.mcpPort,
    projectPath: opts.project ?? null,
    headless: opts.headless,
  });
}
