import "#veryfront/schemas/_test-setup.ts";
import { createStreamState } from "#veryfront/agent/runtime/chat-stream-handler.ts";
import { createStreamLifecycleShadow } from "#veryfront/agent/runtime/stream-lifecycle-shadow.ts";
import { runStreamLifecycle } from "#veryfront/agent/streaming/lifecycle/runner.ts";
import { createScriptedStreamProvider } from "#veryfront/agent/streaming/lifecycle/testing.ts";
import type { StreamSignal } from "#veryfront/agent/streaming/lifecycle/types.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

for (const mode of ["shadow", "active"] as const) {
  for (const probe of ["baseline", "iterator", "projection", "map lookup", "reflection"] as const) {
    describe(`private lifecycle signals ${mode} ${probe}`, () => {
      it("preserves private content through signal reduction and comparison", async () => {
        const marker = "synthetic-private-lifecycle-signal";
        const shadow = createStreamLifecycleShadow({
          availableToolNames: ["inspect"],
          providerExecutedToolNames: ["inspect"],
        });
        const legacy = {
          ...createStreamState(),
          accumulatedText: marker,
          reasoningParts: [{ id: "r1", text: marker }],
          finishReason: "stop",
          toolCalls: new Map([["call", {
            id: "call",
            name: "inspect",
            arguments: JSON.stringify({ text: marker }),
            providerExecuted: true,
            inputAvailable: true,
          }]]),
          toolResults: [{
            toolCallId: "call",
            toolName: "inspect",
            output: { items: [marker] },
            providerExecuted: true,
            preliminary: false,
          }],
        };
        const provider = createScriptedStreamProvider<StreamSignal>([
          { kind: "protocol", event: { type: "text_content", delta: marker } },
          { kind: "protocol", event: { type: "reasoning_content", id: "r1", delta: marker } },
          { kind: "protocol", event: { type: "reasoning_end", id: "r1" } },
          { kind: "protocol", event: { type: "step_finish", finishReason: "stop" } },
        ]);
        const parts = [
          { type: "text-delta", text: marker },
          { type: "reasoning-start", id: "r1" },
          { type: "reasoning-delta", id: "r1", delta: marker },
          { type: "reasoning-end", id: "r1" },
          { type: "tool-input-start", id: "call", toolName: "inspect" },
          {
            type: "tool-input-available",
            id: "call",
            toolName: "inspect",
            input: { text: marker },
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: "call",
            toolName: "inspect",
            output: { items: [marker] },
            providerExecuted: true,
            preliminary: false,
          },
          { type: "finish", finishReason: "stop" },
        ];
        const apply = Reflect.apply;
        const stringify = JSON.stringify;
        const includes = String.prototype.includes;
        const defineProperty = Object.defineProperty;
        const originals: { target: object; key: PropertyKey; descriptor: PropertyDescriptor }[] =
          [];
        let observations = 0;
        const replace = (target: object, key: PropertyKey, observeArgument = false) => {
          const descriptor = Object.getOwnPropertyDescriptor(target, key)!;
          originals.push({ target, key, descriptor });
          defineProperty(target, key, {
            ...descriptor,
            value: function (this: unknown, ...args: unknown[]) {
              if (
                apply(includes, stringify(observeArgument ? args[0] : this) ?? "", [marker])
              ) observations++;
              const result = apply(descriptor.value, this, args);
              if (
                target === Map.prototype && apply(includes, stringify(result) ?? "", [marker])
              ) observations++;
              return result;
            },
          });
        };
        let report: ReturnType<typeof shadow.compareLegacySnapshot> | undefined;
        let outcome: Awaited<ReturnType<typeof runStreamLifecycle>["outcome"]> | undefined;
        try {
          if (probe === "iterator") replace(Array.prototype, Symbol.iterator);
          if (probe === "projection") {
            for (const key of ["map", "filter", "every", "join"]) replace(Array.prototype, key);
          }
          if (probe === "map lookup") replace(Map.prototype, "get");
          if (probe === "reflection") {
            replace(Object, "keys", true);
            replace(Array, "isArray", true);
          }
          if (mode === "shadow") {
            for (let index = 0; index < parts.length; index++) shadow.observePart(parts[index]);
            report = shadow.compareLegacySnapshot(legacy);
          } else {
            const run = runStreamLifecycle({ provider });
            await Array.fromAsync(run.frames);
            outcome = await run.outcome;
          }
        } finally {
          for (let index = originals.length - 1; index >= 0; index--) {
            const original = originals[index]!;
            defineProperty(original.target, original.key, original.descriptor);
          }
        }
        if (mode === "shadow") assertEquals(report, { count: 0, categories: [] });
        else {
          assertEquals(outcome?.status, "completed");
          assertEquals(outcome?.snapshot.accumulatedText, marker);
          assertEquals(outcome?.snapshot.reasoning[0]?.text, marker);
        }
        assertEquals(observations, 0);
      });
    });
  }
}
