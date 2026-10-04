import "#veryfront/schemas/_test-setup.ts";
import { createRemoteMCPToolSource } from "#veryfront/tool";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { wrapRemoteToolSourceWithMcpPolicy } from "#veryfront/agent/mcp-tool-policy.ts";
import {
  createLivePlatformMcpSource,
  withPlatformMcpPolicyAliases,
} from "#veryfront/agent/platform-mcp-tool-source.ts";
import { createAgentServiceRemoteMcpConfig } from "#veryfront/agent/service/mcp-server-config.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";

it("keeps saved selectors and deny policies with canonical discovery", async () => {
  for (const canonicalDiscovery of [true, false]) {
    const config = createAgentServiceRemoteMcpConfig({
      server: { kind: "veryfront-api" },
      authToken: "test-token",
      apiMcpUrl: "https://93.184.216.34/mcp",
    });
    if (!config) throw new Error("Expected API source configuration");
    const source = createLivePlatformMcpSource(
      wrapRemoteToolSourceWithMcpPolicy(
        createRemoteMCPToolSource(config),
        withPlatformMcpPolicyAliases({
          deny: ["update_file"],
        }),
      ),
    );
    const calledNames: string[] = [];
    await withMockFetch(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.method === "tools/list") {
        assertEquals(body.params?._meta, undefined);
        const canonical = canonicalDiscovery;
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
        canonicalDiscovery ? "veryfront__get_file" : "get_file",
        "gmail__list_emails",
        canonicalDiscovery ? "get_file" : "veryfront__get_file",
      ]);
      await assertRejects(
        async () => await source.executeTool("update_file", {}),
        Error,
        "not allowed",
      );
      await assertRejects(
        async () => await source.executeTool("veryfront__update_file", {}),
        Error,
        "not allowed",
      );
      await source.executeTool("get_file", {});
      await source.executeTool("veryfront__get_file", {});
      assertEquals(
        calledNames,
        canonicalDiscovery
          ? ["veryfront__get_file", "veryfront__get_file"]
          : ["get_file", "get_file"],
      );
    });
  }
});
