import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "../types.ts";
import { StaticHandler } from "./static.handler.ts";

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/tmp/test-project",
    adapter: {
      name: "test",
      env: { get: () => undefined },
      fs: {},
    },
    securityConfig: {},
    cspUserHeader: null,
    isLocalProject: false,
    requestContext: {
      mode: "production",
    } as HandlerContext["requestContext"],
    ...overrides,
  } as unknown as HandlerContext;
}

describe("server/handlers/request/static.handler", () => {
  it("adds matching nonces to static HTML responses before applying CSP", async () => {
    const handler = new StaticHandler();
    (handler as any).staticService = {
      resolveFile: async () => ({
        path: "/tmp/test-project/dist/index.html",
        data: new TextEncoder().encode(
          [
            "<!doctype html>",
            "<html><head>",
            '<script type="importmap" nonce="build-nonce">{"imports":{"react":"https://esm.sh/react"}}</script>',
            '<style nonce="build-nonce">.chat{color:red}</style>',
            "</head><body>",
            '<script id="veryfront-hydration-data" type="application/json">{"page":"index"}</script>',
            `<script type="module">window.tpl="<script>alert(1)";</script>`,
            "</body></html>",
          ].join(""),
        ),
        etag: '"stale-etag"',
        contentType: "text/html; charset=utf-8",
        cacheStrategy: "medium",
        source: "dist",
      }),
      isAssetRequest: () => true,
    };

    const result = await handler.handle(new Request("http://localhost/"), makeCtx());
    assertExists(result.response);

    const response = result.response;
    const body = await response.text();
    const csp = response.headers.get("content-security-policy") ?? "";
    const nonceMatch = csp.match(/nonce-([^' ;]+)/);

    assertEquals(Boolean(nonceMatch), true);
    const nonce = nonceMatch![1]!;

    assertEquals(body.includes(`<script type="importmap" nonce="${nonce}">`), true);
    assertEquals(body.includes(`<style nonce="${nonce}">.chat{color:red}</style>`), true);
    assertEquals(body.includes('nonce="build-nonce"'), false);
    assertEquals(
      body.includes(
        `<script id="veryfront-hydration-data" type="application/json" nonce="${nonce}">{"page":"index"}</script>`,
      ),
      true,
    );
    assertEquals(
      body.includes(`window.tpl="<script>alert(1)";</script>`),
      true,
    );
    assertEquals(body.includes(`<script nonce="${nonce}">alert(1)`), false);
    assertEquals(response.headers.get("etag") === '"stale-etag"', false);
  });
});
