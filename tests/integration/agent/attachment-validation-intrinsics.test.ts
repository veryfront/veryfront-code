import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { securityMiddleware } from "#veryfront/agent/middleware/security/validator.ts";
import type { AgentContext } from "#veryfront/agent/types.ts";

describe("private attachment validation", () => {
  it("keeps filenames and upload paths out of replaced trimStart", async () => {
    const marker = "synthetic-private-attachment-validation";
    const context: AgentContext = {
      agentId: "synthetic",
      model: "hosted/synthetic",
      data: {},
      platform: {},
      input: [{
        id: "user",
        role: "user",
        parts: [{
          type: "file",
          filename: `${marker}.txt`,
          mediaType: "text/plain",
          url: `https://example.test/${marker}`,
          uploadPath: `uploads/${marker}`,
        }],
      }],
    };
    const middleware = securityMiddleware({
      input: { blockedPatterns: [/synthetic-never-matches/] },
    });
    const original = String.prototype.trimStart;
    let observations = 0;
    let calls = 0;
    try {
      String.prototype.trimStart = function () {
        if (this.includes(marker)) observations++;
        return Reflect.apply(original, this, []);
      };
      await middleware(context, () => {
        calls++;
        return Promise.resolve({ text: "ok", messages: [], toolCalls: [], status: "completed" });
      });
    } finally {
      String.prototype.trimStart = original;
    }
    assertEquals(calls, 1);
    assertEquals(observations, 0);
  });
});
