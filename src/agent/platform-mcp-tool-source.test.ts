import { createMcpToolPolicyGate } from "./mcp-tool-policy.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createLivePlatformMcpSource,
  createPlatformMcpCatalogSource,
  platformMcpLegacyName,
  withPlatformMcpPolicyAliases,
} from "./platform-mcp-tool-source.ts";

describe("platform MCP catalog aliases", () => {
  it("does not turn integration names into platform aliases", async () => {
    const calls: string[] = [];
    const source = createLivePlatformMcpSource({
      id: "platform",
      listTools: async () =>
        ["get_file", "github__delete_repo"].map((name) => ({
          name,
          description: name,
          parameters: { type: "object" as const, properties: {} },
        })),
      executeTool: async (name) => {
        calls.push(name);
        return {};
      },
    });
    assertEquals((await source.listTools()).map(({ name }) => name), [
      "get_file",
      "github__delete_repo",
      "veryfront__get_file",
    ]);
    assertEquals(
      platformMcpLegacyName("veryfront__github__delete_repo"),
      "veryfront__github__delete_repo",
    );
    assertEquals(platformMcpLegacyName("veryfront__"), "veryfront__");
    await source.executeTool("veryfront__get_file", {});
    await source.executeTool("github__delete_repo", {});
    assertEquals(calls, ["get_file", "github__delete_repo"]);
  });

  it("preserves existing canonical definitions without overwriting their dispatch", async () => {
    const calls: string[] = [];
    const definitions = ["get_file", "veryfront__get_file"].map((name) => ({
      name,
      description: name,
      parameters: { type: "object" as const, properties: {} },
    }));
    const catalog = createPlatformMcpCatalogSource({
      id: "platform",
      listTools: async () => definitions,
      executeTool: async (name) => {
        calls.push(name);
        return {};
      },
    }, definitions);
    assertEquals(catalog.definitions, definitions);
    await catalog.source.executeTool("veryfront__get_file", {});
    assertEquals(calls, ["veryfront__get_file"]);
  });
});

it("platform policy aliases observe subsequent policy revocation", () => {
  const policy: { allow?: string[]; deny?: string[] } = { allow: ["veryfront__get_file"] };
  const legacyGate = createMcpToolPolicyGate(withPlatformMcpPolicyAliases(policy));
  const aliasGate = createMcpToolPolicyGate(
    withPlatformMcpPolicyAliases(policy),
  );
  assertEquals(legacyGate.allows("get_file"), true);
  assertEquals(aliasGate.allows("get_file"), true);
  policy.deny = ["veryfront__get_file"];
  assertThrows(() => legacyGate.assertAllowed("get_file"));
  assertThrows(() => aliasGate.assertAllowed("get_file"));
  assertThrows(() => aliasGate.assertAllowed("veryfront__get_file"));
});

it("live platform catalogs preserve existing canonical dispatch", async () => {
  const calls: string[] = [];
  const source = createLivePlatformMcpSource({
    id: "platform",
    listTools: async () => [{
      name: "veryfront__get_file",
      description: "Read",
      parameters: { type: "object" as const, properties: {} },
    }],
    executeTool: async (name) => {
      calls.push(name);
      return {};
    },
  });
  assertEquals((await source.listTools()).map(({ name }) => name), ["veryfront__get_file"]);
  await source.executeTool("veryfront__get_file", {});
  assertEquals(calls, ["veryfront__get_file"]);
});

it("live platform execution resolves undiscovered aliases without repeating known discovery", async () => {
  let listings = 0;
  const calls: string[] = [];
  const names = ["get_file"];
  const source = createLivePlatformMcpSource({
    id: "platform",
    listTools: async () => {
      listings++;
      return names.map((name) => ({
        name,
        description: name,
        parameters: { type: "object" as const, properties: {} },
      }));
    },
    executeTool: async (name) => {
      calls.push(name);
      return {};
    },
  });
  await source.executeTool("veryfront__get_file", {});
  assertEquals(calls, ["get_file"]);
  assertEquals(listings, 1);
  await source.executeTool("veryfront__get_file", {});
  assertEquals(listings, 1);
  names.push("update_file");
  await source.executeTool("veryfront__update_file", {});
  assertEquals(calls, ["get_file", "get_file", "update_file"]);
  assertEquals(listings, 2);
});
