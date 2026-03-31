import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { base64urlEncode } from "#veryfront/utils/base64url.ts";
import type { HandlerContext } from "../../types.ts";
import { DevFileHandler } from "./dev-file.handler.ts";

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/project",
    adapter: createMockAdapter(),
    securityConfig: null,
    cspUserHeader: null,
    ...overrides,
  } as HandlerContext;
}

describe(
  "server/handlers/dev/files/dev-file.handler",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
  afterEach(async () => {
    const esbuild = await import("esbuild");
    esbuild.stop();
  });

  it("serves preview file modules for remote preview mode", async () => {
    const handler = new DevFileHandler();
    const adapter = createMockAdapter();
    const modulePath = "/project/app/page.tsx";
    adapter.fs.files.set(
      modulePath,
      "export default function Page() { return 'preview'; }",
    );

    const encodedPath = base64urlEncode("app/page.tsx");
    const req = new Request(`http://localhost/_veryfront/fs/${encodedPath}.js`);
    const ctx = makeCtx({
      adapter,
      isLocalProject: false,
      requestContext: { mode: "preview" } as HandlerContext["requestContext"],
    });

    const result = await handler.handle(req, ctx);

    assertEquals(result.continue, false);
    assertEquals(result.response?.status, 200);
    const body = await result.response!.text();
    assertEquals(body.includes("preview"), true);
  });

  it("continues for non-local production requests", async () => {
    const handler = new DevFileHandler();
    const encodedPath = base64urlEncode("app/page.tsx");
    const req = new Request(`http://localhost/_veryfront/fs/${encodedPath}.js`);
    const ctx = makeCtx({
      isLocalProject: false,
      requestContext: { mode: "production" } as HandlerContext["requestContext"],
    });

    const result = await handler.handle(req, ctx);

    assertEquals(result.continue, true);
  });
  },
);
