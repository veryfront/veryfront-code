import { afterAll, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { RSCDevServerHandler } from "./handler.ts";
import { delay } from "#std/async.ts";

// esbuild spawns a subprocess for bundling that requires time to shut down
// Disable sanitizers to avoid flaky test failures from async cleanup
describe(
  "RSCDevServerHandler",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    afterAll(async () => {
      // Only stop esbuild if a test explicitly opted to keep it alive
      if (!(globalThis as Record<string, unknown>).__vfTestPreserveEsbuild) {
        const { stop } = await import("esbuild");
        await stop();
        await delay(100);
      }
    });
    let handler: RSCDevServerHandler;

    beforeEach(() => {
      // Use a test project directory
      handler = new RSCDevServerHandler("/tmp/test-project");
    });

    describe("constructor", { sanitizeOps: false, sanitizeResources: false }, () => {
      it("should create handler with project directory", () => {
        expect(handler).toBeDefined();
      });
    });

    describe("handlePage", { sanitizeOps: false, sanitizeResources: false }, () => {
      it("should return page response for valid pathname", () => {
        const response = handler.handlePage("/test", new URLSearchParams());

        expect(response).toBeInstanceOf(Response);
        expect(response.headers.get("content-type")).toContain("text/html");
      });

      it("should return page response for root pathname", () => {
        const response = handler.handlePage("/", new URLSearchParams());

        expect(response).toBeInstanceOf(Response);
        expect(response.status).toBe(200);
      });

      it("should handle search params", () => {
        const searchParams = new URLSearchParams({ page: "/custom" });
        const response = handler.handlePage("/", searchParams);

        expect(response).toBeInstanceOf(Response);
      });
    });

    describe("handleHydratorScript", { sanitizeOps: false, sanitizeResources: false }, () => {
      it("should return hydrator script response", async () => {
        const response = await handler.handleHydratorScript();

        expect(response).toBeInstanceOf(Response);
        expect(response.headers.get("content-type")).toContain("javascript");
      });
    });

    describe("handleManifest", { sanitizeOps: false, sanitizeResources: false }, () => {
      it("should return manifest response", async () => {
        const response = await handler.handleManifest();

        expect(response).toBeInstanceOf(Response);
        // Manifest returns JSON
        expect(response.headers.get("content-type")).toContain("application/json");
      });

      it("should return empty manifest when not initialized", async () => {
        const response = await handler.handleManifest();
        const text = await response.text();

        // Should return valid JSON (empty object or array)
        expect(() => JSON.parse(text)).not.toThrow();
      });
    });

    // Note: handleRender and handleStream require actual project files,
    // so they are tested in integration tests rather than unit tests
  },
);
