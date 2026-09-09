import "#veryfront/schemas/_test-setup.ts";
import { createRemoteMCPToolSource } from "#veryfront/tool";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { wrapRemoteToolSourceWithMcpPolicy } from "#veryfront/agent/mcp-tool-policy.ts";
import { createAgentServiceRemoteMcpConfig } from "#veryfront/agent/service/mcp-server-config.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";

it("keeps legacy invocation and deny policies across API naming versions", async () => {
  for (const supportsNamingMode of [true, false]) {
    const config = createAgentServiceRemoteMcpConfig({
      server: { kind: "veryfront-api" },
      authToken: "test-token",
      apiMcpUrl: "https://93.184.216.34/mcp?tool_names=canonical",
    });
    if (!config) throw new Error("Expected API source configuration");
    const source = wrapRemoteToolSourceWithMcpPolicy(createRemoteMCPToolSource(config), {
      deny: ["update_file"],
    });
    const calledNames: string[] = [];
    await withMockFetch(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.method === "tools/list") {
        const canonical = supportsNamingMode &&
          body.params?._meta?.["veryfront/tool-names"] !== "legacy";
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: ["get_file", "update_file", "gmail__list_emails"].map((name) => ({
              name: canonical && !name.includes("__") ? `veryfront__${name}` : name,
              description: "Tool",
              inputSchema: {},
            })),
          },
        });
      }
      calledNames.push(body.params.name);
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: "ok" }] },
      });
    }, async () => {
      assertEquals((await source.listTools()).map((tool) => tool.name), [
        "get_file",
        "gmail__list_emails",
      ]);
      await assertRejects(
        async () => await source.executeTool("update_file", {}),
        Error,
        "not allowed",
      );
      await source.executeTool("get_file", {});
      assertEquals(calledNames, ["get_file"]);
    });
  }
});
