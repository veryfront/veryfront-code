/**
 * MCP command handler
 */

import { DEFAULT_PORT } from "#veryfront/config/defaults.ts";
import type { ParsedArgs } from "../../shared/types.ts";

export async function handleMCPCommand(args: ParsedArgs): Promise<void> {
  const port = args.port !== DEFAULT_PORT ? Number(args.port) : undefined;
  const { createStandaloneMCPServer } = await import("../../mcp/standalone.ts");
  const mcpServer = createStandaloneMCPServer({ port });
  await new Promise(() => {});
  mcpServer.stop();
}
