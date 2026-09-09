import "#veryfront/schemas/_test-setup.ts";
import { securityMiddleware } from "#veryfront/agent/middleware/security/validator.ts";
import { getTurnProviderRequestValidator } from "#veryfront/agent/middleware/turn-validation.ts";
import type { AgentContext, Message } from "#veryfront/agent/types.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

for (const hooks of [false, true]) {
  describe(`private validation promises and strings ${hooks ? "hooks" : "baseline"}`, () => {
    it("rejects blocked input without exposing resolved violations through Promise.all", async () => {
      const marker = "synthetic-private-validation-violation";
      const context: AgentContext = {
        agentId: "synthetic",
        input: marker,
        model: "hosted/synthetic",
        data: {},
        platform: {},
      };
      const NativePromise = Promise;
      const all = Promise.all;
      const then = Promise.prototype.then;
      const stringify = JSON.stringify;
      const includes = String.prototype.includes;
      const apply = Reflect.apply;
      let observations = 0;
      let rejected = false;
      try {
        if (hooks) {
          Promise.all = ((values: Iterable<Promise<unknown>>) => {
            for (const value of values) {
              apply(then, value, [(result: unknown) => {
                if (apply(includes, stringify(result) ?? "", [marker])) observations++;
              }, () => undefined]);
            }
            return apply(all, NativePromise, [values]);
          }) as typeof all;
        }
        try {
          await securityMiddleware({ input: { blockedPatterns: [/synthetic-private/] } })(
            context,
            () => Promise.resolve({ text: "ok", messages: [], toolCalls: [], status: "completed" }),
          );
        } catch {
          rejected = true;
        }
      } finally {
        if (hooks) Promise.all = all;
      }
      assertEquals(rejected, true);
      assertEquals(observations, 0);
    });

    it("retains trusted word-boundary matches without exposing the segment to String.at", async () => {
      const marker = "synthetic-private-trusted";
      const input: Message[] = [{
        id: "caller",
        role: "system",
        parts: [{ type: "text", text: "allowed" }],
      }];
      const context: AgentContext = {
        agentId: "synthetic",
        input,
        model: "hosted/synthetic",
        data: {},
        platform: {},
      };
      await securityMiddleware({ input: { blockedPatterns: [/\bsynthetic-private-trusted\b/] } })(
        context,
        () => Promise.resolve({ text: "ok", messages: [], toolCalls: [], status: "completed" }),
      );
      const at = String.prototype.at;
      const includes = String.prototype.includes;
      const apply = Reflect.apply;
      let observations = 0;
      let validated = false;
      try {
        if (hooks) {
          String.prototype.at = function (...args) {
            if (apply(includes, this, [marker])) observations++;
            return apply(at, this, args);
          };
        }
        await getTurnProviderRequestValidator(context)!(marker, input);
        validated = true;
      } finally {
        if (hooks) String.prototype.at = at;
      }
      assertEquals(validated, true);
      assertEquals(observations, 0);
    });
  });
}
