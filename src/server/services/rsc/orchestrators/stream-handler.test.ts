import "#veryfront/schemas/_test-setup.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { RenderHandler } from "./render-handler.ts";
import { StreamHandler } from "./stream-handler.ts";
import { RSC_DEPENDENCY_PINNING_HEADER } from "#veryfront/rendering/rsc/constants.ts";

class MockRenderHandler extends RenderHandler {
  private handlerImpl: (
    page: string,
    params: URLSearchParams,
    request?: Request,
  ) => Promise<Response>;

  constructor(
    handlerImpl: (
      page: string,
      params: URLSearchParams,
      request?: Request,
    ) => Promise<Response>,
  ) {
    super("/project", () => null);
    this.handlerImpl = handlerImpl;
  }

  setHandler(
    handlerImpl: (
      page: string,
      params: URLSearchParams,
      request?: Request,
    ) => Promise<Response>,
  ): void {
    this.handlerImpl = handlerImpl;
  }

  override handle(
    page: string,
    params: URLSearchParams,
    request?: Request,
  ): Promise<Response> {
    return this.handlerImpl(page, params, request);
  }
}

describe("StreamHandler", () => {
  let streamHandler: StreamHandler;
  let mockRenderHandler: MockRenderHandler;
  let handleCalls: Array<[string, URLSearchParams, Request | undefined]>;

  beforeEach(() => {
    handleCalls = [];

    mockRenderHandler = new MockRenderHandler((page, params, request) => {
      handleCalls.push([page, params, request]);
      return Promise.resolve(
        new Response(JSON.stringify({ html: "<div>Test Content</div>" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });

    streamHandler = new StreamHandler(mockRenderHandler);
  });

  describe("handle", () => {
    it("should return a Response with correct content-type", async () => {
      const response = await streamHandler.handle("/", new URLSearchParams());

      expect(response).toBeInstanceOf(Response);
      expect(response.headers.get("content-type")).toBe("application/x-ndjson; charset=utf-8");
      expect(response.headers.get("cache-control")).toBe("no-cache");
      expect(response.headers.get("vary")).toBe(RSC_DEPENDENCY_PINNING_HEADER);
    });

    it("should stream slot updates as NDJSON", async () => {
      const response = await streamHandler.handle("/test", new URLSearchParams());

      const text = await response.text();
      const lines = text.trim().split("\n");

      expect(lines.length).toBeGreaterThan(0);

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        expect(() => JSON.parse(trimmed)).not.toThrow();
        const parsed = JSON.parse(trimmed);
        expect(parsed.type).toBe("slot");
        expect(parsed.id).toBeDefined();
        expect(parsed.html).toBeDefined();
      }
    });

    it("exposes the exact dependency snapshot captured by the render payload", async () => {
      mockRenderHandler.setHandler(() =>
        Promise.resolve(
          new Response(JSON.stringify({
            html: "<div>Pinned</div>",
            clientRefs: {},
            dependencyPinningCacheKey: "on:pins-a",
          })),
        )
      );

      const response = await streamHandler.handle("/", new URLSearchParams());

      expect(response.headers.get(RSC_DEPENDENCY_PINNING_HEADER)).toBe(
        "on:pins-a",
      );
    });

    it("forwards the snapshot header while leaving application pins untouched", async () => {
      const request = new Request(
        "http://localhost/_veryfront/rsc/stream?pins=application-value",
        {
          headers: { [RSC_DEPENDENCY_PINNING_HEADER]: "on:pins-a" },
        },
      );
      const params = new URLSearchParams({ pins: "application-value" });

      await streamHandler.handle("/", params, request);

      expect(handleCalls[0]?.[1].get("pins")).toBe("application-value");
      expect(handleCalls[0]?.[2]).toBe(request);
    });

    it("should use page query param when provided", async () => {
      await streamHandler.handle("/", new URLSearchParams({ page: "/custom-page" }));

      expect(handleCalls.length).toBe(1);
      expect(handleCalls[0]?.[0]).toBe("/custom-page");
    });

    it("should use pathname when page query param is not provided", async () => {
      await streamHandler.handle("/my-page", new URLSearchParams());

      expect(handleCalls.length).toBe(1);
      expect(handleCalls[0]?.[0]).toBe("/my-page");
    });

    it("should handle render handler returning non-ok response", async () => {
      mockRenderHandler.setHandler(() => Promise.resolve(new Response(null, { status: 500 })));

      const response = await streamHandler.handle("/", new URLSearchParams());

      expect(await response.text()).toContain("OK");
    });

    it("should handle invalid JSON from render handler", async () => {
      mockRenderHandler.setHandler(() =>
        Promise.resolve(new Response("not-json", { status: 200 }))
      );

      const response = await streamHandler.handle("/", new URLSearchParams());

      expect(await response.text()).toContain("OK");
    });

    it("should include malformed JSON when bad query param is set", async () => {
      const response = await streamHandler.handle("/", new URLSearchParams({ bad: "1" }));

      expect(await response.text()).toContain("MALFORMED_JSON");
    });
  });

  describe("error handling", () => {
    it("should handle render handler errors gracefully", async () => {
      mockRenderHandler.setHandler(() => Promise.reject(new Error("Render failed")));

      await expect(streamHandler.handle("/", new URLSearchParams())).rejects.toThrow(
        "Render failed",
      );
    });

    it("should return valid response even with non-ok render response", async () => {
      mockRenderHandler.setHandler(() => Promise.resolve(new Response("Error", { status: 500 })));

      const response = await streamHandler.handle("/", new URLSearchParams());

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("OK");
    });
  });
});
