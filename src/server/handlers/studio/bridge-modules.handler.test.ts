import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  isLocalStudioBridgeDevelopment,
  resolveStudioBridgeBundle,
  selectStudioBridgeBundleMode,
  StudioBridgeModulesHandler,
} from "./bridge-modules.handler.ts";
import type { HandlerContext } from "../types.ts";
import { buildStudioBridgeBundle } from "../../../../scripts/build/prebundle-bridge.ts";

function makeContext(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: ".",
    adapter: {} as HandlerContext["adapter"],
    securityConfig: null,
    cspUserHeader: null,
    resolvedEnvironment: "production",
    isLocalProject: false,
    ...overrides,
  };
}

describe("resolveStudioBridgeBundle", () => {
  it("uses the embedded artifact in packaged non-compiled runtimes", () => {
    assertEquals(
      selectStudioBridgeBundleMode({
        compiled: false,
        sourceAvailable: false,
        localDevelopment: true,
      }),
      "prebuilt",
    );
    assertEquals(
      selectStudioBridgeBundleMode({
        compiled: false,
        sourceAvailable: true,
        localDevelopment: true,
      }),
      "source",
    );
    assertEquals(
      selectStudioBridgeBundleMode({
        compiled: false,
        sourceAvailable: true,
        localDevelopment: false,
      }),
      "prebuilt",
    );
    assertEquals(
      selectStudioBridgeBundleMode({
        compiled: true,
        sourceAvailable: true,
        localDevelopment: true,
      }),
      "prebuilt",
    );
  });

  it("enables source builds only for local non-production requests", () => {
    assertEquals(isLocalStudioBridgeDevelopment({ isLocalProject: true }), true);
    assertEquals(
      isLocalStudioBridgeDevelopment({ isLocalProject: true, resolvedEnvironment: "preview" }),
      true,
    );
    assertEquals(
      isLocalStudioBridgeDevelopment({ isLocalProject: false, resolvedEnvironment: "preview" }),
      false,
    );
    assertEquals(
      isLocalStudioBridgeDevelopment({ isLocalProject: true, resolvedEnvironment: "production" }),
      false,
    );
    assertEquals(
      isLocalStudioBridgeDevelopment({
        isLocalProject: true,
        config: { fs: { veryfront: { productionMode: true } } },
      }),
      false,
    );
  });

  it("reads current coordinator source for every source-runtime build", async () => {
    let coordinatorSource = "first coordinator";
    let reads = 0;
    const dependencies = {
      prebuiltBundle: "stale prebuilt bundle",
      readCoordinator: () => {
        reads += 1;
        return Promise.resolve(coordinatorSource);
      },
      buildSource: (source: string) => Promise.resolve(`built:${source}`),
    };

    assertEquals(
      await resolveStudioBridgeBundle("source", dependencies),
      "built:first coordinator",
    );

    coordinatorSource = "updated coordinator";
    assertEquals(
      await resolveStudioBridgeBundle("source", dependencies),
      "built:updated coordinator",
    );
    assertEquals(reads, 2);
  });

  it("uses only the embedded artifact in compiled runtimes", async () => {
    let sourceRead = false;
    const result = await resolveStudioBridgeBundle("prebuilt", {
      prebuiltBundle: "compiled bundle",
      readCoordinator: () => {
        sourceRead = true;
        return Promise.resolve("source bundle");
      },
      buildSource: () => Promise.resolve("built source bundle"),
    });

    assertEquals(result, "compiled bundle");
    assertEquals(sourceRead, false);
  });

  it("fails closed when a compiled artifact is missing", async () => {
    await assertRejects(
      () =>
        resolveStudioBridgeBundle("prebuilt", {
          prebuiltBundle: "",
          readCoordinator: () => Promise.resolve("source bundle"),
          buildSource: () => Promise.resolve("built source bundle"),
        }),
      Error,
      "prebuilt Studio bridge bundle is unavailable",
    );
  });

  it("rejects empty source-runtime build output", async () => {
    await assertRejects(
      () =>
        resolveStudioBridgeBundle("source", {
          prebuiltBundle: "compiled bundle",
          readCoordinator: () => Promise.resolve("source bundle"),
          buildSource: () => Promise.resolve(""),
        }),
      Error,
      "Studio bridge bundler produced no JavaScript",
    );
  });

  it("rejects oversized source and bundle output", async () => {
    await assertRejects(
      () =>
        resolveStudioBridgeBundle("source", {
          prebuiltBundle: "compiled bundle",
          readCoordinator: () => Promise.resolve("x".repeat(1_048_577)),
          buildSource: () => Promise.resolve("unreachable"),
        }),
      Error,
      "Studio bridge source exceeds the size limit",
    );
    await assertRejects(
      () =>
        resolveStudioBridgeBundle("source", {
          prebuiltBundle: "compiled bundle",
          readCoordinator: () => Promise.resolve("source bundle"),
          buildSource: () => Promise.resolve("x".repeat(4_194_305)),
        }),
      Error,
      "Studio bridge bundle exceeds the size limit",
    );
  });
});

