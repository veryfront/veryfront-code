import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { handleDashboardAPI } from "./api.ts";
import type { HandlerContext } from "../../types.ts";

// Minimal mock adapter with fs that tracks readDir/readFile calls
function createMockCtx(): HandlerContext {
  return {
    projectDir: "/project",
    adapter: {
      fs: {
        readDir: async function* () {},
        readFile: async () => new Uint8Array(),
      },
    },
    securityConfig: null,
    cspUserHeader: null,
  } as unknown as HandlerContext;
}

describe("Dashboard API path validation", () => {
  it("rejects path traversal with '..' in list files", async () => {
    const req = new Request("http://localhost/_dev/api/files?path=../../etc/passwd");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
    const body = await res!.json();
    assertEquals(body.error.includes("Invalid path"), true);
  });

  it("rejects encoded path traversal in list files", async () => {
    const req = new Request("http://localhost/_dev/api/files?path=%2e%2e%2f%2e%2e%2fetc%2fpasswd");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });

  it("rejects null bytes in list files", async () => {
    const req = new Request("http://localhost/_dev/api/files?path=src%00.ts");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });

  it("allows valid relative paths in list files", async () => {
    const req = new Request("http://localhost/_dev/api/files?path=src/components");
    const res = await handleDashboardAPI(req, createMockCtx());
    // Should succeed (200) since mock adapter returns empty readDir
    assertEquals(res?.status, 200);
  });

  it("rejects path traversal in file-content", async () => {
    const req = new Request("http://localhost/_dev/api/file-content?path=../../etc/passwd");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });

  it("rejects encoded path traversal in file-content", async () => {
    const req = new Request(
      "http://localhost/_dev/api/file-content?path=%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    );
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });

  it("rejects null bytes in file-content", async () => {
    const req = new Request("http://localhost/_dev/api/file-content?path=src%00.ts");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
  });

  it("allows filenames with percent signs (no double-decoding)", async () => {
    const req = new Request("http://localhost/_dev/api/files?path=reports%2F100%25done");
    const res = await handleDashboardAPI(req, createMockCtx());
    // searchParams.get decodes to "reports/100%done" — should not fail
    assertEquals(res?.status, 200);
  });

  it("requires path parameter for file-content", async () => {
    const req = new Request("http://localhost/_dev/api/file-content");
    const res = await handleDashboardAPI(req, createMockCtx());
    assertEquals(res?.status, 400);
    const body = await res!.json();
    assertEquals(body.error, "path parameter is required");
  });
});
