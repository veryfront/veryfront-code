import "#veryfront/schemas/_test-setup.ts";
import { convertToTextGenerationRuntimeMessages } from "#veryfront/agent/runtime/text-generation-runtime-message-converter.ts";
import { cleanContent } from "#veryfront/chat/provider-message-content.ts";
import { normalizeInput } from "#veryfront/agent/runtime/input-utils.ts";
import { securityMiddleware } from "#veryfront/agent/middleware/security/validator.ts";
import { getTurnProviderRequestValidator } from "#veryfront/agent/middleware/turn-validation.ts";
import type { AgentContext, Message } from "#veryfront/agent/types.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

for (const hooks of [false, true]) {
  describe(`private provider optional fields ${hooks ? "hooks" : "baseline"}`, () => {
    it("validates message ids without exposing them to a replaced trim method", () => {
      const marker = " synthetic-private-message-id ";
      const input: Message[] = [{
        id: marker,
        role: "user",
        parts: [{ type: "text", text: "hello" }],
        timestamp: 1,
      }];
      const trim = String.prototype.trim;
      const apply = Reflect.apply;
      let observations = 0;
      let normalized;
      try {
        if (hooks) {
          String.prototype.trim = function () {
            if (this === marker) observations++;
            return apply(trim, this, []);
          };
        }
        normalized = normalizeInput(input);
        assertThrows(
          () => normalizeInput([{ id: " \t ", role: "user", parts: [] }]),
          Error,
          "Message id cannot be empty",
        );
      } finally {
        if (hooks) String.prototype.trim = trim;
      }
      assertEquals(normalized, input);
      assertEquals(observations, 0);
    });
    it("keeps attachment data out of inherited filename and data getters", () => {
      const marker = "synthetic-private-attachment-fields";
      const part = {
        type: "image",
        mediaType: "image/png",
        url: `data:image/png;base64,${marker}`,
      };
      const getDescriptor = Object.getOwnPropertyDescriptor;
      const defineProperty = Object.defineProperty;
      const filename = getDescriptor(Object.prototype, "filename");
      const data = getDescriptor(Object.prototype, "data");
      let observations = 0;
      let cleaned;
      try {
        if (hooks) {
          for (const key of ["filename", "data"]) {
            defineProperty(Object.prototype, key, {
              configurable: true,
              get() {
                if (getDescriptor(this, "url")?.value === part.url) observations++;
                return undefined;
              },
            });
          }
        }
        cleaned = cleanContent([part], "user");
      } finally {
        if (hooks) {
          if (filename) defineProperty(Object.prototype, "filename", filename);
          else Reflect.deleteProperty(Object.prototype, "filename");
          if (data) defineProperty(Object.prototype, "data", data);
          else Reflect.deleteProperty(Object.prototype, "data");
        }
      }
      assertEquals(cleaned, [part]);
      assertEquals(observations, 0);
    });
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
