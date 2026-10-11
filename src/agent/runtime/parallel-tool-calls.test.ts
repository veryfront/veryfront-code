import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import { agent } from "../factory.ts";
import { createRuntimeAgentDefinitionFromAgent } from "../project/agent-runtime.ts";
import { parseRuntimeAgentMarkdownDefinition } from "./agent-definition.ts";
import { createRuntimeAgentFromMarkdownDefinition } from "./agent-markdown-adapter.ts";

it("Markdown sequential tool control preserves explicit booleans and omission", async () => {
  for (const value of [false, true, undefined]) {
    const definition = parseRuntimeAgentMarkdownDefinition({
      id: "parallel-control",
      content: value === undefined
        ? "Instructions."
        : `---\nparallel-tool-calls: ${value}\n---\nInstructions.`,
    });
    assertEquals(definition.parallelToolCalls, value);
    const runtime = createRuntimeAgentFromMarkdownDefinition(definition);
    assertEquals(runtime.config.parallelToolCalls, value);
    assertEquals((await createRuntimeAgentDefinitionFromAgent(runtime)).parallelToolCalls, value);
    const code = agent({ id: "code-control", system: "Instructions.", parallelToolCalls: value });
    assertEquals((await createRuntimeAgentDefinitionFromAgent(code)).parallelToolCalls, value);
  }
  assertThrows(() =>
    parseRuntimeAgentMarkdownDefinition({
      id: "invalid-control",
      content: '---\nparallel-tool-calls: "false"\n---\nInstructions.',
    })
  );
  assertThrows(() =>
    parseRuntimeAgentMarkdownDefinition({
      id: "duplicate-control",
      content: "---\nparallel-tool-calls: false\nparallelToolCalls: true\n---\nInstructions.",
    })
  );
});

it("agent generation and streaming preserve sequential tool control without forcing tools", async () => {
  for (const value of [false, true, undefined]) {
    const seen: ModelRuntimeCallOptions[] = [];
    const model: ModelRuntime<ModelRuntimeCallOptions> = {
      specificationVersion: "v3",
      provider: "local",
      modelId: "control-fixture",
      doGenerate(options) {
        seen.push(options);
        return Promise.resolve({
          content: [{ type: "text", text: "done" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1 },
        });
      },
      doStream(options) {
        seen.push(options);
        return Promise.resolve({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "text-delta", delta: "done" });
              controller.enqueue({
                type: "finish",
                finishReason: "stop",
                usage: { inputTokens: 1, outputTokens: 1 },
              });
              controller.close();
            },
          }),
        });
      },
    };
    const runtime = agent({
      id: "control-capture",
      system: "Fixture instructions.",
      parallelToolCalls: value,
      tools: { load_skill: false, execute_skill_script: false },
      skills: false,
      resolveModelTransport: () => Promise.resolve({ model }),
    });
    await runtime.generate({ input: "fixture" });
    const stream = await runtime.stream({ input: "fixture" });
    await stream.toDataStreamResponse().text();
    assertEquals(seen.length, 2);
    for (const options of seen) {
      assertEquals(options.parallelToolCalls, value);
      assertEquals(Object.hasOwn(options, "parallelToolCalls"), value !== undefined);
      assertEquals(options.toolChoice, undefined);
      assertEquals(options.tools, undefined);
    }
  }
});
