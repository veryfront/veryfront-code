import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { OpenAPIDocsHandler } from "./openapi-docs.handler.ts";
import type { HandlerContext } from "../types.ts";

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/tmp/test-project",
    adapter: {
      name: "test",
      env: { get: () => undefined },
    },
    securityConfig: {},
    cspUserHeader: null,
    isLocalProject: false,
    config: {
      openapi: {
        enabled: true,
        docs: true,
        title: "Test Docs",
        paths: { docs: "/_docs", json: "/_openapi.json" },
      },
    } as HandlerContext["config"],
    ...overrides,
  } as unknown as HandlerContext;
}

describe("server/handlers/request/openapi-docs.handler", () => {
  it("rejects non-read methods with a secured 405 response", async () => {
    const result = await new OpenAPIDocsHandler().handle(
      new Request("http://localhost/_docs", { method: "POST" }),
      makeCtx(),
    );

    assertEquals(result.response?.status, 405);
    assertEquals(result.response?.headers.get("allow"), "GET, HEAD");
    assertEquals(result.response?.headers.get("cache-control")?.includes("no-store"), true);
    assertEquals(result.response?.headers.get("x-content-type-options"), "nosniff");
  });

  it("returns headers without a response body for HEAD", async () => {
    const result = await new OpenAPIDocsHandler().handle(
      new Request("http://localhost/_docs", { method: "HEAD" }),
      makeCtx(),
    );

    assertEquals(result.response?.status, 200);
    assertEquals(await result.response!.text(), "");
    assertEquals(result.response?.headers.get("content-type"), "text/html; charset=utf-8");
  });

  it("adds matching nonces to inline docs assets", async () => {
    const handler = new OpenAPIDocsHandler();
    const result = await handler.handle(new Request("http://localhost/_docs"), makeCtx());
    const response = result.response!;
    const body = await response.text();

    const csp = response.headers.get("content-security-policy") ?? "";
    const nonceMatch = csp.match(/nonce-([^' ;]+)/);

    assertEquals(Boolean(nonceMatch), true);
    const nonce = nonceMatch![1]!;

    assertEquals(body.includes(`<style nonce="${nonce}">`), true);
    assertEquals(body.includes(`nonce="${nonce}"`), true);
    assertEquals(
      body.includes(
        `nonce="${nonce}"`,
      ),
      true,
    );
  });

  it("escapes configured spec paths before embedding them in HTML", async () => {
    const handler = new OpenAPIDocsHandler();
    const result = await handler.handle(
      new Request("http://localhost/_docs"),
      makeCtx({
        config: {
          openapi: {
            enabled: true,
            docs: true,
            paths: {
              docs: "/_docs",
              json: `/_openapi.json" onload="globalThis.compromised=true`,
            },
          },
        } as HandlerContext["config"],
      }),
    );
    const body = await result.response!.text();

    assertEquals(body.includes(`data-url="/_openapi.json" onload=`), false);
    assertEquals(body.includes("&quot; onload=&quot;"), true);
  });

  it("pins the external docs runtime with subresource integrity", async () => {
    const handler = new OpenAPIDocsHandler();
    const result = await handler.handle(new Request("http://localhost/_docs"), makeCtx());
    const body = await result.response!.text();

    assertEquals(
      body.includes(
        "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.62.9/dist/browser/standalone.js",
      ),
      true,
    );
    assertEquals(body.includes('integrity="sha384-'), true);
    assertEquals(body.includes('crossorigin="anonymous"'), true);
  });
});
