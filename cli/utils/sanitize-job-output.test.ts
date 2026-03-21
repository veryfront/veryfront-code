import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { sanitizeJobOutputForLogging } from "./sanitize-job-output.ts";

describe("sanitizeJobOutputForLogging", () => {
  it("removes top-level tenant context", () => {
    assertEquals(
      sanitizeJobOutputForLogging({
        _tenant: { token: "secret", projectSlug: "dreamy-haven" },
        ok: true,
      }),
      { ok: true },
    );
  });

  it("removes nested tenant context recursively", () => {
    assertEquals(
      sanitizeJobOutputForLogging({
        run: {
          step: {
            _tenant: { token: "secret" },
            status: "completed",
          },
        },
      }),
      {
        run: {
          step: {
            status: "completed",
          },
        },
      },
    );
  });

  it("preserves arrays and primitive values", () => {
    assertEquals(
      sanitizeJobOutputForLogging([
        { ok: true, _tenant: { token: "secret" } },
        "done",
        42,
      ]),
      [{ ok: true }, "done", 42],
    );
  });
});
