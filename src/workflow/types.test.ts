import "#veryfront/schemas/_test-setup.ts";
/**
 * Workflow Types Tests
 */

import { VeryfrontError } from "#veryfront/errors";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import { MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS } from "./limits.ts";
import {
  captureApprovalApprovers,
  generateId,
  parseDuration,
  validateRetryConfig,
} from "./types.ts";
import { RunFilterSchema } from "./schemas/workflow.schema.ts";

describe("parseDuration", () => {
  it("should parse seconds", () => {
    assertEquals(parseDuration("30s"), 30000);
    assertEquals(parseDuration("1s"), 1000);
    assertEquals(parseDuration("120s"), 120000);
  });

  it("should parse minutes", () => {
    assertEquals(parseDuration("1m"), 60000);
    assertEquals(parseDuration("5m"), 300000);
    assertEquals(parseDuration("30m"), 1800000);
  });

  it("should parse hours", () => {
    assertEquals(parseDuration("1h"), 3600000);
    assertEquals(parseDuration("24h"), 86400000);
    assertEquals(parseDuration("2h"), 7200000);
  });

  it("should parse days", () => {
    assertEquals(parseDuration("1d"), 86400000);
    assertEquals(parseDuration("7d"), 604800000);
  });

  it("should handle number input (passthrough)", () => {
    assertEquals(parseDuration(0), 0);
    assertEquals(parseDuration(5000), 5000);
    assertEquals(parseDuration(100), 100);
  });

  it("should preserve decimal units that resolve to whole milliseconds", () => {
    assertEquals(parseDuration("1.5s"), 1500);
    assertEquals(parseDuration("0.001s"), 1);
  });

  it("should accept the exact portable timer boundary", () => {
    assertEquals(parseDuration(MAX_TIMER_DELAY_MS), MAX_TIMER_DELAY_MS);
    assertEquals(parseDuration(`${MAX_TIMER_DELAY_MS}ms`), MAX_TIMER_DELAY_MS);
  });

  it("should reject zero string and negative durations", () => {
    assertThrows(() => parseDuration("0s"), Error, "Duration must be positive");
    assertThrows(() => parseDuration("0m"), Error, "Duration must be positive");
    assertThrows(() => parseDuration(-100), Error, "Duration cannot be negative");
  });

  it("should reject non-finite, fractional-millisecond, and overflowing durations", () => {
    for (
      const duration of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        1.5,
        MAX_TIMER_DELAY_MS + 1,
        Number.MAX_SAFE_INTEGER + 1,
      ]
    ) {
      assertThrows(() => parseDuration(duration), Error);
    }

    for (
      const duration of [
        "0.1ms",
        `${MAX_TIMER_DELAY_MS + 1}ms`,
        "999999999999999999999999999999999999999999d",
      ]
    ) {
      assertThrows(() => parseDuration(duration), Error);
    }
  });

  it("should throw on invalid format", () => {
    const message = "Invalid duration format";

    assertThrows(() => parseDuration("invalid"), Error, message);
    assertThrows(() => parseDuration("10x"), Error, message);
    assertThrows(() => parseDuration(""), Error, message);
  });

  it("rejects non-string and non-number values before duration parsing", () => {
    const coercibleDuration = {
      toString() {
        return "1s";
      },
    };

    assertThrows(
      () => parseDuration(coercibleDuration as never),
      Error,
      "invalid duration type",
    );
  });
});

describe("generateId", () => {
  it("should generate unique IDs", () => {
    const ids = [generateId(), generateId(), generateId()];

    for (const id of ids) {
      assertEquals(typeof id, "string");
      assertEquals(id.length > 0, true);
    }

    assertEquals(new Set(ids).size, ids.length);
  });

  it("should use provided prefix", () => {
    assertEquals(generateId("wf").startsWith("wf_"), true);
    assertEquals(generateId("run").startsWith("run_"), true);
  });

  it("should use default 'wf' prefix when no prefix provided", () => {
    assertEquals(generateId().startsWith("wf_"), true);
  });

  it("rejects non-string prefixes without invoking conversion hooks", () => {
    let hookCalls = 0;
    const prefix = {
      toString() {
        hookCalls++;
        return "unsafe";
      },
    };

    assertThrows(
      () => generateId(prefix as never),
      VeryfrontError,
      "prefix must be a canonical string",
    );
    assertEquals(hookCalls, 0);
  });

  it("keeps the complete generated ID within the shared identifier limit", () => {
    const exactPrefix = "x".repeat(MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS - 13);
    assertEquals(
      generateId(exactPrefix).length,
      MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS,
    );
    assertThrows(
      () => generateId(`${exactPrefix}x`),
      VeryfrontError,
      "prefix must be a canonical string",
    );
  });
});

