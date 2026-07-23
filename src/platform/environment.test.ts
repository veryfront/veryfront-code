import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { runWithProjectEnv } from "#veryfront/server/project-env";
import { getEnvironment, isDevelopment, isProduction, isTest } from "./environment.ts";

const ENVIRONMENT_KEYS = ["VERYFRONT_ENV", "NODE_ENV", "DENO_ENV"] as const;

describe("platform/environment", () => {
  beforeEach(() => {
    for (const key of ENVIRONMENT_KEYS) deleteEnv(key);
  });

  afterEach(() => {
    for (const key of ENVIRONMENT_KEYS) deleteEnv(key);
  });

  it("uses the documented host precedence", () => {
    setEnv("DENO_ENV", "test");
    setEnv("NODE_ENV", "production");
    setEnv("VERYFRONT_ENV", "development");

    assertEquals(getEnvironment(), "development");
    assertEquals(isDevelopment(), true);
    assertEquals(isProduction(), false);
    assertEquals(isTest(), false);
  });

  it("does not let a project environment overlay change framework mode", () => {
    setEnv("NODE_ENV", "production");

    runWithProjectEnv({ NODE_ENV: "development", VERYFRONT_ENV: "test" }, () => {
      assertEquals(getEnvironment(), "production");
      assertEquals(isProduction(), true);
      assertEquals(isDevelopment(), false);
      assertEquals(isTest(), false);
    });
  });

  it("rejects unknown modes and defaults empty values to development", () => {
    setEnv("VERYFRONT_ENV", "staging");
    assertThrows(() => getEnvironment(), Error, "VERYFRONT_ENV");

    setEnv("VERYFRONT_ENV", "");
    assertEquals(getEnvironment(), "development");
  });
});
