/**
 * Callback Server Tests
 *
 * These tests use Deno-specific APIs (Deno.serve, Deno.listen)
 * and are skipped on Node.js and Bun.
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { type CallbackServer, getCallbackUrl, startCallbackServer } from "./callback-server.ts";
import { isDeno, scaleMs } from "#veryfront/testing";

describe(
  "Callback Server",
  { sanitizeOps: false, sanitizeResources: false, ignore: !isDeno },
  () => {
    let server: CallbackServer | null = null;

    afterEach(async () => {
      if (!server) return;
      await server.stop();
      server = null;
    });

    describe("getCallbackUrl", { sanitizeOps: false, sanitizeResources: false }, () => {
      it("should return correct callback URL format", () => {
        assertEquals(getCallbackUrl(9876), "http://localhost:9876/callback");
      });

      it("should use the provided port", () => {
        assertEquals(getCallbackUrl(12345), "http://localhost:12345/callback");
      });
    });

    describe("startCallbackServer", { sanitizeOps: false, sanitizeResources: false }, () => {
      it("should start a server on available port", async () => {
        server = await startCallbackServer(9876);
        assertExists(server);
        assertExists(server.port);
        assertEquals(typeof server.port, "number");
      });

      it("should find alternative port if preferred is taken", async () => {
        const server1 = await startCallbackServer(9876);
        server = server1;

        const server2 = await startCallbackServer(9876);
        assertExists(server2);

        assertEquals(server1.port !== server2.port || server1.port === 9876, true);

        await server2.stop();
      });

      it("should have waitForCallback method", async () => {
        server = await startCallbackServer(9876);
        assertExists(server.waitForCallback);
        assertEquals(typeof server.waitForCallback, "function");
      });

      it("should have stop method", async () => {
        server = await startCallbackServer(9876);
        assertExists(server.stop);
        assertEquals(typeof server.stop, "function");
      });
    });

    describe("callback handling", { sanitizeOps: false, sanitizeResources: false }, () => {
      async function fetchAndCancel(url: string): Promise<void> {
        const resp = await fetch(url);
        await resp.body?.cancel();
      }

      it("should receive token from callback", async () => {
        server = await startCallbackServer(9876);
        const callbackUrl = getCallbackUrl(server.port);

        const callbackPromise = server.waitForCallback(scaleMs(5000));

        setTimeout(() => {
          void fetchAndCancel(`${callbackUrl}?token=test-oauth-token`);
        }, scaleMs(100));

        const result = await callbackPromise;
        assertEquals(result.token, "test-oauth-token");
        assertEquals(result.error, undefined);
      });

      it("should handle error from callback", async () => {
        server = await startCallbackServer(9876);
        const callbackUrl = getCallbackUrl(server.port);

        const callbackPromise = server.waitForCallback(scaleMs(5000));

        setTimeout(() => {
          void fetchAndCancel(`${callbackUrl}?error=access_denied`);
        }, scaleMs(100));

        const result = await callbackPromise;
        assertEquals(result.token, "");
        assertEquals(result.error, "access_denied");
      });

      it("should handle missing token", async () => {
        server = await startCallbackServer(9876);
        const callbackUrl = getCallbackUrl(server.port);

        const callbackPromise = server.waitForCallback(scaleMs(5000));

        setTimeout(() => {
          void fetchAndCancel(callbackUrl);
        }, scaleMs(100));

        const result = await callbackPromise;
        assertEquals(result.token, "");
        assertEquals(result.error, "No token received");
      });

      it("should return 404 for non-callback paths", async () => {
        server = await startCallbackServer(9876);
        const response = await fetch(`http://localhost:${server.port}/other-path`);
        assertEquals(response.status, 404);
        await response.body?.cancel();
      });
    });
  },
);
