import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/plugins/__tests__/code-parser-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { base64urlEncode } from "#veryfront/utils/base64url.ts";
import type { HandlerContext } from "../../types.ts";
import { DevFileHandler } from "./dev-file.handler.ts";

function getImportSpecifiers(source: string): string[] {
  return [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((specifier): specifier is string => specifier !== undefined);
}

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/project",
    adapter: createMockAdapter(),
    securityConfig: null,
    cspUserHeader: null,
    isLocalProject: true,
    ...overrides,
  } as HandlerContext;
}

describe("server/handlers/dev/files/dev-file.handler", () => {
  afterEach(async () => {
    const esbuild = await import("veryfront/extensions/bundler");
    await esbuild.stop();
  });

  it("serves file modules for local projects", async () => {
    const handler = new DevFileHandler();
    const adapter = createMockAdapter();
    const modulePath = "/project/app/page.tsx";
    adapter.fs.files.set(
      modulePath,
      "export default function Page() { return 'local'; }",
    );

    const encodedPath = base64urlEncode("app/page.tsx");
    const req = new Request(`http://localhost/_veryfront/fs/${encodedPath}.js`);
    const ctx = makeCtx({
      adapter,
      isLocalProject: true,
    });

    const result = await handler.handle(req, ctx);

    assertEquals(result.continue, false);
    assertEquals(result.response?.status, 200);
    assertEquals(result.response?.headers.get("cache-control"), "no-store");
    assertEquals(result.response?.headers.get("x-content-type-options"), "nosniff");
    const body = await result.response!.text();
    assertEquals(body.includes("local"), true);
  });

  it("keeps browser import-map exact specifiers in local bundles", async () => {
    const handler = new DevFileHandler();
    const adapter = createMockAdapter();
    const modulePath = "/project/app/page.tsx";
    adapter.fs.files.set(
      modulePath,
      [
        '"use client";',
        'import { Chat } from "veryfront/chat";',
        "export default function Page() {",
        '  return Chat ? "local-chat" : "missing";',
        "}",
      ].join("\n"),
    );

    const encodedPath = base64urlEncode("app/page.tsx");
    const req = new Request(`http://localhost/_veryfront/fs/${encodedPath}.js`);
    const ctx = makeCtx({
      adapter,
      isLocalProject: true,
    });

    const result = await handler.handle(req, ctx);

    assertEquals(result.continue, false);
    assertEquals(result.response?.status, 200);
    const body = await result.response!.text();
    const specifiers = getImportSpecifiers(body);
    assertEquals(specifiers.includes("veryfront/chat"), true);
    assertEquals(specifiers.some((specifier) => specifier.includes("esm.sh")), false);
  });

  it("keeps browser import-map prefix specifiers in local bundles", async () => {
    const handler = new DevFileHandler();
    const adapter = createMockAdapter();
    const modulePath = "/project/app/page.tsx";
    adapter.fs.files.set(
      modulePath,
      [
        '"use client";',
        'import Button from "@/components/Button";',
        "export default function Page() {",
        "  return Button;",
        "}",
      ].join("\n"),
    );

    const encodedPath = base64urlEncode("app/page.tsx");
    const req = new Request(`http://localhost/_veryfront/fs/${encodedPath}.js`);
    const ctx = makeCtx({
      adapter,
      isLocalProject: true,
    });

    const result = await handler.handle(req, ctx);

    assertEquals(result.continue, false);
    assertEquals(result.response?.status, 200);
    const body = await result.response!.text();
    const specifiers = getImportSpecifiers(body);
    assertEquals(specifiers.includes("@/components/Button"), true);
    assertEquals(specifiers.some((specifier) => specifier.includes("esm.sh")), false);
  });

  it("does NOT serve when only preview mode is set (VULN-SRV-1/2)", async () => {
    // Remote preview (isLocalProject=false) must never expose project source
    // via /_veryfront/fs/, even if requestContext.mode is somehow "preview".
    const handler = new DevFileHandler();
    const adapter = createMockAdapter();
    const modulePath = "/project/app/page.tsx";
    adapter.fs.files.set(
      modulePath,
      "export default function Page() { return 'leak'; }",
    );

    const encodedPath = base64urlEncode("app/page.tsx");
    const req = new Request(`http://localhost/_veryfront/fs/${encodedPath}.js`);
    const ctx = makeCtx({
      adapter,
      isLocalProject: false,
      requestContext: { mode: "preview" } as HandlerContext["requestContext"],
    });

    // Enabled gate must be false in preview-only (non-local) context.
    const enabled = handler.metadata.enabled?.(ctx) ?? true;
    assertEquals(enabled, false);

    // Even if called directly, handler must continue (not serve).
    const result = await handler.handle(req, ctx);
    assertEquals(result.continue, true);
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

  for (const pathname of ["/_veryfront/fs/encoded.js"]) {
    it(`rejects non-loopback access to ${pathname}`, async () => {
      const result = await new DevFileHandler().handle(
        new Request(`http://devbox.example${pathname}`),
        makeCtx(),
      );

      assertExists(result.response);
      assertEquals(result.response.status, 401);
      assertEquals(result.response.headers.get("cache-control"), "no-store");
      assertEquals(result.response.headers.get("x-content-type-options"), "nosniff");
    });

    it(`rejects cross-origin browser access to ${pathname}`, async () => {
      const result = await new DevFileHandler().handle(
        new Request(`http://localhost:3000${pathname}`, {
          headers: { origin: "http://127.0.0.1:4000" },
        }),
        makeCtx(),
      );

      assertExists(result.response);
      assertEquals(result.response.status, 401);
    });
  }

  it("returns 405 for a non-GET request to the file route", async () => {
    const encodedPath = base64urlEncode("app/page.tsx");
    const result = await new DevFileHandler().handle(
      new Request(`http://localhost/_veryfront/fs/${encodedPath}.js`, { method: "POST" }),
      makeCtx(),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 405);
    assertEquals(result.response.headers.get("allow"), "GET");
  });

  it("returns a generic 404 for traversal without reading outside the project", async () => {
    const adapter = createMockAdapter();
    let outsideReads = 0;
    const readFile = adapter.fs.readFile;
    adapter.fs.readFile = (path) => {
      if (!path.startsWith("/project/")) outsideReads++;
      return readFile(path);
    };
    const encodedPath = base64urlEncode("src/../../../private/secret.ts");

    const result = await new DevFileHandler().handle(
      new Request(`http://localhost/_veryfront/fs/${encodedPath}.js`),
      makeCtx({ adapter }),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 404);
    assertEquals(await result.response.text(), "export default null; // Module not found");
    assertEquals(outsideReads, 0);
  });

  it("rejects a symlink whose canonical target escapes the project", async () => {
    const adapter = createMockAdapter();
    const modulePath = "/project/app/link.ts";
    adapter.fs.files.set(modulePath, "export default 'private';");
    adapter.fs.realPath = (path) =>
      Promise.resolve(path === modulePath ? "/private/secret.ts" : path);
    const encodedPath = base64urlEncode("app/link.ts");

    const result = await new DevFileHandler().handle(
      new Request(`http://localhost/_veryfront/fs/${encodedPath}.js`),
      makeCtx({ adapter }),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 404);
    assertEquals((await result.response.text()).includes("/private/"), false);
  });

  it("distinguishes unavailable file metadata from a missing module", async () => {
    const adapter = createMockAdapter();
    adapter.fs.realPath = (path) => Promise.resolve(path);
    adapter.fs.stat = () =>
      Promise.reject(new Deno.errors.PermissionDenied("denied at /private/project"));
    const encodedPath = base64urlEncode("app/page.tsx");

    const result = await new DevFileHandler().handle(
      new Request(`http://localhost/_veryfront/fs/${encodedPath}.js`),
      makeCtx({ adapter }),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 500);
    const body = await result.response.text();
    assertEquals(body, "export default null; // Module unavailable");
    assertEquals(body.includes("private"), false);
  });

  it("does not expose source, absolute paths, or transform errors", async () => {
    const adapter = createMockAdapter();
    const modulePath = "/project/app/broken.ts";
    const sourceMarker = "PRIVATE_SOURCE_MARKER";
    adapter.fs.files.set(modulePath, `export default ??? ${sourceMarker}`);
    const encodedPath = base64urlEncode("app/broken.ts");

    const result = await new DevFileHandler().handle(
      new Request(`http://localhost/_veryfront/fs/${encodedPath}.js`),
      makeCtx({ adapter, debug: true }),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 500);
    const body = await result.response.text();
    assertEquals(body, "export default null; // Module build failed");
    assertEquals(body.includes(modulePath), false);
    assertEquals(body.includes(sourceMarker), false);
  });
});
