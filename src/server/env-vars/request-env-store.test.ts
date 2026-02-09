import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getRequestEnv, runWithEnv } from "./request-env-store.ts";

describe("request-env-store", () => {
  describe("getRequestEnv()", () => {
    it("returns undefined outside of a request context", () => {
      assertEquals(getRequestEnv("ANYTHING"), undefined);
    });
  });

  describe("runWithEnv()", () => {
    it("makes env vars available within the callback", () => {
      const result = runWithEnv({ MY_KEY: "my-value" }, () => {
        return getRequestEnv("MY_KEY");
      });
      assertEquals(result, "my-value");
    });

    it("returns undefined for keys not in the provided vars", () => {
      const result = runWithEnv({ A: "1" }, () => {
        return getRequestEnv("B");
      });
      assertEquals(result, undefined);
    });

    it("returns the callback's return value", () => {
      const result = runWithEnv({}, () => 42);
      assertEquals(result, 42);
    });

    it("supports async callbacks", async () => {
      const result = await runWithEnv({ KEY: "async-value" }, async () => {
        await new Promise((r) => setTimeout(r, 1));
        return getRequestEnv("KEY");
      });
      assertEquals(result, "async-value");
    });

    it("isolates concurrent runs", async () => {
      const results: string[] = [];

      await Promise.all([
        runWithEnv({ PROJECT: "alpha" }, async () => {
          await new Promise((r) => setTimeout(r, 10));
          results.push(`a:${getRequestEnv("PROJECT")}`);
        }),
        runWithEnv({ PROJECT: "beta" }, async () => {
          await new Promise((r) => setTimeout(r, 5));
          results.push(`b:${getRequestEnv("PROJECT")}`);
        }),
      ]);

      // beta resolves first due to shorter delay
      assertEquals(results, ["b:beta", "a:alpha"]);
    });

    it("supports nesting — inner context takes precedence", () => {
      const result = runWithEnv({ KEY: "outer" }, () => {
        return runWithEnv({ KEY: "inner" }, () => {
          return getRequestEnv("KEY");
        });
      });
      assertEquals(result, "inner");
    });

    it("restores outer context after inner run", () => {
      const result = runWithEnv({ KEY: "outer" }, () => {
        runWithEnv({ KEY: "inner" }, () => {
          // inner context
        });
        return getRequestEnv("KEY");
      });
      assertEquals(result, "outer");
    });

    it("cleans up after callback completes", () => {
      runWithEnv({ KEY: "value" }, () => {
        // in context
      });
      assertEquals(getRequestEnv("KEY"), undefined);
    });
  });
});
