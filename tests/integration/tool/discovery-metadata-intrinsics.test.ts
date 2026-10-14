import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { normalizeToolDiscoveryMetadata } from "#veryfront/tool/discovery-metadata.ts";

it("never reads or writes inherited navigation accessors", () => {
  let hooks = 0;
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "domain");
  let absent: unknown;
  let present: unknown;
  try {
    Object.defineProperty(Object.prototype, "domain", {
      configurable: true,
      get() {
        hooks++;
        return "forged";
      },
      set() {
        hooks++;
      },
    });
    absent = normalizeToolDiscoveryMetadata({ version: 1, type: "platform" });
    assertEquals((absent as { domain?: string } | undefined)?.domain, undefined);
    present = normalizeToolDiscoveryMetadata({ version: 1, type: "platform", domain: "agents" });
  } finally {
    if (original) Object.defineProperty(Object.prototype, "domain", original);
    else Reflect.deleteProperty(Object.prototype, "domain");
  }
  assertEquals(hooks, 0);
  assertEquals(absent, { version: 1, type: "platform" });
  assertEquals(present, { version: 1, type: "platform", domain: "agents" });
});

it("materializing discovery metadata never invokes inherited tool getters or setters", async () => {
  const { createToolsFromHostDefinitions } = await import("#veryfront/tool/host-tools.ts");
  const { toolToProviderDefinition } = await import("#veryfront/tool/registry.ts");
  const { dynamicTool } = await import("#veryfront/tool");
  const { defineSchema } = await import("#veryfront/schemas");
  const schema = defineSchema((v) => v.object({}))();
  const plain = dynamicTool({
    id: "plain",
    description: "Plain",
    inputSchema: schema,
    execute: async () => "ok",
  });
  const source = {
    selected: {
      id: "selected",
      description: "Selected",
      inputSchemaJson: { type: "object" as const },
      discovery: { version: 1 as const, type: "platform" as const, domain: "agents" },
      execute: async () => "ok",
    },
  };
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "discovery");
  let calls = 0;
  let tools: ReturnType<typeof createToolsFromHostDefinitions> | undefined;
  try {
    Object.defineProperty(Object.prototype, "discovery", {
      configurable: true,
      get() {
        calls++;
        return undefined;
      },
      set() {
        calls++;
      },
    });
    tools = createToolsFromHostDefinitions(source);
    toolToProviderDefinition(plain);
  } finally {
    if (original) Object.defineProperty(Object.prototype, "discovery", original);
    else Reflect.deleteProperty(Object.prototype, "discovery");
  }
  assertEquals(calls, 0);
  assertEquals(tools?.selected?.discovery?.domain, "agents");
});
