import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __injectDepsForTests,
  checkRequestIsolation,
  completeIsolatedRequest,
  createIsolationErrorResponse,
  type IsolationCheckResult,
  startIsolatedRequest,
} from "./isolation.ts";

describe("isolation", () => {
  afterEach(() => {
    __injectDepsForTests(null);
  });

  describe("checkRequestIsolation", () => {
    it("returns allowed:true when shouldCheck is false", () => {
      const result = checkRequestIsolation("my-project", false);
      assertEquals(result, { allowed: true });
    });

    it("delegates to injected checkRequest when shouldCheck is true", () => {
      const calls: unknown[] = [];
      __injectDepsForTests({
        checkRequest: (slug) => {
          calls.push(slug);
          return { allowed: false, reason: "max_concurrent" as const };
        },
      });

      const result = checkRequestIsolation("my-project", true);
      assertEquals(calls, ["my-project"]);
      assertEquals(result, { allowed: false, reason: "max_concurrent" });
    });

    it("passes undefined slug through to deps", () => {
      let receivedSlug: string | undefined = "not-called";
      __injectDepsForTests({
        checkRequest: (slug) => {
          receivedSlug = slug;
          return { allowed: true };
        },
      });

      checkRequestIsolation(undefined, true);
      assertEquals(receivedSlug, undefined);
    });
  });

  describe("startIsolatedRequest", () => {
    it("is a no-op when shouldCheck is false", () => {
      let called = false;
      __injectDepsForTests({
        startRequest: () => {
          called = true;
        },
      });

      startIsolatedRequest("my-project", false);
      assertEquals(called, false);
    });

    it("delegates to injected startRequest when shouldCheck is true", () => {
      const calls: unknown[] = [];
      __injectDepsForTests({
        startRequest: (slug) => {
          calls.push(slug);
        },
      });

      startIsolatedRequest("my-project", true);
      assertEquals(calls, ["my-project"]);
    });
  });

  describe("completeIsolatedRequest", () => {
    it("is a no-op when shouldCheck is false", () => {
      let called = false;
      __injectDepsForTests({
        completeRequest: () => {
          called = true;
        },
      });

      completeIsolatedRequest("my-project", false, true);
      assertEquals(called, false);
    });

    it("delegates with isTimeout=false when shouldCheck is true", () => {
      const calls: Array<{ slug: unknown; isTimeout: unknown }> = [];
      __injectDepsForTests({
        completeRequest: (slug, isTimeout) => {
          calls.push({ slug, isTimeout });
        },
      });

      completeIsolatedRequest("my-project", true, false);
      assertEquals(calls, [{ slug: "my-project", isTimeout: false }]);
    });

    it("delegates with isTimeout=true when shouldCheck is true", () => {
      const calls: Array<{ slug: unknown; isTimeout: unknown }> = [];
      __injectDepsForTests({
        completeRequest: (slug, isTimeout) => {
          calls.push({ slug, isTimeout });
        },
      });

      completeIsolatedRequest("my-project", true, true);
      assertEquals(calls, [{ slug: "my-project", isTimeout: true }]);
    });
  });

  describe("createIsolationErrorResponse", () => {
    it("returns 503 status", async () => {
      const check: IsolationCheckResult = { allowed: false, reason: "max_concurrent" };
      const response = createIsolationErrorResponse(check);
      assertEquals(response.status, 503);
    });

    it("returns JSON content-type", () => {
      const check: IsolationCheckResult = { allowed: false, reason: "max_concurrent" };
      const response = createIsolationErrorResponse(check);
      assertEquals(response.headers.get("Content-Type"), "application/json");
    });

    it("returns circuit_open message with retry seconds", async () => {
      const check: IsolationCheckResult = {
        allowed: false,
        reason: "circuit_open",
        waitTimeMs: 10000,
      };
      const response = createIsolationErrorResponse(check);
      const body = await response.json();
      assertStringIncludes(body.error, "Retry after 10 seconds");
      assertStringIncludes(body.error, "Service temporarily unavailable");
      assertEquals(body.reason, "circuit_open");
      assertEquals(body.retryAfterMs, 10000);
    });

    it("sets Retry-After header when waitTimeMs is present", () => {
      const check: IsolationCheckResult = {
        allowed: false,
        reason: "circuit_open",
        waitTimeMs: 10000,
      };
      const response = createIsolationErrorResponse(check);
      assertEquals(response.headers.get("Retry-After"), "10");
    });

    it("does not set Retry-After header when waitTimeMs is absent", () => {
      const check: IsolationCheckResult = {
        allowed: false,
        reason: "circuit_open",
      };
      const response = createIsolationErrorResponse(check);
      assertEquals(response.headers.get("Retry-After"), null);
    });

    it("rounds waitTimeMs up to nearest second", () => {
      const check: IsolationCheckResult = {
        allowed: false,
        reason: "circuit_open",
        waitTimeMs: 1500,
      };
      const response = createIsolationErrorResponse(check);
      assertEquals(response.headers.get("Retry-After"), "2");
    });

    it("returns max_concurrent message", async () => {
      const check: IsolationCheckResult = { allowed: false, reason: "max_concurrent" };
      const response = createIsolationErrorResponse(check);
      const body = await response.json();
      assertStringIncludes(body.error, "Too many concurrent");
      assertEquals(body.reason, "max_concurrent");
    });

    it("returns generic isolation policy message for unknown reason", async () => {
      const check: IsolationCheckResult = {
        allowed: false,
        reason: "other_reason" as never,
      };
      const response = createIsolationErrorResponse(check);
      const body = await response.json();
      assertStringIncludes(body.error, "isolation policy");
    });

    it("circuit_open without waitTimeMs shows 0 seconds", async () => {
      const check: IsolationCheckResult = {
        allowed: false,
        reason: "circuit_open",
      };
      const response = createIsolationErrorResponse(check);
      const body = await response.json();
      assertStringIncludes(body.error, "Retry after 0 seconds");
    });
  });
});
