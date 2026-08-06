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
import { DASHBOARD_SESSION_PATH } from "veryfront/extensions/dev-ui/protocol";
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
            sawSessionRequest ||= pathname === DASHBOARD_SESSION_PATH;
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

      it("re-bootstraps the session once and retries after a restart-invalidated 403", async () => {
        let serverToken = "token-before-restart";
        let sessionBootstraps = 0;
        const mutationTokens: Array<string | null> = [];

        await withLocalServer(
          async (request) => {
            const { pathname } = new URL(request.url);
            if (pathname === DASHBOARD_SESSION_PATH) {
              sessionBootstraps++;
              return new Response(null, {
                status: 204,
                headers: { "set-cookie": `vf_dashboard_session_test=${serverToken}; Path=/_dev` },
              });
            }
            if (pathname === "/_dev/api/hmr-trigger") {
              await request.body?.cancel();
              const presented = request.headers.get("x-veryfront-dashboard-csrf");
              mutationTokens.push(presented);
              if (presented !== serverToken) {
                return new Response("Dashboard mutation requires a valid session", {
                  status: 403,
                });
              }
              return Response.json({ success: true, token: presented });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
          async (port) => {
            const client = new DevServerClient({ port });

            assertEquals(await client.triggerHmr("app/page.tsx"), {
              success: true,
              token: "token-before-restart",
            });
            assertEquals(sessionBootstraps, 1);

            // Simulate a dev-server restart: the process-lifetime session
            // token changes while the MCP client keeps its cached session.
            serverToken = "token-after-restart";

            assertEquals(await client.triggerHmr("app/page.tsx"), {
              success: true,
              token: "token-after-restart",
            });
            assertEquals(sessionBootstraps, 2);
            assertEquals(mutationTokens, [
              "token-before-restart",
              "token-before-restart",
              "token-after-restart",
            ]);
          },
        );
      });

      it("retries a rejected mutation exactly once before surfacing the 403", async () => {
        let sessionBootstraps = 0;
        let mutationAttempts = 0;

        await withLocalServer(
          async (request) => {
            const { pathname } = new URL(request.url);
            if (pathname === DASHBOARD_SESSION_PATH) {
              sessionBootstraps++;
              return new Response(null, {
                status: 204,
                headers: { "set-cookie": `vf_dashboard_session_test=denied; Path=/_dev` },
              });
            }
            await request.body?.cancel();
            mutationAttempts++;
            return new Response("Dashboard mutation requires a valid session", { status: 403 });
          },
          async (port) => {
            const client = new DevServerClient({ port });

            await assertRejects(() => client.triggerHmr(), Error, "HTTP 403");

            assertEquals(sessionBootstraps, 2);
            assertEquals(mutationAttempts, 2);
          },
        );
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
