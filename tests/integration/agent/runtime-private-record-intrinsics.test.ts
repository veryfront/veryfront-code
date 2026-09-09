import "#veryfront/schemas/_test-setup.ts";
import { createEphemeralAgentWithRuntimeOptions } from "#veryfront/agent/factory.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { parseToolArgs } from "#veryfront/agent/runtime/tool-helpers.ts";
import { createStreamState, processStream } from "#veryfront/agent/runtime/chat-stream-handler.ts";
import {
  createMockResult,
  createSSECollector,
} from "#veryfront/agent/runtime/chat-stream-handler.test-helpers.ts";
import { tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

for (const hooks of [false, true]) {
  describe(`private runtime records ${hooks ? "hooks" : "baseline"}`, () => {
    for (const mode of ["generate", "stream"] as const) {
      for (const scenario of ["system prompt", "submitted form"] as const) {
        it(`protects ${scenario} through ${mode}`, async () => {
          const marker = "synthetic-private-runtime-record";
          const form = scenario === "submitted form";
          const model = scriptedModel(
            form
              ? [
                { toolCalls: [{ id: "form", name: "form_input", input: {} }] },
                { text: "Complete" },
              ]
              : [{ text: "Complete" }],
            { only: mode },
          );
          let executions = 0;
          let submittedObserved = false;
          const runtime = createEphemeralAgentWithRuntimeOptions({
            model: "veryfront-cloud/openai/gpt-5.4",
            system: form ? "Use the form result." : marker,
            skills: false,
            maxSteps: 2,
            resolveRuntimeState: ({ context }) => {
              if (context?.hasSubmittedFormInputResult === true) submittedObserved = true;
              return undefined;
            },
            ...(form
              ? {
                tools: {
                  form_input: tool({
                    id: "form_input",
                    description: "Collect a synthetic response",
                    inputSchema: defineSchema((v) => v.object({}))(),
                    execute: () => {
                      executions++;
                      return JSON.stringify({
                        envelope: { submitted: true, values: { text: marker } },
                      });
                    },
                  }),
                },
              }
              : {}),
          }, { resolveModelRuntime: () => model });
          const apply = Reflect.apply;
          const stringify = JSON.stringify;
          const includes = String.prototype.includes;
          const defineProperty = Object.defineProperty;
          const originals = (form
            ? [{ target: Object, key: "values", receiver: false }, {
              target: Array.prototype,
              key: "some",
              receiver: true,
            }]
            : [{ target: Array, key: "isArray", receiver: false }]).map((entry) => ({
              ...entry,
              descriptor: Object.getOwnPropertyDescriptor(entry.target, entry.key)!,
            }));
          let observations = 0;
          let output = "";
          try {
            if (hooks) {
              for (let index = 0; index < originals.length; index++) {
                const original = originals[index]!;
                defineProperty(original.target, original.key, {
                  ...original.descriptor,
                  value: function (this: unknown, ...args: unknown[]) {
                    if (
                      apply(includes, stringify(original.receiver ? this : args[0]) ?? "", [marker])
                    ) {
                      observations++;
                    }
                    return apply(original.descriptor.value, this, args);
                  },
                });
              }
            }
            output = mode === "stream"
              ? await (await runtime.stream({ input: "Complete the task" })).toDataStreamResponse()
                .text()
              : (await runtime.generate({ input: "Complete the task" })).text;
          } finally {
            for (let index = 0; index < originals.length; index++) {
              const original = originals[index]!;
              defineProperty(original.target, original.key, original.descriptor);
            }
          }
          assertStringIncludes(output, "Complete");
          assertEquals(model.callCount, form ? 2 : 1);
          assertEquals(executions, form ? 1 : 0);
          assertEquals(submittedObserved, form);
          assertEquals(observations, 0);
        });
      }
    }
    it("parses serialized tool arguments without exposing the parsed record", async () => {
      const marker = "synthetic-private-parsed-arguments";
      const serialized = JSON.stringify({ query: marker });
      const state = createStreamState();
      const { events, controller, encoder } = createSSECollector();
      const result = createMockResult([
        { type: "tool-input-start", id: "call", toolName: "inspect" },
        { type: "tool-call", toolCallId: "call", toolName: "inspect", input: serialized },
        { type: "finish", finishReason: "tool-calls" },
      ]);
      const isArray = Array.isArray;
      const stringify = JSON.stringify;
      const includes = String.prototype.includes;
      const apply = Reflect.apply;
      let observations = 0;
      let parsed;
      let rejected;
      try {
        if (hooks) {
          Array.isArray = ((value: unknown) => {
            if (apply(includes, stringify(value) ?? "", [marker])) observations++;
            return isArray(value);
          }) as typeof Array.isArray;
        }
        await processStream(result, state, controller, encoder, "text", undefined);
        parsed = parseToolArgs(serialized);
        rejected = parseToolArgs("[]");
      } finally {
        if (hooks) Array.isArray = isArray;
      }
      assertEquals(parsed, { args: { query: marker } });
      assertEquals(rejected?.error, "Tool call arguments must be a JSON object");
      assertEquals(events.find((event) => event.type === "tool-input-available")?.input, {
        query: marker,
      });
      assertEquals(observations, 0);
    });
  });
}
