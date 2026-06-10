import "#veryfront/schemas/_test-setup.ts";
/**
 * Callback Server Tests
 *
 * These tests use Deno-specific APIs (Deno.serve, Deno.listen)
 * and are skipped on Node.js and Bun.
 */

import { assertEquals, assertExists, assertNotEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno, scaleMs } from "#veryfront/testing";
import {
  type CallbackServer,
  generateCallbackState,
  getCallbackUrl,
  startCallbackServer,
} from "./callback-server.ts";

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

    describe("state binding (CSRF)", { sanitizeOps: false, sanitizeResources: false }, () => {
      const expectedState = "expected-state-nonce-abc123";

      async function fetchTextAndCancel(url: string, init?: RequestInit): Promise<string> {
        const resp = await fetch(url, init);
        const text = await resp.text();
        return text;
      }

      it("should accept token when state matches (happy path)", async () => {
        server = await startCallbackServer(9876, { expectedState });
        const callbackUrl = getCallbackUrl(server.port);

        const callbackPromise = server.waitForCallback(scaleMs(5000));

        let pageHtml = "";
        setTimeout(() => {
          void fetchTextAndCancel(
            `${callbackUrl}?token=test-oauth-token&state=${encodeURIComponent(expectedState)}`,
          ).then((html) => {
            pageHtml = html;
          });
        }, scaleMs(100));

        const result = await callbackPromise;
        assertEquals(result.token, "test-oauth-token");
        assertEquals(result.error, undefined);
        // Confirm the served page is the success page once the body resolves.
        await new Promise((r) => setTimeout(r, scaleMs(100)));
        assertEquals(pageHtml.includes("Logged in"), true);
      });

      it("should reject token when state is missing", async () => {
        server = await startCallbackServer(9876, { expectedState });
        const callbackUrl = getCallbackUrl(server.port);

        const callbackPromise = server.waitForCallback(scaleMs(5000));

        setTimeout(() => {
          // Token present but no state param: must be rejected.
          void fetchTextAndCancel(`${callbackUrl}?token=attacker-token`);
        }, scaleMs(100));

        const result = await callbackPromise;
        assertEquals(result.token, "");
        assertEquals(result.error, "Missing state parameter");
      });

      it("should reject token when state does not match", async () => {
        server = await startCallbackServer(9876, { expectedState });
        const callbackUrl = getCallbackUrl(server.port);

        const callbackPromise = server.waitForCallback(scaleMs(5000));

        setTimeout(() => {
          void fetchTextAndCancel(`${callbackUrl}?token=attacker-token&state=wrong-state`);
        }, scaleMs(100));

        const result = await callbackPromise;
        assertEquals(result.token, "");
        assertEquals(result.error, "Invalid state parameter");
      });

      it("should not echo the expected state in the rejection page", async () => {
        server = await startCallbackServer(9876, { expectedState });
        const callbackUrl = getCallbackUrl(server.port);

        const callbackPromise = server.waitForCallback(scaleMs(5000));

        let pageHtml = "";
        setTimeout(() => {
          void fetchTextAndCancel(`${callbackUrl}?token=attacker-token&state=wrong-state`)
            .then((html) => {
              pageHtml = html;
            });
        }, scaleMs(100));

        await callbackPromise;
        await new Promise((r) => setTimeout(r, scaleMs(100)));
        // The secret state value must never be reflected back to the browser.
        assertEquals(pageHtml.includes(expectedState), false);
      });
    });

    describe("cross-origin rejection", { sanitizeOps: false, sanitizeResources: false }, () => {
      async function fetchAndDrop(url: string, init?: RequestInit): Promise<void> {
        const resp = await fetch(url, init);
        await resp.body?.cancel();
      }

      it("should reject a request carrying a cross-origin Origin header", async () => {
        server = await startCallbackServer(9876, { expectedState: "s" });
        const callbackUrl = getCallbackUrl(server.port);

        const callbackPromise = server.waitForCallback(scaleMs(5000));

        setTimeout(() => {
          void fetchAndDrop(`${callbackUrl}?token=attacker-token&state=s`, {
            headers: { Origin: "https://evil.example.com" },
          });
        }, scaleMs(100));

        const result = await callbackPromise;
        assertEquals(result.token, "");
        assertEquals(result.error, "Rejected cross-origin callback request");
      });

      it("allows a cross-origin Referer (state is the CSRF gate, not Referer)", async () => {
        // A legitimate provider redirect over the https->http(loopback) downgrade
        // may carry a cross-site Referer depending on the server's Referrer-Policy.
        // Referer is deliberately not a rejection trigger; the single-use state
        // nonce is. With a matching state the request must be accepted.
        server = await startCallbackServer(9876, { expectedState: "s" });
        const callbackUrl = getCallbackUrl(server.port);

        const callbackPromise = server.waitForCallback(scaleMs(5000));

        setTimeout(() => {
          void fetchAndDrop(`${callbackUrl}?token=ok-token&state=s`, {
            headers: { Referer: "https://accounts.google.com/o/oauth2/auth" },
          });
        }, scaleMs(100));

        const result = await callbackPromise;
        assertEquals(result.token, "ok-token");
        assertEquals(result.error, undefined);
      });

      it("should allow a same-loopback Referer header", async () => {
        server = await startCallbackServer(9876, { expectedState: "s" });
        const callbackUrl = getCallbackUrl(server.port);

        const callbackPromise = server.waitForCallback(scaleMs(5000));

        setTimeout(() => {
          void fetchAndDrop(`${callbackUrl}?token=ok-token&state=s`, {
            headers: { Referer: `http://localhost:${server!.port}/` },
          });
        }, scaleMs(100));

        const result = await callbackPromise;
        assertEquals(result.token, "ok-token");
        assertEquals(result.error, undefined);
      });
    });
  },
);

describe("generateCallbackState", { sanitizeOps: false, sanitizeResources: false }, () => {
  it("should produce a long hex string (CSPRNG, 256-bit)", () => {
    const state = generateCallbackState();
    // 32 bytes -> 64 hex chars.
    assertEquals(state.length, 64);
    assertEquals(/^[0-9a-f]+$/.test(state), true);
  });

  it("should produce unique values across calls", () => {
    const values = new Set<string>();
    for (let i = 0; i < 100; i++) {
      values.add(generateCallbackState());
    }
    // CSPRNG output must not collide across 100 draws.
    assertEquals(values.size, 100);
  });

  it("should not be derived from Math.random", () => {
    // Force Math.random to a constant; a CSPRNG-based generator must ignore it
    // and still produce varying output.
    const original = Math.random;
    try {
      Math.random = () => 0.5;
      const a = generateCallbackState();
      const b = generateCallbackState();
      assertNotEquals(a, b);
    } finally {
      Math.random = original;
    }
  });
});
