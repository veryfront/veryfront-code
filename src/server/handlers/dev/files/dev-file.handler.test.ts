import { assertEquals } from "#veryfront/testing/assert.ts";
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

  },
);
