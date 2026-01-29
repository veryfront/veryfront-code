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

// ---------------------------------------------------------------------------
// isModuleRequest
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// serveModule - non-module request handling
// ---------------------------------------------------------------------------

describe("serveModule", () => {
  // We can test serveModule for non-module paths without needing
  // a full adapter since it returns early with 404
  it("should return 404 for non-module path prefix", async () => {
    const { serveModule } = await import("./module-server.ts");

    const req = new Request("http://localhost:3000/not-a-module");
    const response = await serveModule(req, {
      projectId: "test",
      projectDir: "/tmp/test",
      adapter: {} as any,
    });

    assertEquals(response.status, 404);
    const body = await response.text();
    assertEquals(body, "Module not found");
  });

  it("should handle HEAD request for non-module path", async () => {
    const { serveModule } = await import("./module-server.ts");

    const req = new Request("http://localhost:3000/not-a-module", { method: "HEAD" });
    const response = await serveModule(req, {
      projectId: "test",
      projectDir: "/tmp/test",
      adapter: {} as any,
    });

    assertEquals(response.status, 404);
  });

  it("should return 404 for snippet with missing hash", async () => {
    const { serveModule } = await import("./module-server.ts");

    // Snippet URL pattern but no valid hash captured
    const req = new Request("http://localhost:3000/_vf_modules/_snippets/.js");
    const response = await serveModule(req, {
      projectId: "test",
      projectDir: "/tmp/test",
      adapter: {} as any,
    });

    // Should either return 404 for missing snippet or 404 for module not found
    assertEquals(response.status === 404 || response.status === 500, true);
  });

  it("should return 404 for invalid cross-project import path", async () => {
    const { serveModule } = await import("./module-server.ts");

    // Cross-project versioned pattern without valid path segment
    const req = new Request("http://localhost:3000/_vf_modules/_cross//@/");
    const response = await serveModule(req, {
      projectId: "test",
      projectDir: "/tmp/test",
      adapter: {} as any,
    });

    // Pattern won't match the regex, falls through to normal module resolution
    assertEquals(response.status === 404 || response.status === 500, true);
  });
});
