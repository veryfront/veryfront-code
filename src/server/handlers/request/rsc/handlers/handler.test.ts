import { afterAll, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { RSCDevServerHandler } from "./handler.ts";

// esbuild spawns a subprocess for bundling that requires time to shut down
// Disable sanitizers to avoid flaky test failures from async cleanup
describe(
  "RSCDevServerHandler",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    afterAll(async () => {
      // Give esbuild subprocess time to fully terminate
      const { stop } = await import("esbuild/mod.js");
      await stop();
      await new Promise((r) => setTimeout(r, 100));
    });
    let handler: RSCDevServerHandler;

    beforeEach(() => {
      // Use a test project directory
      handler = new RSCDevServerHandler("/tmp/test-project");
    });

    describe("constructor", () => {
      it("should create handler with project directory", () => {
        expect(handler).toBeDefined();
      });
    });

    describe("handlePage", () => {
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

    describe("handleHydratorScript", () => {
      it("should return hydrator script response", async () => {
        const response = await handler.handleHydratorScript();

        expect(response).toBeInstanceOf(Response);
        expect(response.headers.get("content-type")).toContain("javascript");
      });
    });

    describe("handleManifest", () => {
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
