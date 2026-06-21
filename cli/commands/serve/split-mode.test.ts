import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for serve-split command (split mode orchestration)
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildSplitModeEnvForTests, runSplitMode, waitForPort } from "./split-mode.ts";

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

  describe("waitForPort", () => {
    it("treats a TCP listener as ready without requesting the root route", async () => {
      const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
      const port = (listener.addr as Deno.NetAddr).port;
      const accepted = (async () => {
        try {
          const conn = await listener.accept();
          conn.close();
        } catch (error) {
          if (!(error instanceof Deno.errors.BadResource)) {
            throw error;
          }
        } finally {
          try {
            listener.close();
          } catch { /* listener may already be closed */ }
        }
      })();

      try {
        assertEquals(await waitForPort(port, 1000, 100), true);
      } finally {
        try {
          listener.close();
        } catch { /* listener may already be closed */ }
      }
      await accepted;
    });
  });
});
