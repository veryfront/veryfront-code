import "#veryfront/schemas/_test-setup.ts";

import { TIMEOUT_ERROR } from "#veryfront/errors";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  calculateRetryDelay,
  isRetryableWorkflowError,
} from "#veryfront/workflow/executor/retry-policy.ts";

describe("workflow retry policy with hostile ambient intrinsics", () => {
  it("classifies an error and calculates backoff after retry intrinsics are replaced", () => {
    const error = TIMEOUT_ERROR.create({ detail: "transient failure" });
    const originalMathFloor = Math.floor;
    const originalMathMin = Math.min;
    const originalMathPow = Math.pow;
    const originalMathRandom = Math.random;
    const originalSetHas = Set.prototype.has;
    let poisonCalls = 0;
    const poison = (): never => {
      poisonCalls++;
      throw new Error("ambient retry intrinsic must not run");
    };
    let retryable: boolean | undefined;
    let delay: number | undefined;

    try {
      Math.floor = poison;
      Math.min = poison;
      Math.pow = poison;
      Math.random = () => 0.5;
      Set.prototype.has = poison;
      retryable = isRetryableWorkflowError(error, undefined);
      delay = calculateRetryDelay(2, {
        backoff: "exponential",
        initialDelay: 0,
        maxDelay: 0,
      });
    } finally {
      Math.floor = originalMathFloor;
      Math.min = originalMathMin;
      Math.pow = originalMathPow;
      Math.random = originalMathRandom;
      Set.prototype.has = originalSetHas;
    }

    assertEquals(poisonCalls, 0);
    assertEquals(retryable, true);
    assertEquals(delay, 0);
  });
});
