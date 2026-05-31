import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { sanitizeRunOutputForLogging } from "./sanitize-run-output.ts";

describe("sanitizeRunOutputForLogging", () => {
  it("removes top-level tenant context", () => {
    assertEquals(
      sanitizeRunOutputForLogging({
        _tenant: { token: "secret", projectSlug: "dreamy-haven" },
        ok: true,
      }),
      { ok: true },
    );
  });

  it("removes nested tenant context recursively", () => {
    assertEquals(
      sanitizeRunOutputForLogging({
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
      sanitizeRunOutputForLogging([
        { ok: true, _tenant: { token: "secret" } },
        "done",
        42,
      ]),
      [{ ok: true }, "done", 42],
    );
  });
});
