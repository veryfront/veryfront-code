import "#veryfront/schemas/_test-setup.ts";
import { cleanContent, hasValidContent } from "#veryfront/chat/provider-message-content.ts";
import type { ChatUserContentPart, ProviderModelMessage } from "#veryfront/chat/types.ts";
import { convertAgentRuntimeMessagesToProviderMessages } from "#veryfront/agent/runtime/message-adapter.ts";
import {
  flattenSystemInstructions,
  withRuntimeToolInventory,
} from "#veryfront/agent/runtime/tool-inventory.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

for (const probe of ["baseline", "array methods", "text methods", "array iterator", "array type"]) {
  describe(`private provider replay inputs ${probe}`, () => {
    it("preserves provider content, instructions and replay without mutable lookups", () => {
      const marker = "synthetic-private-replay-input";
      const content: ChatUserContentPart[] = [
        { type: "text", text: ` ${marker} ` },
        { type: "file", url: `https://example.com/${marker}`, mediaType: "text/plain" },
      ];
      const instructions = [{ role: "system" as const, content: ` ${marker} ` }];
      const replayInput = [{
        role: "assistant" as const,
        parts: [
          { type: "text", text: marker },
          { type: "reasoning", text: marker },
          { type: "tool_call", id: "call", name: "inspect", input: { query: marker } },
          { type: "tool_result", tool_call_id: "call", output: { text: marker } },
          { type: "text", text: "Complete" },
        ],
      }] satisfies Parameters<typeof convertAgentRuntimeMessagesToProviderMessages>[0];
      const expectedReplay = convertAgentRuntimeMessagesToProviderMessages(replayInput);
      const expectedInstructions = flattenSystemInstructions(
        withRuntimeToolInventory(instructions, []),
      );
      const stringify = JSON.stringify;
      const includes = String.prototype.includes;
      const apply = Reflect.apply;
      const defineProperty = Object.defineProperty;
      const originals: { target: object; key: PropertyKey; descriptor: PropertyDescriptor }[] = [];
      let observations = 0;
      const observe = (value: unknown) => {
        try {
          if (apply(includes, stringify(value) ?? "", [marker])) observations++;
        } catch { /* A hook delegates normally for unrelated non-JSON values. */ }
      };
      const replace = (target: object, key: PropertyKey, observeArgument = false) => {
        const descriptor = Object.getOwnPropertyDescriptor(target, key)!;
        originals.push({ target, key, descriptor });
        defineProperty(target, key, {
          ...descriptor,
          value: function (this: unknown, ...args: unknown[]) {
            observe(observeArgument ? args[0] : this);
            return apply(descriptor.value, this, args);
          },
        });
      };
      let cleaned: unknown;
      let validText = false;
      let validContent = false;
      let flattened = "";
      let inventory = "";
      let replay: ProviderModelMessage[] = [];
      try {
        if (probe === "array methods") {
          for (const key of ["some", "map", "filter", "join"]) replace(Array.prototype, key);
        } else if (probe === "text methods") {
          for (const key of ["trim", "trimEnd", "lastIndexOf", "slice", "startsWith", "endsWith"]) {
            replace(String.prototype, key);
          }
        } else if (probe === "array iterator") {
          replace(Array.prototype, Symbol.iterator);
        } else if (probe === "array type") {
          replace(Array, "isArray", true);
        }
        cleaned = cleanContent(content, "user");
        validText = hasValidContent({ role: "user", content: marker });
        validContent = hasValidContent({ role: "user", content });
        flattened = flattenSystemInstructions(instructions);
        const first = withRuntimeToolInventory(instructions, []);
        inventory = flattenSystemInstructions(withRuntimeToolInventory(first, []));
        replay = convertAgentRuntimeMessagesToProviderMessages(replayInput);
      } finally {
        for (let index = originals.length - 1; index >= 0; index--) {
          const original = originals[index]!;
          defineProperty(original.target, original.key, original.descriptor);
        }
      }
      assertEquals(cleaned, content);
      assertEquals(validText, true);
      assertEquals(validContent, true);
      assertEquals(flattened, marker);
      assertEquals(inventory, expectedInstructions);
      assertEquals(replay, expectedReplay);
      assertEquals(observations, 0);
    });
  });
}
