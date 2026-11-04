import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withEnv } from "#veryfront/testing/deno-compat.ts";
import { __resetEnvLoaderForTests } from "#veryfront/utils/env-loader.ts";
import {
  _resetEnvironmentConfig,
  type EnvironmentConfig,
  getEnvironmentConfig,
  isEnvironmentConfigInitialized,
} from "#veryfront/config/environment-config.ts";

// Project code runs before diagnostics and can replace these shared methods.
// Exercise the uncached reader, including the environment values present in CI.
describe("environment snapshots after project execution", () => {
  for (
    const { prototype, method } of [
      { prototype: String.prototype, method: "trim" },
      { prototype: String.prototype, method: "toLowerCase" },
      { prototype: String.prototype, method: "replace" },
      { prototype: RegExp.prototype, method: "test" },
      { prototype: Object, method: "freeze" },
      { prototype: globalThis, method: "Number" },
      { prototype: Number, method: "isSafeInteger" },
    ]
  ) {
    it(`preserves CI flags, integer settings and API routing after replacing ${method}`, async () => {
      await withEnv({
        CI: " TRUE ",
        VERYFRONT_DEBUG: " Yes ",
        CONTINUOUS_INTEGRATION: " 1 ",
        PORT: " 4312 ",
        REQUEST_TIMEOUT_MS: " 4500 ",
        VERYFRONT_API_BASE_URL: "",
        VERYFRONT_API_URL: "https://api.example.test/graphql",
      }, () => {
        __resetEnvLoaderForTests();
        _resetEnvironmentConfig();
        // Early reads must stay uncached, as they do during the startup diagnostic.
        getEnvironmentConfig();
        assertEquals(isEnvironmentConfigInitialized(), false);
        const original = Object.getOwnPropertyDescriptor(prototype, method)!;
        let snapshot: EnvironmentConfig;
        try {
          Object.defineProperty(prototype, method, {
            ...original,
            value: () => {
              throw new Error(`project replaced ${method}`);
            },
          });
          snapshot = getEnvironmentConfig();
        } finally {
          Object.defineProperty(prototype, method, original);
          __resetEnvLoaderForTests();
          _resetEnvironmentConfig();
        }
        assertEquals(snapshot.ci, true);
        assertEquals(snapshot.debug, true);
        assertEquals(snapshot.continuousIntegration, true);
        assertEquals(snapshot.port, 4312);
        assertEquals(snapshot.requestTimeoutMs, 4500);
        assertEquals(snapshot.apiBaseUrl, "https://api.example.test/api");
        return Promise.resolve();
      });
    });
  }
});
