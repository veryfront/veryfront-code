/**
 * MCP command handler
 */

import { z } from "zod";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

const MCPArgsSchema = z.object({
  port: z.number().optional(),
});

export const parseMCPArgs = createArgParser(MCPArgsSchema, {
  port: { keys: ["port"], type: "number" },
});

export async function handleMCPCommand(args: ParsedArgs): Promise<void> {
  const data = parseArgsOrThrow(parseMCPArgs, "MCP", args);
  const { createStandaloneMCPServer } = await import("../../mcp/standalone.ts");
  const mcpServer = createStandaloneMCPServer({ port: data.port });

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
