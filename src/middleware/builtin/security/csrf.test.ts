import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { csrfProtection } from "./csrf.ts";

function makeCtx(method: string, headers: Record<string, string> = {}): {
  request: Request;
} {
  return {
    request: new Request("http://localhost/api/data", { method, headers }),
  };
}

/**
 * A downstream handler that records whether it ran. Status alone cannot tell
 * "the forged request was blocked" from "the handler ran and its response was
 * discarded", which is the whole property CSRF protection provides.
 */
function countingNext(): { next: () => Promise<Response>; getCalls: () => number } {
  let calls = 0;
  return {
    next: () => {
      calls++;
      return Promise.resolve(new Response("ok", { status: 200 }));
    },
    getCalls: () => calls,
  };
}

describe("middleware/builtin/security/csrf", () => {
  describe("csrfProtection", () => {
    it("should allow GET requests without token", async () => {
      const mw = csrfProtection(() => true);
      const { next, getCalls } = countingNext();
      const res = await mw(makeCtx("GET"), next);
      assertEquals(res?.status, 200);
      assertEquals(
        getCalls(),
        1,
        "an accepted request must reach the downstream handler exactly once",
      );
    });

    it("should allow HEAD requests without token", async () => {
      const mw = csrfProtection(() => true);
      const { next, getCalls } = countingNext();
      const res = await mw(makeCtx("HEAD"), next);
      assertEquals(res?.status, 200);
      assertEquals(
        getCalls(),
        1,
        "an accepted request must reach the downstream handler exactly once",
      );
    });

    it("should reject POST without token", async () => {
      const mw = csrfProtection(() => true);
      const { next, getCalls } = countingNext();
      const res = await mw(makeCtx("POST"), next);
      assertEquals(res?.status, 403);
      assertEquals(getCalls(), 0, "a rejected CSRF request must not invoke the downstream handler");
    });

    it("should reject POST with invalid token", async () => {
      const mw = csrfProtection((t) => t === "valid");
      const { next, getCalls } = countingNext();
      const res = await mw(makeCtx("POST", { "X-CSRF-Token": "invalid" }), next);
      assertEquals(res?.status, 403);
      assertEquals(getCalls(), 0, "a rejected CSRF request must not invoke the downstream handler");
    });

    it("should allow POST with valid token", async () => {
      const mw = csrfProtection((t) => t === "valid");
      const { next, getCalls } = countingNext();
      const res = await mw(makeCtx("POST", { "X-CSRF-Token": "valid" }), next);
      assertEquals(res?.status, 200);
      assertEquals(
        getCalls(),
        1,
        "an accepted request must reach the downstream handler exactly once",
      );
    });

    it("should check PUT requests", async () => {
      const mw = csrfProtection((t) => t === "ok");
      const { next, getCalls } = countingNext();
      const res = await mw(makeCtx("PUT", { "X-CSRF-Token": "ok" }), next);
      assertEquals(res?.status, 200);
      assertEquals(
        getCalls(),
        1,
        "an accepted request must reach the downstream handler exactly once",
      );
    });

    it("should check DELETE requests", async () => {
      const mw = csrfProtection(() => false);
      const { next, getCalls } = countingNext();
      const res = await mw(makeCtx("DELETE", { "X-CSRF-Token": "any" }), next);
      assertEquals(res?.status, 403);
      assertEquals(getCalls(), 0, "a rejected CSRF request must not invoke the downstream handler");
    });

    it("should check PATCH requests", async () => {
      const mw = csrfProtection((t) => t === "patch-token");
      const { next, getCalls } = countingNext();
      const res = await mw(makeCtx("PATCH", { "X-CSRF-Token": "patch-token" }), next);
      assertEquals(res?.status, 200);
      assertEquals(
        getCalls(),
        1,
        "an accepted request must reach the downstream handler exactly once",
      );
    });
  });
});
