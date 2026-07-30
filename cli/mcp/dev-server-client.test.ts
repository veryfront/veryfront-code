import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for MCP dev server client
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  DevServerClient,
  type DevServerClientOptions,
  MAX_DEV_SERVER_JSON_RESPONSE_BYTES,
} from "./dev-server-client.ts";
import {
  DASHBOARD_CSRF_HEADER_NAME,
  DASHBOARD_SESSION_PATH,
  getDashboardSessionCookieName,
} from "veryfront/extensions/dev-ui/protocol";

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

      it("sends an explicit same-origin JSON identity for HMR mutations", async () => {
        const csrfToken = "A".repeat(43);
        let sessionRequests = 0;
        const received = Promise.withResolvers<{
          origin: string | null;
          host: string | null;
          contentType: string | null;
          cookie: string | null;
          csrfToken: string | null;
          body: unknown;
        }>();
        let listenerPort = 0;
        const server = Deno.serve(
          {
            hostname: "localhost",
            port: 0,
            onListen({ port }) {
              listenerPort = port;
            },
          },
          async (request) => {
            if (
              request.method === "GET" &&
              new URL(request.url).pathname === DASHBOARD_SESSION_PATH
            ) {
              sessionRequests++;
              return new Response("dashboard", {
                headers: {
                  "Set-Cookie": `${
                    getDashboardSessionCookieName(listenerPort)
                  }=${csrfToken}; Path=/_dev; HttpOnly`,
                },
              });
            }
            received.resolve({
              origin: request.headers.get("origin"),
              host: request.headers.get("host"),
              contentType: request.headers.get("content-type"),
              cookie: request.headers.get("cookie"),
              csrfToken: request.headers.get(DASHBOARD_CSRF_HEADER_NAME),
              body: await request.json(),
            });
            return Response.json({ success: true });
          },
        );
        const address = server.addr;
        if (address.transport !== "tcp") throw new Error("expected TCP test server");

        try {
          client = new DevServerClient({ port: address.port });
          await client.triggerHmr("src/index.ts");
          const request = await received.promise;

          assertEquals(request.origin, `http://localhost:${address.port}`);
          assertEquals(request.host, `localhost:${address.port}`);
          assertEquals(request.contentType, "application/json");
          assertEquals(
            request.cookie,
            `${getDashboardSessionCookieName(address.port)}=${csrfToken}`,
          );
          assertEquals(request.csrfToken, csrfToken);
          assertEquals(request.body, { path: "src/index.ts" });
          assertEquals(sessionRequests, 1);
        } finally {
          await server.shutdown();
        }
      });

      it("refreshes a stale dashboard session once after server restart", async () => {
        const initialToken = "A".repeat(43);
        const refreshedToken = "B".repeat(43);
        let issuedSessions = 0;
        let mutations = 0;
        let listenerPort = 0;
        const server = Deno.serve(
          {
            hostname: "localhost",
            port: 0,
            onListen({ port }) {
              listenerPort = port;
            },
          },
          (request) => {
            if (request.method === "GET") {
              issuedSessions++;
              const token = issuedSessions === 1 ? initialToken : refreshedToken;
              return Promise.resolve(
                new Response("dashboard", {
                  headers: {
                    "Set-Cookie": `${
                      getDashboardSessionCookieName(listenerPort)
                    }=${token}; Path=/_dev; HttpOnly`,
                  },
                }),
              );
            }

            mutations++;
            const token = request.headers.get(DASHBOARD_CSRF_HEADER_NAME);
            return Promise.resolve(Response.json(
              token === refreshedToken ? { success: true } : { error: "stale session" },
              { status: token === refreshedToken ? 200 : 403 },
            ));
          },
        );
        const address = server.addr;
        if (address.transport !== "tcp") throw new Error("expected TCP test server");

        try {
          client = new DevServerClient({ port: address.port });
          assertEquals(await client.triggerHmr(), { success: true });
          assertEquals(issuedSessions, 2);
          assertEquals(mutations, 2);
        } finally {
          await server.shutdown();
        }
      });

      it("bootstraps through the headless session endpoint", async () => {
        const csrfToken = "C".repeat(43);
        const paths: string[] = [];
        let listenerPort = 0;
        const server = Deno.serve(
          {
            hostname: "localhost",
            port: 0,
            onListen({ port }) {
              listenerPort = port;
            },
          },
          (request) => {
            const pathname = new URL(request.url).pathname;
            paths.push(pathname);
            if (pathname === DASHBOARD_SESSION_PATH) {
              return Promise.resolve(
                new Response(null, {
                  status: 204,
                  headers: {
                    "Set-Cookie": `${
                      getDashboardSessionCookieName(listenerPort)
                    }=${csrfToken}; Path=/_dev; HttpOnly`,
                  },
                }),
              );
            }
            if (pathname === "/_dev/api/hmr-trigger") {
              return Promise.resolve(Response.json({ success: true }));
            }
            return Promise.resolve(new Response("UI assets unavailable", { status: 503 }));
          },
        );
        const address = server.addr;
        if (address.transport !== "tcp") throw new Error("expected TCP test server");

        try {
          client = new DevServerClient({ port: address.port });
          assertEquals(await client.triggerHmr(), { success: true });
          assertEquals(paths, [DASHBOARD_SESSION_PATH, "/_dev/api/hmr-trigger"]);
        } finally {
          await server.shutdown();
        }
      });

      it("rejects session cookies issued for another listener port", async () => {
        const csrfToken = "D".repeat(43);
        let otherPort = 65_535;
        const server = Deno.serve(
          { hostname: "localhost", port: 0, onListen() {} },
          () =>
            Promise.resolve(
              new Response(null, {
                status: 204,
                headers: {
                  "Set-Cookie": `${
                    getDashboardSessionCookieName(otherPort)
                  }=${csrfToken}; Path=/_dev; HttpOnly`,
                },
              }),
            ),
        );
        const address = server.addr;
        if (address.transport !== "tcp") throw new Error("expected TCP test server");
        otherPort = address.port === 65_535 ? 65_534 : 65_535;

        try {
          client = new DevServerClient({ port: address.port });
          const rejection = await assertRejects(
            () => client.triggerHmr(),
            Error,
            "valid dashboard session cookie",
          ) as Error;
          assertEquals(rejection.message.includes(csrfToken), false);
        } finally {
          await server.shutdown();
        }
      });

      it("rejects an oversized session cookie without reflecting it", async () => {
        const oversizedToken = "E".repeat(2_048);
        let listenerPort = 0;
        const server = Deno.serve(
          {
            hostname: "localhost",
            port: 0,
            onListen({ port }) {
              listenerPort = port;
            },
          },
          () =>
            Promise.resolve(
              new Response(null, {
                status: 204,
                headers: {
                  "Set-Cookie": `${
                    getDashboardSessionCookieName(listenerPort)
                  }=${oversizedToken}; Path=/_dev; HttpOnly`,
                },
              }),
            ),
        );
        const address = server.addr;
        if (address.transport !== "tcp") throw new Error("expected TCP test server");

        try {
          client = new DevServerClient({ port: address.port });
          const rejection = await assertRejects(
            () => client.triggerHmr(),
            Error,
            "valid dashboard session cookie",
          ) as Error;
          assertEquals(rejection.message.includes(oversizedToken), false);
        } finally {
          await server.shutdown();
        }
      });

      it("rejects an oversized dashboard JSON response before reading it", async () => {
        const csrfToken = "G".repeat(43);
        let listenerPort = 0;
        const server = Deno.serve(
          {
            hostname: "localhost",
            port: 0,
            onListen({ port }) {
              listenerPort = port;
            },
          },
          (request) => {
            if (new URL(request.url).pathname === DASHBOARD_SESSION_PATH) {
              return Promise.resolve(
                new Response(null, {
                  status: 204,
                  headers: {
                    "Set-Cookie": `${
                      getDashboardSessionCookieName(listenerPort)
                    }=${csrfToken}; Path=/_dev; HttpOnly`,
                  },
                }),
              );
            }
            return Promise.resolve(
              new Response("{}", {
                headers: {
                  "Content-Type": "application/json",
                  "Content-Length": String(MAX_DEV_SERVER_JSON_RESPONSE_BYTES + 1),
                },
              }),
            );
          },
        );
        const address = server.addr;
        if (address.transport !== "tcp") throw new Error("expected TCP test server");

        try {
          client = new DevServerClient({ port: address.port });
          await assertRejects(
            () => client.triggerHmr(),
            RangeError,
            `${MAX_DEV_SERVER_JSON_RESPONSE_BYTES}-byte limit`,
          );
        } finally {
          await server.shutdown();
        }
      });

      it("never follows a redirect while carrying dashboard credentials", async () => {
        const csrfToken = "F".repeat(43);
        let listenerPort = 0;
        let redirectedRequests = 0;
        const server = Deno.serve(
          {
            hostname: "localhost",
            port: 0,
            onListen({ port }) {
              listenerPort = port;
            },
          },
          (request) => {
            const pathname = new URL(request.url).pathname;
            if (pathname === DASHBOARD_SESSION_PATH) {
              return Promise.resolve(
                new Response(null, {
                  status: 204,
                  headers: {
                    "Set-Cookie": `${
                      getDashboardSessionCookieName(listenerPort)
                    }=${csrfToken}; Path=/_dev; HttpOnly`,
                  },
                }),
              );
            }
            if (pathname === "/redirected") {
              redirectedRequests++;
              return Promise.resolve(Response.json({ unexpected: true }));
            }
            return Promise.resolve(
              new Response(null, {
                status: 307,
                headers: { Location: "/redirected" },
              }),
            );
          },
        );
        const address = server.addr;
        if (address.transport !== "tcp") throw new Error("expected TCP test server");

        try {
          client = new DevServerClient({ port: address.port });
          await assertRejects(() => client.triggerHmr(), TypeError);
          assertEquals(redirectedRequests, 0);
        } finally {
          await server.shutdown();
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

      it("rejects ports outside the canonical listener range", () => {
        for (const port of [0, -1, 1.5, 65_536, Number.NaN, Number.POSITIVE_INFINITY]) {
          assertThrows(
            () => new DevServerClient({ port }),
            RangeError,
            "integer from 1 to 65535",
          );
        }
      });

      it("rejects unbounded filters, paths, and numeric query controls", async () => {
        const client = new DevServerClient({ port: 3000 });

        assertThrows(
          () => client.getLiveErrors("x".repeat(1025)),
          TypeError,
          "1024-character limit",
        );
        assertThrows(
          () => client.getLiveLogs({ pattern: "line\nfeed" }),
          TypeError,
          "Log pattern",
        );
        assertThrows(
          () => client.getLiveLogs({ limit: 10_001 }),
          RangeError,
          "1 to 10000",
        );
        assertThrows(
          () => client.getLiveLogs({ since: -1 }),
          RangeError,
          "non-negative",
        );
        await assertRejects(
          () => client.triggerHmr("x".repeat(4097)),
          TypeError,
          "4096-character limit",
        );
      });
    });
  });
});
