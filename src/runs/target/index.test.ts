import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as targetModule from "./index.ts";
import * as publicTargetModule from "veryfront/runs/target";
import * as clientModule from "./client.ts";
import { createRunsApiTransport } from "./transport.ts";
import { RUNS_OPERATIONS } from "./operations.ts";

const expectedRuntimeExports = [
  "RUNS_OPERATIONS",
  "createRunsApiTransport",
  "createRunsSdk",
  "runsProblemOf",
];

describe("runs/target/index.ts exports", () => {
  it("publishes the prepared Runs SDK at veryfront/runs/target", () => {
    assertEquals(Object.keys(targetModule).sort(), expectedRuntimeExports);
    assertEquals(Object.keys(publicTargetModule).sort(), expectedRuntimeExports);
  });

  it("keeps public exports wired to their owning modules", () => {
    assertStrictEquals(publicTargetModule.createRunsSdk, clientModule.createRunsSdk);
    assertStrictEquals(publicTargetModule.runsProblemOf, clientModule.runsProblemOf);
    assertStrictEquals(publicTargetModule.RUNS_OPERATIONS, RUNS_OPERATIONS);
    assertStrictEquals(publicTargetModule.createRunsApiTransport, createRunsApiTransport);
  });
});
