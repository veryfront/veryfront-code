import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as publicEnv from "./env.ts";
import denoConfig from "#deno-config" with { type: "json" };

describe("platform/env", () => {
  it("only exports the project-scoped environment readers", () => {
    assertEquals(Object.keys(publicEnv).sort(), [
      "getEnv",
      "getEnvBoolean",
      "getEnvNumber",
      "getEnvString",
    ]);
  });

  it("backs both package maps with the restricted facade", () => {
    const config = denoConfig as {
      exports: Record<string, string>;
      imports: Record<string, string>;
    };
    assertEquals(config.exports["./platform/env"], "./src/platform/env.ts");
    assertEquals(config.imports["veryfront/platform/env"], "./src/platform/env.ts");
  });
});
