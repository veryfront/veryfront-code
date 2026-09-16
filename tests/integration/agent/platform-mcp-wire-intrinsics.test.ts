import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  createLivePlatformMcpSource,
  createPlatformMcpCatalogSource,
} from "#veryfront/agent/platform-mcp-tool-source.ts";

it("platform wire dispatch ignores replacement Map methods", async () => {
  const calls: string[] = [];
  const definitions = [{
    name: "get_file",
    description: "Read",
    parameters: { type: "object" as const, properties: {} },
  }];
  const source = {
    id: "platform",
    listTools: async () => definitions,
    executeTool: async (name: string) => {
      calls.push(name);
      return {};
    },
  };
  const catalog = createPlatformMcpCatalogSource(source, definitions);
  const live = createLivePlatformMcpSource(source);
  await live.listTools();
  const originalGet = Map.prototype.get;
  Map.prototype.get = function <K, V>(this: Map<K, V>, _key: K): V | undefined {
    return "wrong_tool" as V;
  };
  try {
    await catalog.source.executeTool("veryfront__get_file", {});
    await live.executeTool("veryfront__get_file", {});
  } finally {
    Map.prototype.get = originalGet;
  }
  assertEquals(calls, ["get_file", "get_file"]);
});
