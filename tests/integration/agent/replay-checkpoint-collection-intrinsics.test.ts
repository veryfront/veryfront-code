import "#veryfront/schemas/_test-setup.ts";
import {
  applyProviderReplayCheckpointsToMessages,
  captureProviderReplayCheckpoint,
  createProviderReplayCheckpointEmissionState,
  type ProviderReplayCheckpoint,
} from "#veryfront/agent/runtime/provider-replay.ts";
import { readAttachedProviderMetadata } from "#veryfront/agent/runtime/provider-metadata.ts";
import type { Message } from "#veryfront/agent/types.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

for (const probe of ["baseline", "append", "iteration", "projection", "reflection"]) {
  describe(`private replay checkpoint collections ${probe}`, () => {
    it("captures cumulative reasoning and restores its checkpoint without shared collection hooks", () => {
      const marker = "synthetic-private-checkpoint-block";
      const thinking = { type: "thinking", thinking: marker, signature: "synthetic-signature" };
      const text = { type: "text" as const, text: marker };
      const first = { anthropic: { rawAssistantMessages: [[thinking]] } };
      const second = { anthropic: { rawAssistantMessages: [[text]] } };
      const messages: Message[] = [{
        id: "assistant",
        role: "assistant",
        parts: [{ type: "reasoning", text: marker, signature: thinking.signature }, text],
      }];
      const state = createProviderReplayCheckpointEmissionState({ messageId: "assistant" });
      const stringify = JSON.stringify;
      const includes = String.prototype.includes;
      const apply = Reflect.apply;
      const defineProperty = Object.defineProperty;
      const originals: { target: object; key: PropertyKey; descriptor: PropertyDescriptor }[] = [];
      let observations = 0;
      const observe = (value: unknown) => {
        try {
          if (apply(includes, stringify(value) ?? "", [marker])) observations++;
        } catch { /* Preserve normal delegation for unrelated non-JSON values. */ }
      };
      const replace = (target: object, key: PropertyKey, args = false) => {
        const descriptor = Object.getOwnPropertyDescriptor(target, key)!;
        originals.push({ target, key, descriptor });
        defineProperty(target, key, {
          ...descriptor,
          value: function (this: unknown, ...values: unknown[]) {
            observe(args ? values : this);
            return apply(descriptor.value, this, values);
          },
        });
      };
      let checkpoint: ProviderReplayCheckpoint | undefined;
      let restored: ReturnType<typeof createProviderReplayCheckpointEmissionState> | undefined;
      try {
        if (probe === "append") replace(Array.prototype, "push", true);
        if (probe === "iteration") replace(Array.prototype, Symbol.iterator);
        if (probe === "projection") {
          for (const key of ["some", "map", "filter", "flat", "flatMap", "slice"]) {
            replace(Array.prototype, key);
          }
        }
        if (probe === "reflection") {
          replace(Object, "keys", true);
          replace(Object, "entries", true);
          replace(Reflect, "ownKeys", true);
          replace(Array, "isArray", true);
        }
        captureProviderReplayCheckpoint(state, first);
        checkpoint = captureProviderReplayCheckpoint(state, second);
        restored = createProviderReplayCheckpointEmissionState({
          messageId: "assistant",
          existingCheckpoint: checkpoint,
        });
        applyProviderReplayCheckpointsToMessages(messages, [checkpoint!], {
          activeProvider: "anthropic",
        });
      } finally {
        for (let index = originals.length - 1; index >= 0; index--) {
          const original = originals[index]!;
          defineProperty(original.target, original.key, original.descriptor);
        }
      }
      assertEquals(checkpoint?.providerMessageBlockCounts, [1, 1]);
      assertEquals(checkpoint?.providerBlocks.map((entry) => entry.block), [thinking, text]);
      assertEquals(restored?.rawAssistantMessages, [[thinking], [text]]);
      assertEquals(restored?.replayRequired, true);
      assertEquals(readAttachedProviderMetadata(messages[0]!)?.anthropic, {
        rawAssistantMessages: [[thinking], [text]],
      });
      assertEquals(observations, 0);
    });
  });
}
