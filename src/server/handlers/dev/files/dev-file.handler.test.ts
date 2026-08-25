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
import {
  DEPENDENCY_PINS_HEADER,
  SNAPSHOT_CONFLICT_BODY,
} from "#veryfront/server/handlers/utils/dependency-snapshot-protocol.ts";
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";

const originalPinningFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);

function createLoopbackRequest(input: string | URL, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("host", new URL(input).host);
  const request = new Request(input, { ...init, headers });
  recordRequestPeerFromTransport(request, {
    runtime: "deno",
    transport: "tcp",
    hostname: "127.0.0.1",
  });
  return request;
}

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
    const req = createLoopbackRequest(`http://localhost/_veryfront/fs/${encodedPath}.js`);
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

  it("binds contextual filesystem reads to the request token, branch, and non-production mode", async () => {
    const handler = new DevFileHandler(() => Promise.resolve("export default 'bound';"));
    const tokens: string[] = [];
    const branches: (string | null)[] = [];
    const modes: [boolean, string | undefined][] = [];
    const mock = createMockAdapter();
    mock.fs.files.set("/project/app/page.tsx", "export default function Page() { return null; }");
    const adapter = {
      ...mock,
      fs: {
        ...mock.fs,
        isVeryfrontAdapter: () => true,
        getUnderlyingAdapter: () => ({}),
        isMultiProjectMode: () => true,
        isContextualMode: () => true,
        setRequestToken: (token: string) => {
          tokens.push(token);
        },
        setRequestBranch: (branch: string | null) => {
          branches.push(branch);
        },
        setProductionMode: (production: boolean, releaseId?: string) => {
          modes.push([production, releaseId]);
        },
      },
    } as unknown as HandlerContext["adapter"];

    const encodedPath = base64urlEncode("app/page.tsx");
    const req = createLoopbackRequest(`http://localhost/_veryfront/fs/${encodedPath}.js`);
    const ctx = makeCtx({
      adapter,
      isLocalProject: true,
      proxyToken: "req-token",
      releaseId: "rel-1",
      parsedDomain: { branch: "feature" } as HandlerContext["parsedDomain"],
    });

    const result = await handler.handle(req, ctx);

    assertEquals(result.response?.status, 200);
    assertEquals(tokens, ["req-token"], "the dev file read must be bound to the request token");
    assertEquals(branches, ["feature"], "the dev file read must be bound to the request branch");
    assertEquals(
      modes,
      [[false, "rel-1"]],
      "dev file reads must never use the production snapshot",
    );
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
    const req = createLoopbackRequest(`http://localhost/_veryfront/fs/${encodedPath}.js`);
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
    const req = createLoopbackRequest(`http://localhost/_veryfront/fs/${encodedPath}.js`);
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
        createLoopbackRequest(
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

  it("rejects invalid pin requests with the canonical snapshot conflict", async () => {
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
        securityConfig: { cors: true } as HandlerContext["securityConfig"],
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
          createLoopbackRequest(`http://localhost/_veryfront/fs/${encodedPath}.js${query}`, {
            headers: { origin: "https://example.test" },
          }),
          ctx,
        );

        assertEquals(result.response?.status, 409, label);
        assertEquals(await result.response?.text(), "Unknown dependency snapshot", label);
        assertEquals(result.response?.headers.get("cache-control"), "no-store", label);
        assertEquals(
          result.response?.headers.get("vary")?.toLowerCase().includes(DEPENDENCY_PINS_HEADER),
          true,
          label,
        );
        assertEquals(
          result.response?.headers.get("access-control-allow-origin"),
          "https://example.test",
          label,
        );
        assertEquals(result.response?.headers.get("x-content-type-options"), "nosniff", label);
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
    const req = createLoopbackRequest(`http://localhost/_veryfront/fs/${encodedPath}.js`);
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
    const req = createLoopbackRequest(`http://localhost/_veryfront/fs/${encodedPath}.js`);
    const ctx = makeCtx({
      isLocalProject: false,
      requestContext: { mode: "production" } as HandlerContext["requestContext"],
    });

    const result = await handler.handle(req, ctx);

    assertEquals(result.continue, true);
  });
});

