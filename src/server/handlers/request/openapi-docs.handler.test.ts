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
    isLocalProject: true,
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
  it("adds matching nonces to inline docs assets", async () => {
    const handler = new OpenAPIDocsHandler();
    const result = await handler.handle(
      new Request("http://localhost/_docs"),
      makeCtx({ cspUserHeader: "script-src 'nonce-{NONCE}'" }),
    );
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
        `<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference" nonce="${nonce}"></script>`,
      ),
      true,
    );
  });

  it("returns a no-store 503 for remote docs instead of a broken explorer", async () => {
    const handler = new OpenAPIDocsHandler();
    const docsPath = "/metadata/docs";
    const ctx = makeCtx({
      isLocalProject: false,
      config: {
        openapi: {
          enabled: true,
          docs: true,
          paths: { docs: docsPath, json: "/metadata/openapi.json" },
        },
      } as HandlerContext["config"],
    });

    const result = await handler.handle(
      new Request(`https://example.com${docsPath}`),
      ctx,
    );

    assertEquals(result.response?.status, 503);
    assertEquals(await result.response?.text(), "OpenAPI specification unavailable");
    assertEquals(result.response?.headers.get("cache-control"), "no-store");
  });

  it("keeps docs unavailable when locality is inherited from Object.prototype", async () => {
    const previous = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "isLocalProject",
    );
    const ctx = makeCtx();
    delete (ctx as { isLocalProject?: boolean }).isLocalProject;
    let result: Awaited<ReturnType<OpenAPIDocsHandler["handle"]>> | undefined;

    try {
      Object.defineProperty(Object.prototype, "isLocalProject", {
        configurable: true,
        value: true,
      });
      result = await new OpenAPIDocsHandler().handle(
        new Request("http://localhost/_docs"),
        ctx,
      );
    } finally {
      if (previous) {
        Object.defineProperty(Object.prototype, "isLocalProject", previous);
      } else {
        delete (Object.prototype as { isLocalProject?: boolean }).isLocalProject;
      }
    }

    assertEquals(result?.response?.status, 503);
    assertEquals(await result?.response?.text(), "OpenAPI specification unavailable");
  });

  it("escapes the configured specification URL as an HTML attribute", async () => {
    const handler = new OpenAPIDocsHandler();
    const specPath = `/_openapi.json" onload="alert(1)&next=<unsafe>`;
    const ctx = makeCtx({
      config: {
        openapi: {
          enabled: true,
          docs: true,
          paths: { docs: "/_docs", json: specPath },
        },
      } as HandlerContext["config"],
    });

    const result = await handler.handle(new Request("http://localhost/_docs"), ctx);
    const body = await result.response!.text();

    assertEquals(body.includes(`data-url="${specPath}"`), false);
    assertEquals(
      body.includes(
        `data-url="/_openapi.json&quot; onload=&quot;alert(1)&amp;next=&lt;unsafe&gt;"`,
      ),
      true,
    );
  });
});
