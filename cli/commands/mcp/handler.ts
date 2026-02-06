/**
 * MCP command handler
 */

import { z } from "zod";
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
  const { createStandaloneMCPServer } = await import("../../mcp/standalone.ts");
  const mcpServer = createStandaloneMCPServer({ port: result.data.port });
  await new Promise(() => {});
  mcpServer.stop();
}
