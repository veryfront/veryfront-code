/**
 * MCP command handler
 */

import { z } from "zod";
import { createArgParser } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

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

  // Keep process alive until interrupted, then shut down gracefully
  const { promise, resolve } = Promise.withResolvers<void>();
  const onSignal = () => {
    mcpServer.stop();
    resolve();
  };
  Deno.addSignalListener("SIGINT", onSignal);
  Deno.addSignalListener("SIGTERM", onSignal);
  await promise;
}
