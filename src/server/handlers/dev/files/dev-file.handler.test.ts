import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/transforms/plugins/__tests__/code-parser-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { base64urlEncode } from "#veryfront/utils/base64url.ts";
import type { HandlerContext } from "../../types.ts";
import { DevFileHandler } from "./dev-file.handler.ts";
import {
  clearReactVersionCache,
  type DependencyPinningSnapshot,
  getDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { createHandlerDependencyPinningSource } from "#veryfront/server/handlers/utils/dependency-pinning-source.ts";

const originalPinningFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);

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

async function writePackageDependencies(
  projectDir: string,
  dependencies: Record<string, string>,
  modifiedAt: Date,
): Promise<void> {
  const packageJsonPath = `${projectDir}/package.json`;
  await Deno.writeTextFile(packageJsonPath, JSON.stringify({ dependencies }));
  await Deno.utime(packageJsonPath, modifiedAt, modifiedAt);
}

describe("server/handlers/dev/files/dev-file.handler", () => {
  beforeEach(() => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "");
    clearReactVersionCache();
  });

  afterEach(async () => {
    const esbuild = await import("veryfront/extensions/bundler");
    await esbuild.stop();
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalPinningFlag ?? "");
    clearReactVersionCache();
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

  it("passes remembered snapshot A to the bundler after the project moves to B", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    const projectDir = await Deno.makeTempDir({ prefix: "vf-dev-file-pins-" });

    try {
      const adapter = createMockAdapter();
      const modulePath = `${projectDir}/app/page.tsx`;
      adapter.fs.files.set(modulePath, "export default function Page() { return null; }");
      const configA: VeryfrontConfig = {
        client: { cdn: { versions: { react: "18.3.1" } } },
      };
      const configB: VeryfrontConfig = {
        client: { cdn: { versions: { react: "19.1.1" } } },
      };
      const ctx = makeCtx({
        projectDir,
        adapter,
        isLocalProject: true,
        projectId: "project-a",
        releaseId: "release-a",
        config: configA,
      });

      await writePackageDependencies(
        projectDir,
        { lodash: "4.17.20", react: "18.2.0" },
        new Date("2026-01-01T00:00:00.000Z"),
      );
      const snapshotA = await getDependencyPinningSnapshot(
        createHandlerDependencyPinningSource(ctx),
      );

      ctx.config = configB;
      await writePackageDependencies(
        projectDir,
        { lodash: "4.17.21", react: "19.0.0" },
        new Date("2026-01-02T00:00:00.000Z"),
      );
      const snapshotB = await getDependencyPinningSnapshot(
        createHandlerDependencyPinningSource(ctx),
      );
      assertEquals(snapshotA.cacheKey === snapshotB.cacheKey, false);

      let bundledSnapshot: DependencyPinningSnapshot | undefined;
      let bundledOrigin: string | undefined;
      const handler = new DevFileHandler(
        (_absPath, _ctx, dependencySnapshot, _dependencySource, moduleServerOrigin) => {
          bundledSnapshot = dependencySnapshot;
          bundledOrigin = moduleServerOrigin;
          return Promise.resolve("export default 'snapshot-a';");
        },
      );
      const encodedPath = base64urlEncode("app/page.tsx");
      const result = await handler.handle(
        new Request(
          `http://localhost/_veryfront/fs/${encodedPath}.js?pins=${
            encodeURIComponent(snapshotA.cacheKey)
          }`,
        ),
        ctx,
      );

      assertEquals(result.response?.status, 200);
      assertEquals(bundledSnapshot?.cacheKey, snapshotA.cacheKey);
      assertEquals(bundledSnapshot?.dependencies, {
        lodash: "4.17.20",
        react: "18.3.1",
      });
      assertEquals(bundledSnapshot?.configuredVersions?.react, {
        declaration: "18.3.1",
        effective: "18.3.1",
      });
      assertEquals(bundledOrigin, "http://localhost");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects missing, malformed, duplicate, unknown, and on:unknown pins", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    const projectDir = await Deno.makeTempDir({ prefix: "vf-dev-file-conflict-" });

    try {
      const adapter = createMockAdapter();
      const modulePath = `${projectDir}/app/page.tsx`;
      adapter.fs.files.set(modulePath, "export default function Page() { return null; }");
      const ctx = makeCtx({
        projectDir,
        adapter,
        isLocalProject: true,
        projectId: "project-a",
        releaseId: "release-a",
      });
      await writePackageDependencies(
        projectDir,
        { lodash: "4.17.20" },
        new Date("2026-01-01T00:00:00.000Z"),
      );
      const current = await getDependencyPinningSnapshot(
        createHandlerDependencyPinningSource(ctx),
      );
      let bundleCalls = 0;
      const handler = new DevFileHandler(() => {
        bundleCalls++;
        return Promise.resolve("export default null;");
      });
      const encodedPath = base64urlEncode("app/page.tsx");

      for (
        const [label, query] of [
          ["missing", ""],
          ["malformed", "?pins=off"],
          ["duplicate", `?pins=${current.cacheKey}&pins=${current.cacheKey}`],
          ["unknown", "?pins=on%3Anot-remembered"],
          ["on:unknown", "?pins=on%3Aunknown"],
        ]
      ) {
        const result = await handler.handle(
          new Request(`http://localhost/_veryfront/fs/${encodedPath}.js${query}`),
          ctx,
        );

        assertEquals(result.response?.status, 409, label);
        assertEquals(result.response?.headers.get("cache-control"), "no-store", label);
      }

      assertEquals(bundleCalls, 0);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
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
});
