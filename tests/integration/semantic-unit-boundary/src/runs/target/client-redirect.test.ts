/**
 * Runs SDK redirect handling over real `fetch`.
 *
 * Fetch strips only `Authorization` on a cross-origin redirect, so an SDK
 * request that follows a 307 would carry its `X-API-Key` to the redirect
 * target. The SDK refuses redirects on credentialed requests. This test runs
 * two local servers, so it lives in the semantic integration suite.
 */
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

import { createRunsSdk } from "#veryfront/runs/target/client.ts";
import { createVeryfrontApiTransport } from "#veryfront/platform/adapters/veryfront-api-transport.ts";

describe("runs SDK redirect boundary", () => {
  it("does not carry an API key across a cross-origin redirect", async () => {
    const leaked: (string | null)[] = [];
    const target = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen() {} }, (request) => {
      leaked.push(request.headers.get("X-API-Key"));
      return Response.json({});
    });
    const api = Deno.serve(
      { port: 0, hostname: "127.0.0.1", onListen() {} },
      () => Response.redirect(`http://127.0.0.1:${target.addr.port}/`, 307),
    );
    try {
      const sdk = createRunsSdk({
        transport: createVeryfrontApiTransport({
          baseUrl: `http://127.0.0.1:${api.addr.port}`,
          getToken: () => "test-token",
          defaultHeaders: { "X-API-Key": "<API_KEY>" },
          retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
        }),
      });
      await assertRejects(() => sdk.getRun({ path: { run_id: "run_redirect" } }));
      assertEquals(leaked, []);
    } finally {
      await Promise.all([api.shutdown(), target.shutdown()]);
    }
  });
});
