import "#veryfront/schemas/_test-setup.ts";
import { securityMiddleware } from "#veryfront/agent/middleware/security/validator.ts";
import {
  getTurnInputValidator,
  getTurnMessageProjectionValidator,
  getTurnMessageValidator,
  getTurnProviderRequestValidator,
} from "#veryfront/agent/middleware/turn-validation.ts";
import type { AgentContext, Message } from "#veryfront/agent/types.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

for (const probe of ["baseline", "JSON", "iterator", "splice"]) {
  describe(`private validation text aggregation ${probe}`, () => {
    it("validates structured input and resolved turn text without shared serialization or iteration", async () => {
      const marker = "synthetic-private-validation-aggregation";
      const input: Message[] = [
        { id: "system", role: "system", parts: [{ type: "text", text: marker }] },
        {
          id: "user",
          role: "user",
          parts: [
            { type: "text", text: marker },
            { type: "text", text: "follow-up" },
            { type: "tool-call", toolCallId: "call", toolName: "inspect", args: { text: marker } },
          ],
        },
        { id: "user2", role: "user", parts: [{ type: "text", text: "continuation" }] },
      ];
      const context: AgentContext = {
        agentId: "synthetic",
        input,
        model: "hosted/synthetic",
        data: {},
        platform: {},
      };
      const stringify = JSON.stringify;
      const iterator = Array.prototype[Symbol.iterator];
      const splice = Array.prototype.splice;
      const includes = String.prototype.includes;
      const apply = Reflect.apply;
      let observations = 0;
      const observe = (value: unknown) => {
        if (apply(includes, stringify(value) ?? "", [marker])) observations++;
      };
      let completed = false;
      try {
        if (probe === "JSON") {
          JSON.stringify = ((...args: unknown[]) => {
            observe(args[0]);
            return apply(stringify, JSON, args);
          }) as typeof stringify;
        }
        if (probe === "iterator") {
          Array.prototype[Symbol.iterator] = function () {
            observe(this);
            return apply(iterator, this, []);
          };
        }
        if (probe === "splice") {
          Array.prototype.splice = function (...args: unknown[]) {
            observe(this);
            return apply(splice, this, args);
          };
        }
        await securityMiddleware({ input: {} })(
          context,
          () => Promise.resolve({ text: "ok", messages: [], toolCalls: [], status: "completed" }),
        );
        await getTurnInputValidator(context)!(input);
        await getTurnMessageValidator(context)!([], input);
        await getTurnMessageProjectionValidator(context)!(input, input);
        await getTurnProviderRequestValidator(context)!([
          { role: "system", content: marker },
          { role: "system", content: "additional instructions" },
        ], input);
        completed = true;
      } finally {
        if (probe === "JSON") JSON.stringify = stringify;
        if (probe === "iterator") Array.prototype[Symbol.iterator] = iterator;
        if (probe === "splice") Array.prototype.splice = splice;
      }
      assertEquals(completed, true);
      assertEquals(observations, 0);
    });
  });
}
