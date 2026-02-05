import { startCommand } from "./command.ts";
import type { ParsedArgs } from "../../shared/types.ts";

const DEFAULT_START_PORT = 8080;
const DEFAULT_MCP_PORT = 9999;

export async function handleStartCommand(args: ParsedArgs): Promise<void> {
  const hasExplicitPort = args.__explicit?.port === true;
  const port = hasExplicitPort && typeof args.port === "number" ? args.port : DEFAULT_START_PORT;
  const mcpPort = typeof args["mcp-port"] === "number" ? args["mcp-port"] : DEFAULT_MCP_PORT;

  await startCommand({
    port,
    mcpPort,
    projectPath: args.project ? String(args.project) : null,
    headless: Boolean(args.headless || args["no-tui"]),
  });
}
