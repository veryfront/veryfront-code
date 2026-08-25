import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { reportHandlerFailure } from "./report-handler-failure.ts";
import { stubApplicationErrorReporter } from "./internal-agent-run.test-helpers.ts";

describe("server/handlers/request/report-handler-failure", () => {
  it("reports a 5xx with its context", () => {
    const thrown = new Error("boom");
    const { captures, restore } = stubApplicationErrorReporter();

    try {
      reportHandlerFailure(thrown, {
        boundary: "test.boundary",
        method: "POST",
        status: 503,
        runId: "run_1",
        projectId: "proj-1",
        projectSlug: "demo-project",
        slug: "service-overloaded",
      });

      assertEquals(captures.length, 1);
      const captured = captures[0];
      assertExists(captured);
      assertEquals(captured.error, thrown);
      assertEquals(captured.context.boundary, "test.boundary");
      assertEquals(captured.context.requestId, "run_1");
      assertEquals(captured.context.attributes?.["http.status"], 503);
      assertEquals(captured.context.attributes?.["error.slug"], "service-overloaded");
    } finally {
      restore();
    }
  });

  // The 5xx-only boundary is the whole point of this module, so it is enforced
  // rather than left to callers to remember.
  it("drops anything below 500", () => {
    const { captures, restore } = stubApplicationErrorReporter();

    try {
      for (const status of [400, 401, 404, 409, 499]) {
        reportHandlerFailure(new Error("boom"), {
          boundary: "test.boundary",
          method: "POST",
          status,
        });
      }

      assertEquals(captures.length, 0);
    } finally {
      restore();
    }
  });
});
