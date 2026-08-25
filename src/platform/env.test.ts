import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as publicEnv from "./env.ts";

describe("platform/env", () => {
  it("only exports the project-scoped environment readers", () => {
    assertEquals(Object.keys(publicEnv).sort(), [
      "getEnv",
      "getEnvBoolean",
      "getEnvNumber",
      "getEnvString",
    ]);
  });
});
