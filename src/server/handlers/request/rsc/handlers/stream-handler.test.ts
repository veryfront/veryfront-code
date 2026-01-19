import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { StreamHandler } from "./stream-handler.ts";
import type { RenderHandler } from "./render-handler.ts";

describe("StreamHandler", () => {
  let streamHandler: StreamHandler;
  let mockRenderHandler: RenderHandler;
  let handleCalls: Array<[string, URLSearchParams]>;

  beforeEach(() => {
    handleCalls = [];

    mockRenderHandler = {
      handle: (page: string, params: URLSearchParams) => {
        handleCalls.push([page, params]);
        return Promise.resolve(
          new Response(JSON.stringify({ html: "<div>Test Content</div>" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      },
    } as unknown as RenderHandler;

    streamHandler = new StreamHandler(mockRenderHandler);
  });

  describe("handle", () => {
    it("should return a Response with correct content-type", async () => {
      const response = await streamHandler.handle("/", new URLSearchParams());

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("content-type")).toBe(
        "application/x-ndjson; charset=utf-8",
      );
      expect(response.headers.get("cache-control")).toBe("no-cache");
    });

    it("should stream slot updates as NDJSON", async () => {
      const response = await streamHandler.handle("/test", new URLSearchParams());

      const text = await response.text();
      const lines = text.trim().split("\n");

      // Should have at least the initial slots and final content
      expect(lines.length).toBeGreaterThan(0);

      // Each line should be valid JSON
      for (const line of lines) {
        if (line.trim()) {
          expect(() => JSON.parse(line)).not.toThrow();
          const parsed = JSON.parse(line);
          expect(parsed.type).toBe("slot");
          expect(parsed.id).toBeDefined();
          expect(parsed.html).toBeDefined();
        }
      }
    });

    it("should use page query param when provided", async () => {
      const searchParams = new URLSearchParams({ page: "/custom-page" });
      await streamHandler.handle("/", searchParams);

      expect(handleCalls.length).toBe(1);
      expect(handleCalls[0]?.[0]).toBe("/custom-page");
    });

    it("should use pathname when page query param is not provided", async () => {
      const searchParams = new URLSearchParams();
      await streamHandler.handle("/my-page", searchParams);

      expect(handleCalls.length).toBe(1);
      expect(handleCalls[0]?.[0]).toBe("/my-page");
    });

    it("should handle render handler returning non-ok response", async () => {
      mockRenderHandler.handle = () => Promise.resolve(new Response(null, { status: 500 }));

      const response = await streamHandler.handle("/", new URLSearchParams());
      const text = await response.text();

      // Should still produce valid output with fallback HTML
      expect(text).toContain("OK");
    });

    it("should handle invalid JSON from render handler", async () => {
      mockRenderHandler.handle = () => Promise.resolve(new Response("not-json", { status: 200 }));

      const response = await streamHandler.handle("/", new URLSearchParams());
      const text = await response.text();

      // Should still produce valid output with fallback HTML
      expect(text).toContain("OK");
    });

    it("should include malformed JSON when bad query param is set", async () => {
      const searchParams = new URLSearchParams({ bad: "1" });
      const response = await streamHandler.handle("/", searchParams);
      const text = await response.text();

      // Should contain malformed JSON line
      expect(text).toContain("MALFORMED_JSON");
    });
  });

  describe("error handling", () => {
    it("should handle render handler errors gracefully", async () => {
      // When renderHandler throws before stream creation, the error propagates
      mockRenderHandler.handle = () => Promise.reject(new Error("Render failed"));

      // The error from getFinalHtml propagates before stream is created
      await expect(
        streamHandler.handle("/", new URLSearchParams()),
      ).rejects.toThrow("Render failed");
    });

    it("should return valid response even with non-ok render response", async () => {
      // When renderHandler returns a non-ok response, stream still works
      mockRenderHandler.handle = () => Promise.resolve(new Response("Error", { status: 500 }));

      const response = await streamHandler.handle("/", new URLSearchParams());

      // The response should be created and contain fallback HTML
      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain("OK");
    });
  });
});
