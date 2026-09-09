import "#veryfront/schemas/_test-setup.ts";
import type { AgentContext, Message } from "#veryfront/agent/types.ts";
import {
  InputValidator,
  OutputFilter,
  securityMiddleware,
} from "#veryfront/agent/middleware/security/validator.ts";
import { getTurnMessageValidator } from "#veryfront/agent/middleware/turn-validation.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

for (const hooks of [false, true]) {
  describe(`private validation buffers ${hooks ? "hooks" : "baseline"}`, () => {
    it("validates adjacent messages and violations without exposing appended content", async () => {
      const marker = "synthetic-private-validation-content";
      const messages: Message[] = [
        { id: "s1", role: "system", parts: [{ type: "text", text: marker }] },
        { id: "s2", role: "system", parts: [{ type: "text", text: "instructions" }] },
        { id: "u1", role: "user", parts: [{ type: "text", text: marker }] },
        { id: "u2", role: "user", parts: [{ type: "text", text: "question" }] },
      ];
      const context: AgentContext = {
        agentId: "synthetic",
        input: messages,
        model: "hosted/synthetic",
        data: {},
        platform: {},
      };
      const push = Array.prototype.push;
      const stringify = JSON.stringify;
      const includes = String.prototype.includes;
      const apply = Reflect.apply;
      const inputValidator = new InputValidator({ blockedPatterns: [/synthetic-private/] });
      const outputFilter = new OutputFilter({ blockedPatterns: [/synthetic-private/] });
      let observations = 0;
      let completed = false;
      let inputViolations = 0;
      let outputViolations = 0;
      try {
        if (hooks) {
          Array.prototype.push = function (...items) {
            for (let index = 0; index < items.length; index++) {
              const serialized = stringify(items[index]);
              if (serialized && apply(includes, serialized, [marker])) observations++;
            }
            return apply(push, this, items);
          };
        }
        const response = await securityMiddleware({ input: {} })(
          context,
          () => Promise.resolve({ text: "ok", messages: [], toolCalls: [], status: "completed" }),
        );
        await getTurnMessageValidator(context)!([], messages);
        inputViolations = (await inputValidator.validate(marker)).violations.length;
        outputViolations = (await outputFilter.filter(marker)).violations.length;
        completed = response.status === "completed";
      } finally {
        if (hooks) Array.prototype.push = push;
      }
      assertEquals(completed, true);
      assertEquals(inputViolations, 1);
      assertEquals(outputViolations, 1);
      assertEquals(observations, 0);
    });
  });
}
