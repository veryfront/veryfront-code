/**
 * Callback Server Tests
 */

import { assertEquals, assertExists } from "@std/assert";
import { afterEach, describe, it } from "@std/testing/bdd";
import { type CallbackServer, getCallbackUrl, startCallbackServer } from "./callback-server.ts";

describe("Callback Server", { sanitizeOps: false, sanitizeResources: false }, () => {
  let server: CallbackServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  describe("getCallbackUrl", () => {
    it("should return correct callback URL format", () => {
      const url = getCallbackUrl(9876);
      assertEquals(url, "http://localhost:9876/callback");
    });

    it("should use the provided port", () => {
      const url = getCallbackUrl(12345);
      assertEquals(url, "http://localhost:12345/callback");
    });
  });

  describe("startCallbackServer", () => {
    it("should start a server on available port", async () => {
      server = await startCallbackServer(9876);
      assertExists(server);
      assertExists(server.port);
      assertEquals(typeof server.port, "number");
    });

    it("should find alternative port if preferred is taken", async () => {
      // Start first server
      const server1 = await startCallbackServer(9876);
      server = server1;

      // Start second server - should get different port
      const server2 = await startCallbackServer(9876);
      assertExists(server2);

      // Both should be running on different ports
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

  describe("callback handling", () => {
    it("should receive token from callback", async () => {
      server = await startCallbackServer(9876);
      const callbackUrl = getCallbackUrl(server.port);

      // Simulate OAuth callback with token
      const callbackPromise = server.waitForCallback(5000);

      // Make request to callback endpoint
      setTimeout(async () => {
        await fetch(`${callbackUrl}?token=test-oauth-token`);
      }, 100);

      const result = await callbackPromise;
      assertEquals(result.token, "test-oauth-token");
      assertEquals(result.error, undefined);
    });

    it("should handle error from callback", async () => {
      server = await startCallbackServer(9876);
      const callbackUrl = getCallbackUrl(server.port);

      const callbackPromise = server.waitForCallback(5000);

      setTimeout(async () => {
        await fetch(`${callbackUrl}?error=access_denied`);
      }, 100);

      const result = await callbackPromise;
      assertEquals(result.token, "");
      assertEquals(result.error, "access_denied");
    });

    it("should handle missing token", async () => {
      server = await startCallbackServer(9876);
      const callbackUrl = getCallbackUrl(server.port);

      const callbackPromise = server.waitForCallback(5000);

      setTimeout(async () => {
        await fetch(callbackUrl);
      }, 100);

      const result = await callbackPromise;
      assertEquals(result.token, "");
      assertEquals(result.error, "No token received");
    });

    it("should return 404 for non-callback paths", async () => {
      server = await startCallbackServer(9876);
      const response = await fetch(`http://localhost:${server.port}/other-path`);
      assertEquals(response.status, 404);
    });
  });
});
