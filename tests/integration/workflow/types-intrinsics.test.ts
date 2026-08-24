import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  captureApprovalApprovers,
  generateId,
  parseDuration,
  validateRetryConfig,
} from "#veryfront/workflow/types.ts";
import type { RetryConfig } from "#veryfront/workflow/types.ts";

describe("workflow type boundaries with hostile ambient intrinsics", () => {
  it("parses durations without live string or RegExp protocols", () => {
    const originalMatch = String.prototype.match;
    const originalExec = RegExp.prototype.exec;
    let parsed = 0;
    let invalidError: unknown;
    try {
      String.prototype.match = (() => ["1s", "1", "s"]) as never;
      RegExp.prototype.exec = (() => ["1s", "1", "s"]) as never;
      parsed = parseDuration("1.5s");
      invalidError = assertThrows(() => parseDuration("invalid"));
    } finally {
      String.prototype.match = originalMatch;
      RegExp.prototype.exec = originalExec;
    }

    assertEquals(parsed, 1_500);
    assertEquals(invalidError instanceof VeryfrontError, true);
  });

  it("preserves approval validation and freezing after primordial replacement", () => {
    const originalTrim = String.prototype.trim;
    const originalCharCodeAt = String.prototype.charCodeAt;
    const originalSetHas = Set.prototype.has;
    const originalFreeze = Object.freeze;
    let duplicateError: unknown;
    let controlError: unknown;
    let captured: string[] | undefined;
    try {
      String.prototype.trim = function () {
        return String.prototype.valueOf.call(this);
      };
      String.prototype.charCodeAt = () => 65;
      Set.prototype.has = () => false;
      Object.freeze = ((value: object) => value) as typeof Object.freeze;
      duplicateError = assertThrows(() =>
        captureApprovalApprovers(["alice@example.com", "alice@example.com"])
      );
      controlError = assertThrows(() => captureApprovalApprovers(["alice\u0000@example.com"]));
      captured = captureApprovalApprovers(["alice@example.com"]);
    } finally {
      String.prototype.trim = originalTrim;
      String.prototype.charCodeAt = originalCharCodeAt;
      Set.prototype.has = originalSetHas;
      Object.freeze = originalFreeze;
    }

    assertEquals(duplicateError instanceof VeryfrontError, true);
    assertEquals(controlError instanceof VeryfrontError, true);
    assertEquals(Object.isFrozen(captured), true);
  });

  it("rejects unsupported retry strategies after Set membership is replaced", () => {
    const originalHas = Set.prototype.has;
    let error: unknown;
    try {
      Set.prototype.has = () => true;
      error = assertThrows(() => validateRetryConfig({ backoff: "random" as "fixed" }));
    } finally {
      Set.prototype.has = originalHas;
    }

    assertEquals(error instanceof VeryfrontError, true);
  });

  it("rejects inherited retry fields before execution can read them", () => {
    Object.defineProperty(Object.prototype, "maxAttempts", {
      value: 2,
      configurable: true,
    });
    try {
      assertThrows(
        () => validateRetryConfig({} as RetryConfig),
        VeryfrontError,
        "own data properties",
      );
    } finally {
      delete (Object.prototype as { maxAttempts?: unknown }).maxAttempts;
    }
  });

  it("uses the admitted UUID capability for generated IDs", () => {
    const originalRandomUuid = crypto.randomUUID;
    let generated = "";
    try {
      crypto.randomUUID = () => "00000000-0000-4000-8000-000000000000";
      generated = generateId("run");
    } finally {
      crypto.randomUUID = originalRandomUuid;
    }

    assertNotEquals(generated, "run_00000000-000");
    assertMatch(generated, /^run_[0-9a-f-]{12}$/);
  });
});
