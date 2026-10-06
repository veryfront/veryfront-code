import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { agent, createEphemeralAgentWithRuntimeOptions } from "./factory.ts";
import { scriptedModel } from "./runtime/model-runtime.test-helpers.ts";

it("knowledge configuration exposes a framework search capability without a tools binding", async () => {
  const model = scriptedModel([{ text: "ready" }], { modelId: "hosted/knowledge-context" });
  const assistant = agent({
    id: "knowledge-context-test",
    system: "Answer with project knowledge.",
    knowledge: ["knowledge/support/**"],
    resolveModelTransport: () => ({ model }),
  });
  await assistant.generate({ input: "What can you search?" });
  assertEquals(model.toolNames(0).includes("search_knowledge"), true);
});

it("disabled knowledge does not expose a framework search capability", async () => {
  const model = scriptedModel([{ text: "ready" }], { modelId: "hosted/no-knowledge-context" });
  const assistant = agent({
    id: "no-knowledge-context-test",
    system: "Answer without project knowledge.",
    knowledge: false,
    resolveModelTransport: () => ({ model }),
  });
  await assistant.generate({ input: "What can you search?" });
  assertEquals(model.toolNames(0).includes("search_knowledge"), false);
});

it("invalid knowledge configuration fails before exposing search_knowledge", () => {
  assertThrows(
    () =>
      agent({
        id: "invalid-knowledge-context-test",
        system: "Answer with project knowledge.",
        knowledge: "" as never,
        resolveModelTransport: () => ({ model: scriptedModel([{ text: "ready" }]) }),
      }),
    Error,
    "Invalid knowledge scope path",
  );
  assertThrows(
    () =>
      agent({
        id: "invalid-map-knowledge-context-test",
        system: "Answer with project knowledge.",
        knowledge: { "knowledge/support/**": "yes" } as never,
        resolveModelTransport: () => ({ model: scriptedModel([{ text: "ready" }]) }),
      }),
    Error,
    "Invalid knowledge scope selector",
  );
});

it("prevalidated hosted catalogs never implicitly re-enable knowledge", async () => {
  const model = scriptedModel([{ text: "ready" }], { modelId: "hosted/filtered-knowledge" });
  const assistant = createEphemeralAgentWithRuntimeOptions({
    id: "filtered-knowledge-test",
    system: "Use only host-approved capabilities.",
    knowledge: true,
    skills: false,
    tools: {},
    resolveModelTransport: () => ({ model }),
  }, { preserveToolCatalog: true });
  await assistant.generate({ input: "What can you search?" });
  assertEquals(model.toolNames(0).includes("search_knowledge"), false);
});
