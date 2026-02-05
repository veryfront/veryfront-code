/**
 * MCP command handler
 */

import { z } from "zod";
import { DEFAULT_PORT } from "#veryfront/config/defaults.ts";
import { createArgParser } from "../../shared/args.ts";
import type { ParsedArgs } from "../../shared/types.ts";

const MCPArgsSchema = z.object({
  port: z.number().optional(),
});

export const parseMCPArgs = createArgParser(MCPArgsSchema, {
  port: { keys: ["port"], type: "number" },
});

export async function handleMCPCommand(args: ParsedArgs): Promise<void> {
  const result = parseMCPArgs(args);
  if (!result.success) {
    throw new Error(`Invalid MCP arguments: ${result.error.message}`);
  }
  // The CLI framework injects DEFAULT_PORT (3000) as a default for --port.
  // Filter it out so the MCP server uses its own default (8080).
  const port = result.data.port !== DEFAULT_PORT ? result.data.port : undefined;
  const { createStandaloneMCPServer } = await import("../../mcp/standalone.ts");
  const mcpServer = createStandaloneMCPServer({ port });
  await new Promise(() => {});
  mcpServer.stop();
}
