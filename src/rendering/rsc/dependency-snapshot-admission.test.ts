import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  admitDependencySnapshot,
  type DependencySnapshotAdmissionInput,
} from "./dependency-snapshot-admission.ts";

describe("rendering/rsc/dependency-snapshot-admission", () => {
  it("admits only an exact canonical enabled identity from every required authority", () => {
    let recoveries = 0;
    const admitted = admitDependencySnapshot(
      {
        requestedDependencyPinningCacheKey: "on:1",
        currentDependencyPinningCacheKey: "on:1",
        responseHeaderDependencyPinningCacheKey: "on:1",
        responseBodyDependencyPinningCacheKey: "on:1",
        requireResponseHeader: true,
        requireResponseBody: true,
      },
      () => {
        recoveries++;
        return true;
      },
    );

    assertEquals(admitted, { dependencyPinningCacheKey: "on:1" });
    assertEquals(recoveries, 0);
  });

  it("preserves flag-off compatibility when response authorities are absent", () => {
    assertEquals(
      admitDependencySnapshot({
        requestedDependencyPinningCacheKey: undefined,
        currentDependencyPinningCacheKey: undefined,
        responseHeaderDependencyPinningCacheKey: null,
        requireResponseHeader: true,
        requireResponseBody: true,
      }),
      { dependencyPinningCacheKey: "off" },
    );
    assertEquals(
      admitDependencySnapshot({
        requestedDependencyPinningCacheKey: "off",
        currentDependencyPinningCacheKey: "off",
        responseHeaderDependencyPinningCacheKey: null,
        responseBodyDependencyPinningCacheKey: "off",
        requireResponseHeader: true,
        requireResponseBody: true,
      }),
      { dependencyPinningCacheKey: "off" },
    );
  });

  it("fails closed for missing, malformed, mismatched, and unrequested authorities", () => {
    const cases: DependencySnapshotAdmissionInput[] = [
      {
        requestedDependencyPinningCacheKey: "on:1",
        currentDependencyPinningCacheKey: "on:1",
        responseHeaderDependencyPinningCacheKey: null,
        responseBodyDependencyPinningCacheKey: "on:1",
        requireResponseHeader: true,
        requireResponseBody: true,
      },
      {
        requestedDependencyPinningCacheKey: "on:1",
        currentDependencyPinningCacheKey: "on:1",
        responseHeaderDependencyPinningCacheKey: "on:not-canonical",
        responseBodyDependencyPinningCacheKey: "on:1",
        requireResponseHeader: true,
        requireResponseBody: true,
      },
      {
        requestedDependencyPinningCacheKey: "on:1",
        currentDependencyPinningCacheKey: "on:1",
        responseHeaderDependencyPinningCacheKey: "on:2",
        responseBodyDependencyPinningCacheKey: "on:1",
        requireResponseHeader: true,
        requireResponseBody: true,
      },
      {
        requestedDependencyPinningCacheKey: "on:1",
        currentDependencyPinningCacheKey: "on:2",
        responseHeaderDependencyPinningCacheKey: "on:1",
        responseBodyDependencyPinningCacheKey: "on:1",
        requireResponseHeader: true,
        requireResponseBody: true,
      },
      {
        requestedDependencyPinningCacheKey: undefined,
        currentDependencyPinningCacheKey: undefined,
        responseHeaderDependencyPinningCacheKey: "on:1",
        responseBodyDependencyPinningCacheKey: "on:1",
        requireResponseHeader: true,
        requireResponseBody: true,
      },
      {
        requestedDependencyPinningCacheKey: "on:unknown",
        currentDependencyPinningCacheKey: "on:unknown",
        responseHeaderDependencyPinningCacheKey: "on:unknown",
        responseBodyDependencyPinningCacheKey: "on:unknown",
        requireResponseHeader: true,
        requireResponseBody: true,
      },
      {
        requestedDependencyPinningCacheKey: "on:1",
        currentDependencyPinningCacheKey: "on:1",
        responseHeaderDependencyPinningCacheKey: "on:1",
        requireResponseHeader: true,
        requireResponseBody: true,
      },
    ];
    let recoveries = 0;

    for (const input of cases) {
      assertEquals(
        admitDependencySnapshot(input, () => {
          recoveries++;
          return true;
        }),
        null,
      );
    }

    assertEquals(recoveries, cases.length);
  });
});