describe("StudioBridgeModulesHandler", () => {
  it("serves the embedded bundle and honors its ETag", async () => {
    const handler = new StudioBridgeModulesHandler();
    const request = new Request("http://localhost/_veryfront/studio-bridge.js");
    const first = await handler.handle(request, makeContext());
    const response = first.response;

    assertEquals(first.continue, false);
    assertEquals(response?.status, 200);
    assertEquals(response?.headers.get("content-type"), "application/javascript; charset=utf-8");
    assertEquals(response?.headers.get("cache-control"), "no-cache");
    assertEquals(response?.headers.get("x-content-type-options"), "nosniff");
    assertEquals((await response?.text())?.length! > 0, true);

    const etag = response?.headers.get("etag");
    assertEquals(typeof etag, "string");
    const second = await handler.handle(
      new Request(request, { headers: { "if-none-match": etag! } }),
      makeContext(),
    );
    assertEquals(second.response?.status, 304);
    assertEquals(second.response?.headers.get("etag"), etag);
    assertEquals(second.response?.headers.get("cache-control"), "no-cache");
    assertEquals(await second.response?.text(), "");
  });

  it("honors strong, weak, listed, and wildcard If-None-Match validators", async () => {
    const handler = new StudioBridgeModulesHandler(() =>
      Promise.resolve({ js: "bridge source", etag: "current" })
    );
    const url = "http://localhost/_veryfront/studio-bridge.js";

    for (const method of ["GET", "HEAD"]) {
      for (
        const ifNoneMatch of [
          '"current"',
          'W/"current"',
          '"stale", "current"',
          'W/"stale", W/"current"',
          "*",
        ]
      ) {
        const result = await handler.handle(
          new Request(url, { method, headers: { "if-none-match": ifNoneMatch } }),
          makeContext(),
        );

        assertEquals(result.response?.status, 304, `${method} ${ifNoneMatch}`);
        assertEquals(result.response?.headers.get("etag"), '"current"');
      }
    }
  });

  it("handles only GET and HEAD and keeps successful HEAD responses bodyless", async () => {
    let loads = 0;
    const handler = new StudioBridgeModulesHandler(() => {
      loads += 1;
      return Promise.resolve({ js: "bridge source", etag: "current" });
    });
    const url = "http://localhost/_veryfront/studio-bridge.js";

    for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
      assertEquals(
        await handler.handle(new Request(url, { method }), makeContext()),
        { continue: true },
      );
    }
    assertEquals(loads, 0);

    const result = await handler.handle(new Request(url, { method: "HEAD" }), makeContext());
    assertEquals(result.response?.status, 200);
    assertEquals(
      result.response?.headers.get("content-type"),
      "application/javascript; charset=utf-8",
    );
    assertEquals(result.response?.headers.get("etag"), '"current"');
    assertEquals(await result.response?.text(), "");
    assertEquals(loads, 1);
  });

  it("ignores malformed and nonmatching If-None-Match validators", async () => {
    const handler = new StudioBridgeModulesHandler(() =>
      Promise.resolve({ js: "bridge source", etag: "current" })
    );
    const url = "http://localhost/_veryfront/studio-bridge.js";

    for (
      const ifNoneMatch of [
        '"stale"',
        'W/"stale"',
        "current",
        '"current',
        '"current", invalid',
        '*, "current"',
        'w/"current"',
        '"current" trailing',
      ]
    ) {
      const result = await handler.handle(
        new Request(url, { headers: { "if-none-match": ifNoneMatch } }),
        makeContext(),
      );

      assertEquals(result.response?.status, 200, ifNoneMatch);
      assertEquals(await result.response?.text(), "bridge source");
    }
  });

  it("builds cwd-independent source output identical to the release builder", async () => {
    const previousWorkingDirectory = Deno.cwd();
    const temporaryDirectory = await Deno.makeTempDir();
    try {
      Deno.chdir(temporaryDirectory);
      const result = await new StudioBridgeModulesHandler().handle(
        new Request("http://localhost/_veryfront/studio-bridge.js"),
        makeContext({ isLocalProject: true, resolvedEnvironment: "preview" }),
      );
      const body = await result.response?.text();

      assertEquals(result.response?.status, 200);
      assertEquals(body, await buildStudioBridgeBundle());
      assertEquals(body?.includes(previousWorkingDirectory), false);
      assertEquals(body?.includes(temporaryDirectory), false);
    } finally {
      Deno.chdir(previousWorkingDirectory);
      const { stop: stopBundler } = await import("veryfront/extensions/bundler");
      await stopBundler();
      await Deno.remove(temporaryDirectory);
    }
  });

  it("continues for unrelated routes", async () => {
    const result = await new StudioBridgeModulesHandler().handle(
      new Request("http://localhost/other.js"),
      makeContext(),
    );

    assertEquals(result, { continue: true });
  });

  it("returns a generic JavaScript error without exposing bundler details", async () => {
    const handler = new StudioBridgeModulesHandler(() =>
      Promise.reject(new Error("Bundler failed with authorization: Bearer <TOKEN>"))
    );
    const result = await handler.handle(
      new Request("http://localhost/_veryfront/studio-bridge.js"),
      makeContext(),
    );
    const body = await result.response?.text();

    assertEquals(result.response?.status, 500);
    assertEquals(
      result.response?.headers.get("content-type"),
      "application/javascript; charset=utf-8",
    );
    assertEquals(body, "// Studio bridge bundle is unavailable");
    assertEquals(body?.includes("<TOKEN>"), false);
  });
});
