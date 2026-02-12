import { assert, assertEquals } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { describe, it } from "#veryfront/testing/bdd";
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
