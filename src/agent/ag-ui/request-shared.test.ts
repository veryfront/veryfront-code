import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createAgUiSchemaValidationErrorResponse } from "./request-shared.ts";

describe("AG-UI schema validation responses", () => {
  it("retains each handler label and projects only issue paths and messages", async () => {
    const error = Object.assign(new Error("validation failed"), {
      issues: [{ path: ["messages", 0], message: "Expected text", privateValue: "discard" }],
    });
    for (
      const label of [
        "Invalid AG-UI request",
        "Invalid AG-UI resume request",
        "Invalid AG-UI detached start request",
        "Invalid AG-UI runtime request",
      ]
    ) {
      const response = createAgUiSchemaValidationErrorResponse(error, label);
      assertEquals(response?.status, 400);
      assertEquals(await response?.json(), {
        error: label,
        details: [{ path: ["messages", 0], message: "Expected text" }],
      });
    }
  });
  it("reads the issue list at admission and again for the response", async () => {
    let reads = 0;
    const error = new Error("validation failed");
    Object.defineProperty(error, "issues", {
      get() {
        reads++;
        return reads === 1 ? [] : [{ path: ["tools"], message: "Invalid definition" }];
      },
    });
    const response = createAgUiSchemaValidationErrorResponse(error, "Invalid AG-UI request");
    assertEquals(reads, 2);
    assertEquals(await response?.json(), {
      error: "Invalid AG-UI request",
      details: [{ path: ["tools"], message: "Invalid definition" }],
    });
  });
  it("rejects non-schema values without invoking their issue getter and preserves getter failures", () => {
    let reads = 0;
    const value = {
      get issues() {
        reads++;
        return [];
      },
    };
    assertEquals(createAgUiSchemaValidationErrorResponse(value, "invalid"), undefined);
    assertEquals(reads, 0);
    const failure = new Error("issue read failed");
    const error = new Error("validation failed");
    Object.defineProperty(error, "issues", {
      get() {
        throw failure;
      },
    });
    assertStrictEquals(
      assertThrows(() => createAgUiSchemaValidationErrorResponse(error, "invalid")),
      failure,
    );
  });
});
