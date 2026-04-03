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
        `<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference" nonce="${nonce}"></script>`,
      ),
      true,
    );
  });
});
