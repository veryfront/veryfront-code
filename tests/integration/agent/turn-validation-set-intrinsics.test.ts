import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { AgentContext, Message } from "#veryfront/agent/types.ts";
import { securityMiddleware } from "#veryfront/agent/middleware/security/validator.ts";
import { getTurnMessageValidator } from "#veryfront/agent/middleware/turn-validation.ts";

describe("private turn membership", () => {
  for (const probe of ["Set constructor", "array iterator"]) {
    it(`keeps current messages out of the replaced ${probe} when history exists`, async () => {
      const turnInput: Message[] = [{
        id: "current",
        role: "user",
        parts: [{ type: "text", text: "Synthetic current input" }],
      }];
      const history: Message[] = [{
        id: "earlier",
        role: "user",
        parts: [{ type: "text", text: "Synthetic earlier input" }],
      }];
      const context: AgentContext = {
        agentId: "synthetic",
        input: turnInput,
        model: "hosted/synthetic",
        data: {},
        platform: {},
      };
      await securityMiddleware({ input: { blockedPatterns: [/synthetic-never-matches/] } })(
        context,
        () =>
          Promise.resolve({
            text: "ok",
            messages: [],
            toolCalls: [],
            status: "completed",
          }),
      );
      const validate = getTurnMessageValidator(context)!;
      const NativeSet = Set;
      const iterator = Array.prototype[Symbol.iterator];
      let exposures = 0;
      try {
        if (probe === "Set constructor") {
          globalThis.Set = class<T> extends NativeSet<T> {
            constructor(values?: Iterable<T> | null) {
              if (values === turnInput) exposures++;
              super(values);
            }
          };
        } else {
          Array.prototype[Symbol.iterator] = function () {
            if (this === turnInput) exposures++;
            return Reflect.apply(iterator, this, []);
          };
        }
        await validate(history, turnInput);
      } finally {
        globalThis.Set = NativeSet;
        Array.prototype[Symbol.iterator] = iterator;
      }
      assertEquals(exposures, 0);
    });
  }
});
