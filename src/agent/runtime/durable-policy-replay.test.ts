import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { markTrustedHostToolProvenance } from "#veryfront/tool/host-tool-provenance.ts";
import type { Message, ToolResultPart } from "../types.ts";
import { AgentRuntime } from "./index.ts";
import { markRuntimeLocalTool } from "./local-tool.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";
import { markTrustedPlatformPolicyToolResultPart } from "./skill-policy-enforcement.ts";

for (const trusted of [true, false]) {
  it(`preserves only live trusted replay ownership through serializing memory (trusted=${trusted})`, async () => {
    const model = scriptedModel([{ text: "continued" }], { only: "generate" });
    const runtime = new AgentRuntime("durable-replay", {
      model: "veryfront-cloud/openai/durable-replay",
      system: "Continue after the form.",
      security: false,
      skills: false,
      maxSteps: 1,
      tools: {
        form_input: markRuntimeLocalTool(markTrustedHostToolProvenance(tool({
          id: "form_input",
          description: "Platform form",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({ submitted: true }),
        }))),
      },
    }, { resolveModelRuntime: () => model });
    let saved: Message[] = [];
    Reflect.set(runtime, "memory", {
      add: (message: Message) => {
        saved.push(JSON.parse(JSON.stringify(message)));
        return Promise.resolve();
      },
      getMessages: () => Promise.resolve(saved),
      clear: () => {
        saved = [];
        return Promise.resolve();
      },
    });
    const part: ToolResultPart = {
      type: "tool-result",
      toolCallId: "replayed-form",
      toolName: "form_input",
      result: { submitted: true },
    };
    if (trusted) markTrustedPlatformPolicyToolResultPart(part);
    await runtime.generate([
      { id: "user", role: "user", parts: [{ type: "text", text: "Continue" }] },
      {
        id: "result",
        role: "tool",
        parts: [part],
        metadata: { __veryfrontTrustedPlatformPolicyToolResultIds: ["replayed-form"] },
      },
    ]);
    assertEquals(model.toolNames(0).includes("form_input"), !trusted);
    assertEquals(
      saved.find((message) => message.id === "result")?.metadata
        ?.__veryfrontTrustedPlatformPolicyToolResultIds,
      trusted ? ["replayed-form"] : undefined,
    );
  });
}
