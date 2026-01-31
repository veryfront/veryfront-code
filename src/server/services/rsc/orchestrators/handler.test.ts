import { afterAll, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { delay } from "#std/async.ts";
import { RSCDevServerHandler } from "./handler.ts";

describe(
  "RSCDevServerHandler",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    let handler: RSCDevServerHandler;

    afterAll(async () => {
      const preserveEsbuild = (globalThis as Record<string, unknown>)
        .__vfTestPreserveEsbuild;
      if (preserveEsbuild) return;

      const { stop } = await import("esbuild");
      await stop();
      await delay(100);
    });

    beforeEach(() => {
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
        const response = handler.handlePage(
          "/",
          new URLSearchParams({ page: "/custom" }),
        );

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
        expect(response.headers.get("content-type")).toContain("application/json");
      });

      it("should return empty manifest when not initialized", async () => {
        const response = await handler.handleManifest();
        const text = await response.text();

        expect(() => JSON.parse(text)).not.toThrow();
      });
    });
  },
);
