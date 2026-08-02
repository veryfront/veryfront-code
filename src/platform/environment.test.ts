import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getHostEnv, setEnv } from "./compat/process.ts";
import { getEnvironment, isDevelopment, isProduction, isTest } from "./environment.ts";

const ENVIRONMENT_KEYS = ["VERYFRONT_ENV", "NODE_ENV", "DENO_ENV"] as const;
const originalEnvironment = new Map(
  ENVIRONMENT_KEYS.map((key) => [key, getHostEnv(key)] as const),
);

function clearEnvironment(): void {
  for (const key of ENVIRONMENT_KEYS) deleteEnv(key);
}

function restoreEnvironment(): void {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) deleteEnv(key);
    else setEnv(key, value);
  }
}

describe("platform/environment", () => {
  beforeEach(clearEnvironment);
  afterEach(restoreEnvironment);

  it("defaults to development only when no environment is configured", () => {
    assertEquals(getEnvironment(), "development");
    assertEquals(isDevelopment(), true);
    assertEquals(isProduction(), false);
    assertEquals(isTest(), false);
  });

  it("normalizes explicit supported environment values", () => {
    setEnv("VERYFRONT_ENV", "  TEST ");

    assertEquals(getEnvironment(), "test");
    assertEquals(isTest(), true);
  });

  it("uses the first nonblank environment source", () => {
    setEnv("VERYFRONT_ENV", "   ");
    setEnv("NODE_ENV", "production");
    setEnv("DENO_ENV", "development");

    assertEquals(getEnvironment(), "production");
  });

  it("treats every explicit non-development deployment label as production", () => {
    for (const value of ["preview", "staging", "prod", "unexpected"]) {
      setEnv("VERYFRONT_ENV", value);
      assertEquals(getEnvironment(), "production");
      assertEquals(isProduction(), true);
      assertEquals(isDevelopment(), false);
    }
  });
});
