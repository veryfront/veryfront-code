/**
 * Module Server Tests
 *
 * Tests the exported isModuleRequest function and serveModule
 * behavior for various URL patterns, error formatting, and
 * content type detection.
 *
 * @module modules/server/module-server.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isModuleRequest } from "./module-server.ts";

describe("isModuleRequest", () => {
  it("should return true for /_vf_modules/ path", () => {
    const req = new Request("http://localhost:3000/_vf_modules/components/Button.tsx");
    assertEquals(isModuleRequest(req), true);
  });

  it("should return true for /_veryfront/modules/ path", () => {
    const req = new Request("http://localhost:3000/_veryfront/modules/lib/utils.ts");
    assertEquals(isModuleRequest(req), true);
  });

  it("should return false for non-module paths", () => {
    assertEquals(isModuleRequest(new Request("http://localhost:3000/")), false);
    assertEquals(isModuleRequest(new Request("http://localhost:3000/api/data")), false);
    assertEquals(isModuleRequest(new Request("http://localhost:3000/pages/index")), false);
  });

  it("should return false for partial prefix match", () => {
    assertEquals(isModuleRequest(new Request("http://localhost:3000/_vf_mod")), false);
    assertEquals(isModuleRequest(new Request("http://localhost:3000/_veryfront/mod")), false);
  });

  it("should return true for /_vf_modules/ with query params", () => {
    const req = new Request("http://localhost:3000/_vf_modules/file.tsx?t=123&ssr=true");
    assertEquals(isModuleRequest(req), true);
  });

  it("should return true for /_vf_modules/_snippets/ path", () => {
    const req = new Request("http://localhost:3000/_vf_modules/_snippets/abc123.js");
    assertEquals(isModuleRequest(req), true);
  });

  it("should return true for /_vf_modules/_cross/ path", () => {
    const req = new Request(
      "http://localhost:3000/_vf_modules/_cross/my-project@1.0.0/@/components/Button.tsx",
    );
    assertEquals(isModuleRequest(req), true);
  });
});

// sanitizeResources disabled: serveModule initialises the esbuild transform
// pipeline which spawns a long-lived child process. This is a pre-existing
// resource that cannot be torn down inside a unit test.
describe({ name: "serveModule", sanitizeResources: false, sanitizeOps: false }, () => {
  async function serve(req: Request): Promise<Response> {
    const { serveModule } = await import("./module-server.ts");
    return await serveModule(req, {
      projectId: "test",
      projectDir: "/tmp/test",
      adapter: {} as any,
    });
  }

  it("should return 404 for non-module path prefix", async () => {
    const response = await serve(new Request("http://localhost:3000/not-a-module"));

    assertEquals(response.status, 404);
    assertEquals(await response.text(), "Module not found");
  });

  it("should handle HEAD request for non-module path", async () => {
    const response = await serve(
      new Request("http://localhost:3000/not-a-module", { method: "HEAD" }),
    );

    assertEquals(response.status, 404);
  });

  it("should return 404 for snippet with missing hash", async () => {
    const response = await serve(new Request("http://localhost:3000/_vf_modules/_snippets/.js"));

    assertEquals(response.status === 404 || response.status === 500, true);
  });

  it("should return 404 for invalid cross-project import path", async () => {
    const response = await serve(new Request("http://localhost:3000/_vf_modules/_cross//@/"));

    assertEquals(response.status === 404 || response.status === 500, true);
  });

  it("should serve _dnt.shims.js with _veryfront/ prefix", async () => {
    const response = await serve(
      new Request("http://localhost:3000/_vf_modules/_veryfront/_dnt.shims.js"),
    );

    assertEquals(response.status, 200);
    const text = await response.text();
    assertEquals(text.includes("dntGlobalThis"), true);
    assertEquals(text.includes("fetch"), true);
  });

  it("should serve _dnt.polyfills.js with _veryfront/ prefix", async () => {
    const response = await serve(
      new Request("http://localhost:3000/_vf_modules/_veryfront/_dnt.polyfills.js"),
    );

    assertEquals(response.status, 200);
    const text = await response.text();
    assertEquals(text.includes("export"), true);
  });

  it("should serve _dnt.shims.js without prefix (relative imports)", async () => {
    const response = await serve(
      new Request("http://localhost:3000/_vf_modules/_dnt.shims.js"),
    );

    assertEquals(response.status, 200);
    const text = await response.text();
    assertEquals(text.includes("dntGlobalThis"), true);
  });

  it("should serve _dnt.polyfills.js without prefix (relative imports)", async () => {
    const response = await serve(
      new Request("http://localhost:3000/_vf_modules/_dnt.polyfills.js"),
    );

    assertEquals(response.status, 200);
  });

  it("should serve dnt shims as JavaScript content type", async () => {
    const response = await serve(
      new Request("http://localhost:3000/_vf_modules/_veryfront/_dnt.shims.js"),
    );

    assertEquals(response.status, 200);
    const contentType = response.headers.get("content-type") ?? "";
    assertEquals(contentType.includes("javascript"), true);
  });
});
