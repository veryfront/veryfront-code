import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as targetModule from "./index.ts";
import * as publicTargetModule from "veryfront/runs/target";
import * as clientModule from "./client.ts";
import { RUNS_OPERATIONS } from "./operations.ts";
import { fixtureResponse, RUNS_OPERATION_FIXTURES } from "./client.test-helpers.ts";

const expectedRuntimeExports = ["RUNS_OPERATIONS", "createRunsSdk", "runsProblemOf"];

describe("runs/target/index.ts exports", () => {
  it("publishes the prepared Runs SDK at veryfront/runs/target", () => {
    assertEquals(Object.keys(targetModule).sort(), expectedRuntimeExports);
    assertEquals(Object.keys(publicTargetModule).sort(), expectedRuntimeExports);
  });

  it("keeps public exports wired to their owning modules", () => {
    assertStrictEquals(publicTargetModule.createRunsSdk, clientModule.createRunsSdk);
    assertStrictEquals(publicTargetModule.runsProblemOf, clientModule.runsProblemOf);
    assertStrictEquals(publicTargetModule.RUNS_OPERATIONS, RUNS_OPERATIONS);
  });

  it("types an operation through the public entry point", async () => {
    const getRun: publicTargetModule.RunsInput<"getRun"> = RUNS_OPERATION_FIXTURES.getRun.input;
    const sdk = publicTargetModule.createRunsSdk({
      baseUrl: "https://api.example.test",
      transport: () => Promise.resolve(fixtureResponse("getRun")),
    });
    const run: publicTargetModule.RunsOutput<"getRun"> = await sdk.getRun(getRun);
    assertEquals(run, RUNS_OPERATION_FIXTURES.getRun.response.body);
  });
});
