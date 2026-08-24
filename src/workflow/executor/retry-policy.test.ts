import "#veryfront/schemas/_test-setup.ts";

import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { calculateRetryDelay, isRetryableWorkflowError } from "./retry-policy.ts";

describe("workflow retry policy", () => {
  it("lets an explicit retry predicate override built-in classification", () => {
    assertEquals(
      isRetryableWorkflowError(new Error("ordinary failure"), {
        retryIf: () => true,
      }),
      true,
    );
    assertEquals(
      isRetryableWorkflowError(new Error("ECONNRESET"), {
        retryIf: () => false,
      }),
      false,
    );
  });

  it("fails closed when a custom retry predicate throws", () => {
    const original = new Error("original step failure");

    const retryable = isRetryableWorkflowError(original, {
      retryIf: () => {
        throw new Error("predicate failed");
      },
    });

    assertEquals(retryable, false);
  });

  it("does not invoke an accessor while reading a system error code", () => {
    let accessorCalls = 0;
    const error = Object.defineProperty(new Error("ordinary failure"), "code", {
      get() {
        accessorCalls++;
        throw new Error("code accessor must not run");
      },
    });

    assertEquals(isRetryableWorkflowError(error, undefined), false);
    assertEquals(accessorCalls, 0);
  });

  it("applies fixed, linear, and exponential backoff within the jitter bounds", () => {
    const cases = [
      { backoff: "fixed" as const, attempt: 3, minimum: 90, maximum: 109 },
      { backoff: "linear" as const, attempt: 3, minimum: 270, maximum: 329 },
      { backoff: "exponential" as const, attempt: 4, minimum: 720, maximum: 879 },
    ];

    for (const { backoff, attempt, minimum, maximum } of cases) {
      for (let sample = 0; sample < 20; sample++) {
        const delay = calculateRetryDelay(attempt, {
          backoff,
          initialDelay: 100,
          maxDelay: 1_000,
        });
        assert(delay >= minimum, `${backoff} delay ${delay} is below ${minimum}`);
        assert(delay <= maximum, `${backoff} delay ${delay} is above ${maximum}`);
      }
    }
  });

  it("caps retry delay after applying jitter", () => {
    for (let sample = 0; sample < 20; sample++) {
      assertEquals(
        calculateRetryDelay(2, {
          backoff: "linear",
          initialDelay: 100,
          maxDelay: 100,
        }),
        100,
      );
    }
  });
});
