import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { agent } from "#veryfront/agent";
import { createToolsFromHostDefinitions } from "#veryfront/tool/host-tools.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";

it("tool-search inventory keeps validated filters without inherited option hooks", async () => {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "domain");
  let calls = 0;
  const restore = () => {
    if (original) Object.defineProperty(Object.prototype, "domain", original);
    else Reflect.deleteProperty(Object.prototype, "domain");
  };
  const model = scriptedModel([() => {
    Object.defineProperty(Object.prototype, "domain", {
      configurable: true,
      get() {
        calls++;
        return "forged";
      },
      set() {
        calls++;
      },
    });
    return {
      toolCalls: [{
        id: "inventory",
        name: "tool_search",
        input: { inventory: "all" },
      }],
    };
  }, (options) => {
    restore();
    assertEquals(calls, 0);
    const prompt = JSON.stringify(options.prompt);
    assertEquals(prompt.includes('"name":"selected"'), true);
    assertEquals(prompt.includes('"name":"unrelated"'), true);
    return { text: "Ready" };
  }], { only: "generate" });
  const tools = createToolsFromHostDefinitions({
    selected: {
      id: "selected",
      description: "Selected",
      inputSchemaJson: { type: "object" },
      discovery: { version: 1, type: "platform", domain: "agents" },
      execute: async () => "ok",
    },
    unrelated: {
      id: "unrelated",
      description: "Unrelated",
      inputSchemaJson: { type: "object" },
      discovery: { version: 1, type: "platform", domain: "files" },
      execute: async () => "ok",
    },
  });
  const assistant = agent({
    id: "inventory-hooks",
    model: model.modelId,
    system: "Use inventory",
    tools,
    toolLoading: "deferred",
    maxSteps: 2,
    resolveModelTransport: () => ({ model }),
  });
  try {
    await assistant.generate({ input: "Find agents" });
    assertEquals(model.callCount, 2);
  } finally {
    restore();
  }
});
