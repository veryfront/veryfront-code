import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import { getRequestEnv, runWithEnv } from "./request-env-store.ts";

describe("getEnv() with request-scoped env vars", () => {
  it("returns runtime env when not in request context", () => {
    // getEnv should fall through to Deno.env / process.env when no request context
    const result = getEnv("__UNLIKELY_KEY_12345__");
    assertEquals(result, undefined);
  });

  it("returns request-scoped value when in context", () => {
    const result = runWithEnv({ MY_SCOPED_VAR: "scoped-value" }, () => {
      return getEnv("MY_SCOPED_VAR");
    });
    assertEquals(result, "scoped-value");
  });

  it("request-scoped takes precedence over runtime env", () => {
    // PATH exists in runtime env on all systems
    const runtimePath = getEnv("PATH");
    assertEquals(typeof runtimePath, "string");

    const result = runWithEnv({ PATH: "overridden" }, () => {
      return getEnv("PATH");
    });
    assertEquals(result, "overridden");
  });

  it("falls through to runtime env for unscoped keys", () => {
    const runtimePath = getEnv("PATH");

    const result = runWithEnv({ OTHER: "val" }, () => {
      return getEnv("PATH");
    });
    // Should get the runtime PATH since it's not in the scoped vars
    assertEquals(result, runtimePath);
  });

  it("concurrent requests see their own vars", async () => {
    const results: string[] = [];

    await Promise.all([
      runWithEnv({ STRIPE_KEY: "sk_project_a" }, async () => {
        await new Promise((r) => setTimeout(r, 10));
        results.push(`a:${getEnv("STRIPE_KEY")}`);
      }),
      runWithEnv({ STRIPE_KEY: "sk_project_b" }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        results.push(`b:${getEnv("STRIPE_KEY")}`);
      }),
    ]);

    assertEquals(results, ["b:sk_project_b", "a:sk_project_a"]);
  });

  it("set() in one request context doesn't affect another", async () => {
    const resultsA: (string | undefined)[] = [];
    const resultsB: (string | undefined)[] = [];

    await Promise.all([
      runWithEnv({ SHARED: "a" }, async () => {
        resultsA.push(getRequestEnv("SHARED"));
        await new Promise((r) => setTimeout(r, 10));
        resultsA.push(getRequestEnv("SHARED"));
      }),
      runWithEnv({ SHARED: "b" }, async () => {
        resultsB.push(getRequestEnv("SHARED"));
        await new Promise((r) => setTimeout(r, 5));
        resultsB.push(getRequestEnv("SHARED"));
      }),
    ]);

    assertEquals(resultsA, ["a", "a"]);
    assertEquals(resultsB, ["b", "b"]);
  });
});
