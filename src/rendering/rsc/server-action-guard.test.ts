import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { rscActionGuard } from "./server-action-guard.ts";

describe("rendering/rsc/server-action-guard", () => {
  describe("rscActionGuard", () => {
    it("should return true by default", () => {
      const req = new Request("http://localhost/action");
      assertEquals(rscActionGuard(req, { id: "test", args: [] }), true);
    });

    it("should accept any request and info", () => {
      const req = new Request("http://localhost/action", { method: "POST" });
      assertEquals(rscActionGuard(req, { id: "submitForm", args: [1, 2, 3] }), true);
    });
  });
});
