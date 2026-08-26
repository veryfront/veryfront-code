/** Standalone MCP scaffolding loads real project configuration and writes files. */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { exists, writeTextFile } from "#veryfront/platform/compat/fs.ts";
import { withTempDir } from "#veryfront/testing/deno-compat.ts";
import { join } from "veryfront/platform/path";

import { StandaloneMCPServer } from "../../../../../cli/mcp/standalone.ts";

function dispatch(
  server: StandaloneMCPServer,
  method: string,
  params: unknown = {},
): Promise<{ id: number; result?: unknown; error?: unknown }> {
  return (server as unknown as {
    handleRequest(request: unknown): Promise<{ id: number; result?: unknown; error?: unknown }>;
  }).handleRequest({
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  });
}

describe("standalone MCP scaffold router", () => {
  it("honors the project router", async () => {
    await withTempDir(async (projectDir) => {
      await writeTextFile(
        join(projectDir, "veryfront.config.ts"),
        'export default { router: "pages" };\n',
      );
      const server = new StandaloneMCPServer();
      const response = await dispatch(server, "tools/call", {
        name: "vf_scaffold",
        arguments: { type: "page", name: "docs", projectPath: projectDir },
      });
      const result = response.result as {
        content: Array<{ text: string }>;
        isError: boolean;
      };

      assertEquals(result.isError, false);
      assertEquals(JSON.parse(result.content[0]!.text).success, true);
      assertEquals(await exists(join(projectDir, "pages", "docs.mdx")), true);
      assertEquals(await exists(join(projectDir, "app", "docs", "page.tsx")), false);
    }, { prefix: "vf-standalone-scaffold-router-" });
  });
});
