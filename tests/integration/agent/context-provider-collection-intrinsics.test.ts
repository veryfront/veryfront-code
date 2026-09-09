import "#veryfront/schemas/_test-setup.ts";
import { buildAgentCallContext } from "#veryfront/agent/runtime/call-context.ts";
import { createInitialReducerState } from "#veryfront/agent/streaming/lifecycle/reducer.ts";
import { decodeRuntimeStreamPart } from "#veryfront/agent/streaming/lifecycle/runtime-provider-adapter.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

for (const probe of ["baseline", "arrays", "strings", "find"]) {
  describe(`private context and provider collections ${probe}`, () => {
    it("assembles project instructions and reads accumulated tool input without shared hooks", () => {
      const marker = "synthetic-private-call-context";
      const input = {
        instructions: `Base ${marker}<!-- veryfront-runtime-context -->Tail`,
        projectInstructions: marker,
        extraBlocks: [`<custom>${marker}</custom>`],
      };
      const structured = {
        ...input,
        instructions: [{ role: "system" as const, content: input.instructions }],
      };
      const expected = buildAgentCallContext(input);
      const expectedStructured = buildAgentCallContext(structured);
      const snapshot = createInitialReducerState().snapshot;
      snapshot.tools = [{
        id: "call",
        name: "inspect",
        phase: "input_streaming",
        inputText: marker,
        inputDeltas: [marker],
      }];
      const options = {
        availableToolNames: new Set(["inspect"]),
        providerExecutedToolNames: new Set<string>(),
      };
      const stringify = JSON.stringify;
      const includes = String.prototype.includes;
      const apply = Reflect.apply;
      const defineProperty = Object.defineProperty;
      const originals: { target: object; key: PropertyKey; descriptor: PropertyDescriptor }[] = [];
      let observations = 0;
      const observe = (value: unknown) => {
        if (apply(includes, stringify(value) ?? "", [marker])) observations++;
      };
      const replace = (target: object, key: PropertyKey) => {
        const descriptor = Object.getOwnPropertyDescriptor(target, key)!;
        originals.push({ target, key, descriptor });
        defineProperty(target, key, {
          ...descriptor,
          value: function (this: unknown, ...args: unknown[]) {
            observe(this);
            if (key === "push") observe(args);
            return apply(descriptor.value, this, args);
          },
        });
      };
      let messages;
      let structuredMessages;
      let signals;
      try {
        if (probe === "arrays") {
          for (const key of ["push", "join", "map", "flatMap", "filter", Symbol.iterator]) {
            replace(Array.prototype, key);
          }
        }
        if (probe === "strings") {
          for (const key of ["indexOf", "slice", "trim", "trimStart", "trimEnd", "startsWith"]) {
            replace(String.prototype, key);
          }
        }
        if (probe === "find") replace(Array.prototype, "find");
        messages = buildAgentCallContext(input);
        structuredMessages = buildAgentCallContext(structured);
        signals = decodeRuntimeStreamPart(
          { type: "tool-input-delta", id: "call", delta: "next" },
          snapshot,
          options,
        );
      } finally {
        for (let index = originals.length - 1; index >= 0; index--) {
          const original = originals[index]!;
          defineProperty(original.target, original.key, original.descriptor);
        }
      }
      assertEquals(messages, expected);
      assertEquals(structuredMessages, expectedStructured);
      assertEquals(signals, [{
        kind: "protocol",
        event: { type: "tool_input_content", toolCallId: "call", delta: "next" },
      }]);
      assertEquals(observations, 0);
    });
  });
}
