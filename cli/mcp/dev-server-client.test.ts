import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for MCP dev server client
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { DevDashboardHandler } from "#veryfront/server/handlers/dev/dashboard/index.ts";
import type { HandlerContext } from "#veryfront/server/handlers/types.ts";
import { DevServerClient, type DevServerClientOptions } from "./dev-server-client.ts";

async function withLocalServer(
  handler: (request: Request) => Response | Promise<Response>,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const controller = new AbortController();
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, signal: controller.signal, onListen: () => {} },
    handler,
  );
  const { port } = server.addr as Deno.NetAddr;

  try {
    await run(port);
  } finally {
    controller.abort();
    await server.finished;
  }
}

function localContext(): HandlerContext {
  return {
    projectDir: "/project",
    securityConfig: null,
    cspUserHeader: null,
    isLocalProject: true,
  } as HandlerContext;
}

describe("mcp/dev-server-client", () => {
  describe("DevServerClient", () => {
    it("is a class", () => {
      assertEquals(typeof DevServerClient, "function");
    });

    it("can be instantiated with options", () => {
      const options: DevServerClientOptions = { port: 8080 };
      const client = new DevServerClient(options);
      assertExists(client);
    });

    describe("instance methods", () => {
      let client: DevServerClient;

      const createClient = () => {
        return new DevServerClient({ port: 9999 });
      };

      it("has getLiveErrors method", () => {
        client = createClient();
        assertEquals(typeof client.getLiveErrors, "function");
      });

      it("has getLiveLogs method", () => {
        client = createClient();
        assertEquals(typeof client.getLiveLogs, "function");
      });

      it("has getStats method", () => {
        client = createClient();
        assertEquals(typeof client.getStats, "function");
      });

      it("has triggerHmr method", () => {
        client = createClient();
        assertEquals(typeof client.triggerHmr, "function");
      });

      it("parses JSON responses while preserving successful text responses", async () => {
        let requestCount = 0;
        await withLocalServer(
          () => {
            requestCount++;
            return requestCount === 1
              ? new Response('{"ready":true}', {
                headers: { "content-type": "application/problem+json; charset=utf-8" },
              })
              : new Response("export const ready = true;", {
                headers: { "content-type": "application/javascript" },
              });
          },
          async (port) => {
            const localClient = new DevServerClient({ port });
            assertEquals(await localClient.getStats(), { ready: true });
            assertEquals(await localClient.getStats(), "export const ready = true;");
          },
        );
      });

      it("rejects non-success responses with bounded status-aware diagnostics", async () => {
        const omittedTail = "must-not-appear";
        await withLocalServer(
          () =>
            new Response(`upstream unavailable ${"x".repeat(4_096)} ${omittedTail}`, {
              status: 502,
              headers: { "content-type": "text/plain" },
            }),
          async (port) => {
            const localClient = new DevServerClient({ port });
            const error = await assertRejects(
              () => localClient.getStats(),
              Error,
              "HTTP 502",
            ) as Error;

            assertStringIncludes(error.message, "upstream unavailable");
            assertEquals(error.message.endsWith("…"), true);
            assertEquals(error.message.includes(omittedTail), false);
            assertEquals(error.message.length < 700, true);
          },
        );
      });

      it("bootstraps the dashboard mutation session before triggering HMR over HTTP", async () => {
        const handler = new DevDashboardHandler();
        let sawSessionRequest = false;
        let sawMutationRequest = false;
        const controller = new AbortController();
        const server = Deno.serve(
          { hostname: "127.0.0.1", port: 0, signal: controller.signal, onListen: () => {} },
          async (request) => {
            const { pathname } = new URL(request.url);
            sawSessionRequest ||= pathname === "/_dev/session";
            sawMutationRequest ||= pathname === "/_dev/api/hmr-trigger";
            recordRequestPeerFromTransport(request, {
              runtime: "node",
              transport: "tcp",
              hostname: "127.0.0.1",
            });
            const result = await handler.handle(request, localContext());
            return result.response ?? Response.json({ error: "not found" }, { status: 404 });
          },
        );
        const { port } = server.addr as Deno.NetAddr;

        try {
          const result = await new DevServerClient({ port }).triggerHmr("app/page.tsx");

          assertEquals(result, {
            success: false,
            error: "No HMR listeners connected. Is a browser open?",
          });
          assertEquals(sawSessionRequest, true);
          assertEquals(sawMutationRequest, true);
        } finally {
          controller.abort();
          await server.finished;
        }
      });
    });

    describe("DevServerClientOptions interface", () => {
      it("requires port property", () => {
        const options: DevServerClientOptions = {
          port: 3000,
        };
        assertEquals(options.port, 3000);
      });
    });
  });
});
