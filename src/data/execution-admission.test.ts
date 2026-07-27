import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { DataExecutionAdmission } from "./execution-admission.ts";
import { MAX_DATA_PROJECT_ID_LENGTH } from "./project-identity.ts";

function assertOverloaded(run: () => unknown): VeryfrontError {
  const error = assertThrows(run);
  assertInstanceOf(error, VeryfrontError);
  assertEquals(error.slug, "service-overloaded");
  return error;
}

describe("DataExecutionAdmission", () => {
  it("rejects invalid global and per-project ceilings", () => {
    for (const maxConcurrent of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assertThrows(
        () => new DataExecutionAdmission({ maxConcurrent }),
        RangeError,
        "maxConcurrent must be a positive safe integer",
      );
    }
    for (
      const maxConcurrentPerProject of [
        0,
        -1,
        1.5,
        Number.MAX_SAFE_INTEGER + 1,
      ]
    ) {
      assertThrows(
        () => new DataExecutionAdmission({ maxConcurrentPerProject }),
        RangeError,
        "maxConcurrentPerProject must be a positive safe integer",
      );
    }
    assertThrows(
      () =>
        new DataExecutionAdmission({
          maxConcurrent: 2,
          maxConcurrentPerProject: 3,
        }),
      RangeError,
      "must not exceed maxConcurrent",
    );
  });

  it("rejects non-string, empty, and oversized project identities", () => {
    const admission = new DataExecutionAdmission({
      maxConcurrent: 2,
      maxConcurrentPerProject: 1,
    });
    const invalid = [
      1,
      {},
      Symbol("project"),
      "",
      "x".repeat(MAX_DATA_PROJECT_ID_LENGTH + 1),
    ];

    for (const projectId of invalid) {
      assertThrows(
        () => admission.acquire(projectId as string),
        TypeError,
        "must be a non-empty string",
      );
      assertThrows(
        () => admission.snapshot(projectId as string),
        TypeError,
        "must be a non-empty string",
      );
    }
    assertEquals(admission.snapshot("valid-project"), {
      active: 0,
      activeForProject: 0,
    });
  });

  it("contains one project without denying an available peer slot", () => {
    const admission = new DataExecutionAdmission({
      maxConcurrent: 3,
      maxConcurrentPerProject: 1,
    });
    const releaseA = admission.acquire("project-a");

    assertOverloaded(() => admission.acquire("project-a"));
    const releaseB = admission.acquire("project-b");
    assertEquals(admission.snapshot("project-a"), {
      active: 2,
      activeForProject: 1,
    });
    assertEquals(admission.snapshot("project-b"), {
      active: 2,
      activeForProject: 1,
    });

    releaseA();
    releaseB();
    assertEquals(admission.snapshot("project-a"), {
      active: 0,
      activeForProject: 0,
    });
  });

  it("fails closed when the global ceiling is exhausted", () => {
    const admission = new DataExecutionAdmission({
      maxConcurrent: 2,
      maxConcurrentPerProject: 2,
    });
    const releaseA = admission.acquire("project-a");
    const releaseB = admission.acquire("project-b");

    assertOverloaded(() => admission.acquire("project-c"));
    assertEquals(admission.snapshot("project-c"), {
      active: 2,
      activeForProject: 0,
    });

    releaseA();
    releaseB();
  });

  it("returns an idempotent lease and permits reuse after release", () => {
    const admission = new DataExecutionAdmission({
      maxConcurrent: 1,
      maxConcurrentPerProject: 1,
    });
    const release = admission.acquire("__proto__");

    release();
    release();
    assertEquals(admission.snapshot("__proto__"), {
      active: 0,
      activeForProject: 0,
    });

    const releaseAgain = admission.acquire("__proto__");
    assertEquals(admission.snapshot("__proto__"), {
      active: 1,
      activeForProject: 1,
    });
    releaseAgain();
  });
});