describe("server/handlers/dev/files/dev-file.handler operational failures", () => {
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

  function snapshotProbeConfig(events: string[]): VeryfrontConfig {
    const config = {} as VeryfrontConfig;
    Object.defineProperty(config, "react", {
      get() {
        events.push("snapshot");
        return undefined;
      },
    });
    return config;
  }

  function devFileRequest(): Request {
    const encodedPath = base64urlEncode("app/page.tsx");
    return createLoopbackRequest(`http://localhost/_veryfront/fs/${encodedPath}.js`);
  }

  it("returns the existing 404 for canonical stat absence before snapshot or bundling", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    const events: string[] = [];
    const adapter = createMockAdapter();
    adapter.fs.stat = () => Promise.reject(new Deno.errors.NotFound("missing dev file"));
    const ctx = makeCtx({
      adapter,
      config: snapshotProbeConfig(events),
      isLocalProject: true,
    });
    const handler = new DevFileHandler(() => {
      events.push("bundle");
      return Promise.resolve("export default null;");
    });

    const result = await handler.handle(devFileRequest(), ctx);

    assertEquals(result.continue, false);
    assertEquals(result.response?.status, 404);
    assertEquals(result.response?.headers.get("cache-control"), "no-store");
    assertEquals(await result.response?.text(), "export default null; // File not found");
    assertEquals(events, []);
  });

  for (
    const [label, failure] of [
      [
        "a NotFound-named lookalike",
        Object.assign(new Error("not actually absent"), { name: "NotFound" }),
      ],
      ["an EACCES failure", Object.assign(new Error("access denied"), { code: "EACCES" })],
      ["an EIO failure", Object.assign(new Error("I/O failure"), { code: "EIO" })],
      ["an arbitrary failure", new Error("stat unavailable")],
      ["a plain ENOENT-shaped rejection", Object.freeze({ code: "ENOENT" })],
    ] as const
  ) {
    it(`fails closed on ${label} from stat before snapshot or bundling`, async () => {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      const events: string[] = [];
      const adapter = createMockAdapter();
      adapter.fs.stat = () => Promise.reject(failure);
      const ctx = makeCtx({
        adapter,
        config: snapshotProbeConfig(events),
        isLocalProject: true,
      });
      const handler = new DevFileHandler(() => {
        events.push("bundle");
        return Promise.resolve("export default null;");
      });

      const result = await handler.handle(devFileRequest(), ctx);

      assertEquals(result.continue, false);
      assertEquals(result.response?.status, 404);
      assertEquals(result.response?.headers.get("cache-control"), "no-store");
      assertEquals(
        await result.response?.text(),
        "export default null; // File not accessible",
      );
      assertEquals(events, []);
    });
  }

  it("fails closed on a hostile stat rejection without hooks, snapshot, or bundling", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    const failure = new Proxy({}, {
      get() {
        throw new Error("stat rejection must not be read");
      },
      getPrototypeOf() {
        throw new Error("stat rejection prototype must not escape");
      },
    });
    const events: string[] = [];
    const adapter = createMockAdapter();
    adapter.fs.stat = () => Promise.reject(failure);
    const ctx = makeCtx({
      adapter,
      config: snapshotProbeConfig(events),
      isLocalProject: true,
    });
    const handler = new DevFileHandler(() => {
      events.push("bundle");
      return Promise.resolve("export default null;");
    });

    const result = await handler.handle(devFileRequest(), ctx);

    assertEquals(result.continue, false);
    assertEquals(result.response?.status, 404);
    assertEquals(
      await result.response?.text(),
      "export default null; // File not accessible",
    );
    assertEquals(events, []);
  });

  it("keeps snapshot resolution failures out of the snapshot conflict protocol", async () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    const projectDir = await Deno.makeTempDir({ prefix: "vf-dev-file-resolve-failure-" });

    try {
      await Deno.writeTextFile(
        `${projectDir}/package.json`,
        JSON.stringify({ dependencies: { react: "18.3.1" } }),
      );
      const adapter = createMockAdapter();
      const modulePath = `${projectDir}/app/page.tsx`;
      adapter.fs.files.set(modulePath, "export default null;");
      const config = {} as VeryfrontConfig;
      Object.defineProperty(config, "react", {
        get(): never {
          throw new Error("snapshot resolution unavailable");
        },
      });
      const ctx = makeCtx({ projectDir, adapter, config, isLocalProject: true });
      let bundleCalls = 0;
      const handler = new DevFileHandler(() => {
        bundleCalls++;
        return Promise.resolve("export default null;");
      });
      const encodedPath = base64urlEncode("app/page.tsx");

      const result = await handler.handle(
        createLoopbackRequest(`http://localhost/_veryfront/fs/${encodedPath}.js`),
        ctx,
      );

      assertEquals(result.continue, false);
      assertEquals(result.response?.status, 500);
      assertEquals(bundleCalls, 0);
      assertEquals(result.response?.headers.get("cache-control"), "no-store");
      assertEquals(result.response?.headers.get("content-type"), "application/javascript");
      const body = await result.response!.text();
      assertEquals(body, "export default null; // Build error: snapshot resolution unavailable");
      assertEquals(body === SNAPSHOT_CONFLICT_BODY, false);
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("keeps bundler rejections out of the snapshot conflict protocol", async () => {
    const adapter = createMockAdapter();
    const modulePath = "/project/app/page.tsx";
    adapter.fs.files.set(modulePath, "export default null;");
    const ctx = makeCtx({ adapter, isLocalProject: true });
    let bundleCalls = 0;
    const handler = new DevFileHandler(() => {
      bundleCalls++;
      return Promise.reject(new Error("bundler unavailable"));
    });
    const encodedPath = base64urlEncode("app/page.tsx");

    const result = await handler.handle(
      createLoopbackRequest(`http://localhost/_veryfront/fs/${encodedPath}.js`),
      ctx,
    );

    assertEquals(result.continue, false);
    assertEquals(result.response?.status, 500);
    assertEquals(bundleCalls, 1);
    assertEquals(result.response?.headers.get("cache-control"), "no-store");
    assertEquals(result.response?.headers.get("content-type"), "application/javascript");
    const body = await result.response!.text();
    assertEquals(body, "export default null; // Build error: bundler unavailable");
    assertEquals(body === SNAPSHOT_CONFLICT_BODY, false);
  });
});