describe("captureApprovalApprovers", () => {
  it("detaches and freezes a dense canonical identity list", () => {
    const source = ["alice@example.com", "bob@example.com"];
    const captured = captureApprovalApprovers(source);
    source[0] = "mallory@example.com";

    assertEquals(captured, ["alice@example.com", "bob@example.com"]);
    assertEquals(Object.isFrozen(captured), true);
  });

  it("rejects hostile, sparse, and accessor arrays without invoking hooks", () => {
    let hooks = 0;
    const hostile = new Proxy(["alice@example.com"], {
      get() {
        hooks++;
        throw new Error("must not run");
      },
      ownKeys() {
        hooks++;
        throw new Error("must not run");
      },
    });
    const accessor = ["alice@example.com"];
    Object.defineProperty(accessor, "0", {
      enumerable: true,
      get() {
        hooks++;
        return "alice@example.com";
      },
    });
    const sparse = new Array<string>(1);

    assertThrows(() => captureApprovalApprovers(hostile), Error);
    assertThrows(() => captureApprovalApprovers(accessor), Error, "dense non-empty array");
    assertThrows(() => captureApprovalApprovers(sparse), Error, "dense non-empty array");
    assertEquals(hooks, 0);
  });

  it("rejects control characters and oversized identities", () => {
    assertThrows(() => captureApprovalApprovers(["alice\u0000@example.com"]), Error);
    assertThrows(() => captureApprovalApprovers(["x".repeat(1_025)]), Error);
  });
});

describe("RunFilterSchema", () => {
  it("bounds workflow run page size and offset", () => {
    assertEquals(RunFilterSchema.parse({ limit: 1_000 }).limit, 1_000);
    assertEquals(RunFilterSchema.parse({ offset: 10_000 }).offset, 10_000);
    assertThrows(
      () => RunFilterSchema.parse({ limit: 1_001 }),
      Error,
    );
    assertThrows(
      () => RunFilterSchema.parse({ offset: 10_001 }),
      Error,
    );
    for (const limit of [0, -1, 1.5]) {
      assertThrows(() => RunFilterSchema.parse({ limit }), Error);
    }
    for (const offset of [-1, 1.5]) {
      assertThrows(() => RunFilterSchema.parse({ offset }), Error);
    }
  });
});

describe("validateRetryConfig", () => {
  it("should accept valid config", () => {
    validateRetryConfig({});
    validateRetryConfig({ maxAttempts: 1 });
    validateRetryConfig({ maxAttempts: 100 });
    validateRetryConfig({
      backoff: "exponential",
      initialDelay: 0,
      maxDelay: MAX_TIMER_DELAY_MS,
    });
  });

  it("accepts only plain records at the raw runtime boundary", () => {
    const nullPrototypeConfig = Object.create(null) as Record<string, unknown>;
    nullPrototypeConfig.maxAttempts = 2;
    validateRetryConfig(nullPrototypeConfig);

    class RetryPolicy {}

    for (
      const config of [
        5,
        "three",
        false,
        null,
        [],
        () => undefined,
        new Date(),
        new RetryPolicy(),
      ]
    ) {
      assertThrows(
        () => validateRetryConfig(config as never),
        Error,
        "plain record",
      );
    }
  });

  it("rejects accessor and Proxy fields without invoking hooks", () => {
    let hookCalls = 0;
    const accessor = Object.defineProperty({}, "maxAttempts", {
      enumerable: true,
      get() {
        hookCalls++;
        return 2;
      },
    });
    const proxied = new Proxy({ maxAttempts: 2 }, {
      getPrototypeOf() {
        hookCalls++;
        throw new Error("must not run");
      },
    });

    assertThrows(
      () => validateRetryConfig(accessor as never),
      VeryfrontError,
      "own data properties",
    );
    assertThrows(
      () => validateRetryConfig(proxied),
      VeryfrontError,
      "plain record",
    );
    assertEquals(hookCalls, 0);
  });

  it("rejects a non-function retry predicate", () => {
    assertThrows(
      () => validateRetryConfig({ retryIf: "always" } as never),
      VeryfrontError,
      "retryIf must be a function",
    );
  });

  it("should reject invalid maxAttempts", () => {
    const message = "maxAttempts must be a positive integer";

    for (
      const maxAttempts of [
        0,
        -1,
        1.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.MAX_SAFE_INTEGER + 1,
      ]
    ) {
      assertThrows(() => validateRetryConfig({ maxAttempts }), Error, message);
    }
  });

  it("should reject retry counts above the production safety ceiling", () => {
    assertThrows(
      () => validateRetryConfig({ maxAttempts: 101 }),
      Error,
      "maxAttempts cannot exceed 100",
    );
  });

  it("should reject invalid retry delays", () => {
    for (
      const delay of [
        -1,
        0.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        MAX_TIMER_DELAY_MS + 1,
        Number.MAX_SAFE_INTEGER + 1,
      ]
    ) {
      assertThrows(
        () => validateRetryConfig({ initialDelay: delay }),
        Error,
        "initialDelay",
      );
      assertThrows(
        () => validateRetryConfig({ maxDelay: delay }),
        Error,
        "maxDelay",
      );
    }
  });

  it("should reject initialDelay greater than maxDelay", () => {
    assertThrows(
      () => validateRetryConfig({ initialDelay: 5000, maxDelay: 1000 }),
      Error,
      "initialDelay (5000) cannot be greater than maxDelay (1000)",
    );
  });

  it("should reject unsupported backoff strategies", () => {
    assertThrows(
      () => validateRetryConfig({ backoff: "random" as "fixed" }),
      Error,
      "Invalid backoff strategy",
    );
  });
});
