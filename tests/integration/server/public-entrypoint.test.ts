import { assert, assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { join } from "#veryfront/compat/path";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { writeTextFile } from "#veryfront/compat/fs.ts";
import { withTestContext } from "../../_helpers/context.ts";

describe("Server Public Entrypoints", { sanitizeResources: false, sanitizeOps: false }, () => {
  it("exposes server APIs from package root and server subpath", async () => {
    const rootApi = await import("veryfront");
    const serverApi = await import("veryfront/server");

    assertEquals(typeof rootApi.startServer, "function");
    assertEquals(typeof rootApi.createHandler, "function");

    assertEquals(typeof serverApi.startServer, "function");
    assertEquals(typeof serverApi.startDevServer, "function");
    assertEquals(typeof serverApi.startProductionServer, "function");
    assertEquals(typeof serverApi.createHandler, "function");
  });

  it("starts and serves a page via root package startServer", async () => {
    const { startServer } = await import("veryfront");

    await withTestContext("public-root-server-entrypoint", async (context) => {
      await writeTextFile(
        join(context.projectDir, "pages", "index.mdx"),
        "# Public Entrypoint\n\nServed via startServer.",
      );

      const port = await context.allocatePort();
      const server = await startServer({
        mode: "development",
        projectDir: context.projectDir,
        port,
        enableHMR: false,
        defaultProjectSlug: context.projectId,
        defaultProjectId: context.projectId,
      });

      try {
        await server.ready;
        const response = await fetch(`http://127.0.0.1:${port}/`);
        assertEquals(response.status, 200);

        const html = await response.text();
        assert(
          html.includes("Public Entrypoint"),
          "Expected root entrypoint server to render test page",
        );
      } finally {
        await server.stop();
      }
    });
  });

  it("records Deno serve peer provenance in the public handler path", async () => {
    const { createHandler } = await import("veryfront");

    await withTestContext("public-handler-deno-peer-provenance", async (context) => {
      const handler = await createHandler({
        projectDir: context.projectDir,
        port: await context.allocatePort(),
      });

      try {
        const localResponse = await handler(
          new Request("http://localhost/_metrics", {
            headers: { host: "localhost" },
          }),
          {
            remoteAddr: {
              transport: "tcp",
              hostname: "127.0.0.1",
              port: 52_000,
            },
          },
        );
        assertEquals(localResponse.status, 200);

        const remoteResponse = await handler(
          new Request("http://localhost/_metrics", {
            headers: {
              host: "localhost",
              "x-forwarded-for": "127.0.0.1",
            },
          }),
          {
            remoteAddr: {
              transport: "tcp",
              hostname: "192.168.1.25",
              port: 52_001,
            },
          },
        );
        assertNotEquals(remoteResponse.status, 200);

        const spoofedResponse = await handler(
          new Request("http://localhost/_metrics", {
            headers: {
              host: "localhost",
              "x-real-ip": "127.0.0.1",
            },
          }),
          {
            remoteAddr: {
              transport: "tcp",
              hostname: "127.0.0.1",
              port: 52_002,
            },
          },
        );
        assertNotEquals(spoofedResponse.status, 200);
      } finally {
        await handler.dispose();
      }
    });
  });

  it("records Bun serve peer provenance in the public handler path", async () => {
    const { createHandler } = await import("veryfront");

    await withTestContext("public-handler-bun-peer-provenance", async (context) => {
      const handler = await createHandler({
        projectDir: context.projectDir,
        port: await context.allocatePort(),
      });

      try {
        const localRequest = new Request("http://localhost/_metrics", {
          headers: { host: "localhost" },
        });
        const localResponse = await handler(localRequest, {
          requestIP(seenRequest: Request) {
            assertEquals(seenRequest, localRequest);
            return {
              address: "127.0.0.1",
              port: 52_000,
              family: "IPv4",
            };
          },
        });
        assertEquals(localResponse.status, 200);

        const remoteRequest = new Request("http://localhost/_metrics", {
          headers: {
            host: "localhost",
            "x-forwarded-for": "127.0.0.1",
          },
        });
        const remoteResponse = await handler(remoteRequest, {
          requestIP(seenRequest: Request) {
            assertEquals(seenRequest, remoteRequest);
            return {
              address: "192.168.1.25",
              port: 52_001,
              family: "IPv4",
            };
          },
        });
        assertNotEquals(remoteResponse.status, 200);
      } finally {
        await handler.dispose();
      }
    });
  });

  it("starts production server via package server subpath", async () => {
    const { startProductionServer } = await import("veryfront/server");

    await withTestContext("public-server-subpath-entrypoint", async (context) => {
      const port = await context.allocatePort();
      const controller = new AbortController();
      const server = await startProductionServer({
        projectDir: context.projectDir,
        port,
        bindAddress: "127.0.0.1",
        signal: controller.signal,
        defaultProjectSlug: context.projectId,
        defaultProjectId: context.projectId,
      });

      try {
        await server.ready;
        const response = await fetch(`http://127.0.0.1:${port}/healthz`);
        assertEquals(response.status, 200);
        assertEquals(await response.json(), { service: "veryfront-server", status: "ok" });
      } finally {
        controller.abort();
        await server.stop();
      }
    });
  });
});
