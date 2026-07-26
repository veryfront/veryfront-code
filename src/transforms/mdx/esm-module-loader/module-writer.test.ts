import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildMdxModuleCacheIdentity } from "./module-writer.ts";
import { mdxRenderer } from "../index.ts";
import { denoAdapter } from "#veryfront/platform/adapters/deno.ts";

describe("MDX root module cache identity", () => {
  it("isolates namespace, file, LRU, and import identities across pin snapshots", async () => {
    const code = "export default function MDXContent() { return null; }";
    const [snapshotA, snapshotB] = await Promise.all([
      buildMdxModuleCacheIdentity(
        "/cache/mdx",
        "project-id",
        "19.1.1",
        code,
        "on:snapshot-a",
      ),
      buildMdxModuleCacheIdentity(
        "/cache/mdx",
        "project-id",
        "19.1.1",
        code,
        "on:snapshot-b",
      ),
    ]);

    assertEquals(snapshotA.codeHash, snapshotB.codeHash);
    assertEquals(snapshotA.namespaceKey === snapshotB.namespaceKey, false);
    assertEquals(snapshotA.compositeKey === snapshotB.compositeKey, false);
    assertEquals(snapshotA.filePath === snapshotB.filePath, false);
    assertEquals(snapshotA.importUrl === snapshotB.importUrl, false);
  });

  it("preserves the flag-off cache identity", async () => {
    const code = "export const value = 1;";
    const [omitted, flagOff] = await Promise.all([
      buildMdxModuleCacheIdentity("/cache/mdx", "project-id", "19.1.1", code),
      buildMdxModuleCacheIdentity(
        "/cache/mdx",
        "project-id",
        "19.1.1",
        code,
        "off",
      ),
    ]);

    assertEquals(flagOff, omitted);
  });

  it("isolates pin-on root modules by request origin", async () => {
    const code = "export const value = 1;";
    const [originA, originB] = await Promise.all([
      buildMdxModuleCacheIdentity(
        "/cache/mdx",
        "project-id",
        "19.1.1",
        code,
        "on:snapshot",
        "https://a.example",
      ),
      buildMdxModuleCacheIdentity(
        "/cache/mdx",
        "project-id",
        "19.1.1",
        code,
        "on:snapshot",
        "https://b.example",
      ),
    ]);

    assertEquals(originA.namespaceKey === originB.namespaceKey, false);
    assertEquals(originA.compositeKey === originB.compositeKey, false);
  });

  it("pins a top-level same-origin absolute module before strict SSR fetching", async () => {
    const modulePath = `/_vf_modules/StrictChild-${crypto.randomUUID()}.js`;
    let validRequests = 0;
    let rawRequests = 0;
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen: () => {} },
      (request) => {
        const url = new URL(request.url);
        if (url.pathname !== modulePath) return new Response("not found", { status: 404 });
        if (
          url.searchParams.get("pins") !== "on:snapshot" ||
          url.searchParams.get("ssr") !== "true"
        ) {
          rawRequests++;
          return new Response("missing dependency snapshot", { status: 409 });
        }

        validRequests++;
        return new Response('export default "STRICT_CHILD_OK";', {
          headers: { "content-type": "application/javascript" },
        });
      },
    );
    const address = server.addr;
    if (address.transport !== "tcp") throw new Error("expected TCP test server");
    const origin = `http://127.0.0.1:${address.port}`;
    const projectDir = await Deno.makeTempDir({ prefix: "vf-mdx-origin-" });

    try {
      const mod = await mdxRenderer.loadModuleESM(
        `import child from "${origin}${modulePath}";\nexport default child;`,
        denoAdapter,
        `project-${crypto.randomUUID()}`,
        projectDir,
        "strict-origin",
        `source-${crypto.randomUUID()}`,
        "19.1.1",
        "on:snapshot",
        {},
        projectDir,
        origin,
      );

      assertEquals(mod.default as unknown, "STRICT_CHILD_OK");
      assertEquals(validRequests > 0, true);
      assertEquals(rawRequests, 0);
    } finally {
      mdxRenderer.clearCache();
      await server.shutdown();
      await server.finished;
      await Deno.remove(projectDir, { recursive: true });
      const esbuild = await import("veryfront/extensions/bundler");
      await esbuild.stop();
    }
  });
});
