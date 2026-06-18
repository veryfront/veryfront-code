/**
 * MCP command handler
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import { onSignal as registerSignalHandler } from "veryfront/platform";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

const getMCPArgsSchema = defineSchema((v) =>
  v.object({
    port: v.number().optional(),
  })
);

const MCPArgsSchema = lazySchema(getMCPArgsSchema);

export const parseMCPArgs = createArgParser(MCPArgsSchema, {
  port: { keys: ["port"], type: "number" },
});

export async function handleMCPCommand(args: ParsedArgs): Promise<void> {
  const data = parseArgsOrThrow(parseMCPArgs, "MCP", args);
  const { createStandaloneMCPServer } = await import("../../mcp/standalone.ts");
  const mcpServer = createStandaloneMCPServer({ port: data.port });

  // Keep process alive until interrupted, then shut down gracefully
  const { promise, resolve } = Promise.withResolvers<void>();
  const shutdown = () => {
    mcpServer.stop();
    resolve();
  };
  registerSignalHandler("SIGINT", shutdown);
  registerSignalHandler("SIGTERM", shutdown);
  await promise;
}
