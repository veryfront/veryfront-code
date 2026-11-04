import "#veryfront/schemas/_test-setup.ts";
import { StandaloneMCPServer } from "../../../../cli/mcp/standalone.ts";
import { MCPDevServer } from "../../../../cli/mcp/server.ts";

if (Deno.args[0] === "dev") {
  new MCPDevServer({ stdio: true }).start();
} else {
  new StandaloneMCPServer().start();
}
