/**
 * Egress guard coverage for the local integration endpoint executor.
 *
 * Lives under tests/integration because it binds a real loopback listener to
 * prove the default transport never opens a connection to an internal host.
 * The hermetic argument and header assertions stay colocated in
 * src/integrations/local-endpoint-executor.test.ts.
 */

import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { IntegrationToolMeta } from "#veryfront/integrations/schema.ts";
import { executeLocalIntegrationEndpoint } from "#veryfront/integrations/local-endpoint-executor.ts";

type IntegrationEndpoint = NonNullable<IntegrationToolMeta["endpoint"]>;

describe("local integration endpoint egress guard", () => {
  it("defaults to the guarded egress transport when no transport is injected", async () => {
    let providerCalls = 0;
    // Port 0 asks the OS for an ephemeral port, so nothing here is hard coded.
    const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, () => {
      providerCalls += 1;
      return Response.json({ ok: true });
    });
    const origin = `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`;
    const endpoint: IntegrationEndpoint = {
      method: "GET",
      url: `${origin}/latest/meta-data`,
    };
    try {
      const error = await assertRejects(
        () =>
          executeLocalIntegrationEndpoint({
            connectorName: "example",
            toolId: "example__test",
            endpoint,
            args: {},
            authHeaders: {},
            allowedOrigin: origin,
          }),
        VeryfrontError,
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(
        error.slug,
        "local-integration-request-failed",
        "omitting transport must fall back to the guarded egress fetch",
      );
      assertEquals(
        providerCalls,
        0,
        "the guarded egress fetch must block an internal host before it connects",
      );
    } finally {
      await server.shutdown();
    }
  });
});
