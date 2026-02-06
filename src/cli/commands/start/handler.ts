import { z } from "zod";
import { startCommand } from "./command.ts";
import { createArgParser } from "../../shared/args.ts";
import { DEFAULT_MCP_PORT } from "../../shared/constants.ts";
import type { ParsedArgs } from "../../shared/types.ts";

const DEFAULT_START_PORT = 8080;

const StartArgsSchema = z.object({
  port: z.number().default(DEFAULT_START_PORT),
  mcpPort: z.number().default(DEFAULT_MCP_PORT),
  projectPath: z.string().optional(),
  headless: z.boolean().default(false),
});

const parseStartArgs = createArgParser(StartArgsSchema, {
  mcpPort: { keys: ["mcp-port"], type: "number" },
  projectPath: { keys: ["project"], type: "string" },
  headless: { keys: ["headless", "no-tui"], type: "boolean" },
});

export async function handleStartCommand(args: ParsedArgs): Promise<void> {
  const result = parseStartArgs(args);
  if (!result.success) {
    throw new Error(`Invalid start arguments: ${result.error.message}`);
  }

  // Port needs special handling: the legacy parser injects port=3000 as default,
  // so we only use args.port when the user explicitly passed --port
  const hasExplicitPort = args.__explicit?.port === true;
  const port = hasExplicitPort && typeof args.port === "number" ? args.port : DEFAULT_START_PORT;

  await startCommand({
    ...result.data,
    port,
    projectPath: result.data.projectPath ?? null,
  });
}
