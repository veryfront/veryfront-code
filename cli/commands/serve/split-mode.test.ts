import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for serve-split command (split mode orchestration)
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildSplitModeEnvForTests, runSplitMode } from "./split-mode.ts";

describe("serve-split command", () => {
  describe("runSplitMode", () => {
    it("is a function", () => {
      assertEquals(typeof runSplitMode, "function");
    });

    it("is an async function", () => {
      assertEquals(runSplitMode.constructor.name, "AsyncFunction");
    });

    it("accepts options object with expected properties", () => {
      assertEquals(runSplitMode.length, 1);
    });
  });

  describe("buildSplitModeEnvForTests", () => {
    it("opts the internal production server into trusted forwarded headers", () => {
      const env = buildSplitModeEnvForTests(
        {
          VERYFRONT_PROXY_API_BASE_URL: "https://api.example.test",
          VERYFRONT_PROXY_API_CLIENT_ID: "client",
          VERYFRONT_PROXY_API_CLIENT_SECRET: "secret",
          REDIS_URL: "redis://localhost:6379",
        },
        3000,
      );

      assertEquals(env.VERYFRONT_TRUST_FORWARDED_HEADERS, "1");
      assertEquals(env.VERYFRONT_SERVER_URL, "http://localhost:3000");
    });
  });
});
