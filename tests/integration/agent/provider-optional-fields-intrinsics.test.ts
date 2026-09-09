import "#veryfront/schemas/_test-setup.ts";
import { convertToTextGenerationRuntimeMessages } from "#veryfront/agent/runtime/text-generation-runtime-message-converter.ts";
import { cleanContent } from "#veryfront/chat/provider-message-content.ts";
import { securityMiddleware } from "#veryfront/agent/middleware/security/validator.ts";
import { getTurnProviderRequestValidator } from "#veryfront/agent/middleware/turn-validation.ts";
import type { AgentContext, Message } from "#veryfront/agent/types.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

for (const hooks of [false, true]) {
  describe(`private provider optional fields ${hooks ? "hooks" : "baseline"}`, () => {
    it("replays local tool arguments without consulting an inherited provider flag", () => {
      const marker = "synthetic-private-provider-flag";
      const messages: Message[] = [{
        id: "assistant",
        role: "assistant",
        parts: [{
          type: "tool-call",
          toolCallId: "call",
          toolName: "inspect",
          args: { text: marker },
        }],
      }];
      const original = Object.getOwnPropertyDescriptor(Object.prototype, "providerExecuted");
      const descriptor = Object.getOwnPropertyDescriptor;
      const defineProperty = Object.defineProperty;
      let observations = 0;
      let converted;
      let cleaned;
      try {
        if (hooks) {
          defineProperty(Object.prototype, "providerExecuted", {
            configurable: true,
            get() {
              if (
                descriptor(this, "args")?.value?.text === marker ||
                descriptor(this, "input")?.value?.text === marker
              ) observations++;
              return undefined;
            },
          });
        }
        converted = convertToTextGenerationRuntimeMessages(messages);
        const first = converted[0]!;
        if (first.role === "assistant" && typeof first.content !== "string") {
          cleaned = cleanContent(first.content, first.role);
        }
      } finally {
        if (hooks) {
          if (original) defineProperty(Object.prototype, "providerExecuted", original);
          else Reflect.deleteProperty(Object.prototype, "providerExecuted");
        }
      }
      assertEquals(converted, [{
        role: "assistant",
        content: [{
          type: "tool-call",
          toolCallId: "call",
          toolName: "inspect",
          input: { text: marker },
        }],
      }]);
      assertEquals(observations, 0);
      assertEquals(cleaned, converted?.[0]?.content);
    });

    it("validates multiple trusted instruction layers without consulting Array.at", async () => {
      const marker = "synthetic-private-trusted-layer";
      const input: Message[] = [{
        id: "caller",
        role: "system",
        parts: [{ type: "text", text: "Synthetic caller instructions" }],
      }];
      const context: AgentContext = {
        agentId: "synthetic",
        input,
        model: "hosted/synthetic",
        data: {},
        platform: {},
      };
      await securityMiddleware({ input: {} })(
        context,
        () => Promise.resolve({ text: "ok", messages: [], toolCalls: [], status: "completed" }),
      );
      const at = Array.prototype.at;
      const stringify = JSON.stringify;
      const includes = String.prototype.includes;
      const apply = Reflect.apply;
      let observations = 0;
      let validated = false;
      try {
        if (hooks) {
          Array.prototype.at = function (...args) {
            if (apply(includes, stringify(this), [marker])) observations++;
            return apply(at, this, args);
          };
        }
        await getTurnProviderRequestValidator(context)!([
          { role: "system", content: `${marker} first` },
          { role: "system", content: `${marker} second` },
        ], input);
        validated = true;
      } finally {
        if (hooks) Array.prototype.at = at;
      }
      assertEquals(validated, true);
      assertEquals(observations, 0);
    });
  });
}
