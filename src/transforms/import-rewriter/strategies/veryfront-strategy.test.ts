import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertInstanceOf } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "../../../release-assets/constants.ts";
import {
  _clearNpmVersionCache,
  _pendingResolutions,
  _setDependencyResolutionPosterForTest,
} from "#veryfront/transforms/esm/npm-registry-client.ts";
import {
  clearReactVersionCache,
  type DependencyPinningSource,
  getDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import type { ImportSpecifierInfo, RewriteContext } from "../types.ts";
import { VeryfrontStrategy } from "./veryfront-strategy.ts";
import { VeryfrontError } from "#veryfront/errors";

function makeCtx(overrides: Partial<RewriteContext> = {}): RewriteContext {
  return {
    filePath: "/project/pages/index.tsx",
    projectDir: "/project",
    projectId: "test",
    target: "browser",
    dev: false,
    reactVersion: "19.1.1",
    ...overrides,
  };
}

function makeInfo(specifier: string): ImportSpecifierInfo {
  return {
    specifier,
    isDynamic: false,
    start: 0,
    end: 0,
    statementStart: 0,
    statementEnd: 0,
    raw: {} as ImportSpecifierInfo["raw"],
  };
}

let authorizedSourceSequence = 0;

async function makeAuthorizedContext(
  dependencies: Readonly<Record<string, string>>,
): Promise<RewriteContext> {
  const content = JSON.stringify({ dependencies });
  const source: DependencyPinningSource = {
    projectDir: "/project",
    cacheNamespace: `veryfront-strategy-${++authorizedSourceSequence}`,
    dependencyWritebackTarget: { kind: "main" },
    fs: {
      readFile: () => Promise.resolve(content),
      stat: () =>
        Promise.resolve({
          size: content.length,
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          mtime: new Date(1_000),
        }),
    },
  };
  const snapshot = await getDependencyPinningSnapshot(source);
  return makeCtx({
    dependencyPinningSource: source,
    dependencyPinningCacheKey: snapshot.cacheKey,
    dependencyPinningDependencies: snapshot.dependencies,
  });
}

describe("VeryfrontStrategy", () => {
  const strategy = new VeryfrontStrategy();

  describe("matches", () => {
    it("should match veryfront/*", () => {
      assertEquals(strategy.matches("veryfront/head", makeCtx()), true);
      assertEquals(strategy.matches("veryfront/workflow", makeCtx()), true);
    });

    it("should match #veryfront/*", () => {
      assertEquals(strategy.matches("#veryfront/utils", makeCtx()), true);
    });

    it("should match bare veryfront", () => {
      assertEquals(strategy.matches("veryfront", makeCtx()), true);
    });

    it("should match #deno-config", () => {
      assertEquals(strategy.matches("#deno-config", makeCtx()), true);
    });

    it("should not match other specifiers", () => {
      assertEquals(strategy.matches("react", makeCtx()), false);
      assertEquals(strategy.matches("lodash", makeCtx()), false);
    });
  });

  describe("lightweight barrel overrides", () => {
    it("should redirect veryfront/workflow to React-only submodule for SSR", () => {
      const result = strategy.rewrite(
        makeInfo("veryfront/workflow"),
        makeCtx({ target: "ssr" }),
      );
      assert(result.specifier !== null, "specifier should not be null");
      assert(
        result.specifier!.includes("/workflow/react/index.js"),
        `Expected workflow/react/index.js in SSR, got: ${result.specifier}`,
      );
      assert(
        result.specifier!.includes("?ssr=true"),
        `Expected ?ssr=true param, got: ${result.specifier}`,
      );
    });

    it("should redirect veryfront/workflow to React-only submodule for browser hydration", () => {
      const result = strategy.rewrite(
        makeInfo("veryfront/workflow"),
        makeCtx({ target: "browser" }),
      );
      assert(result.specifier !== null, "specifier should not be null");
      assert(
        result.specifier!.includes("/workflow/react/index.js"),
        `Expected workflow/react/index.js in browser, got: ${result.specifier}`,
      );
    });

    it("should redirect the root veryfront barrel to the client-safe barrel for browser", () => {
      // Regression: the full root barrel re-exports `#veryfront/server`, which
      // pulls `server/production-server.ts` (module top-level await) into client
      // chunks — it 500s on the es2020 browser target and aborts hydration. A
      // *used* value import (`import { getEnv } from "veryfront"`) is not
      // dead-stripped, so the barrel must resolve to the server-free mirror.
      const result = strategy.rewrite(
        makeInfo("veryfront"),
        makeCtx({ target: "browser" }),
      );
      assertEquals(result.specifier, "/_vf_modules/_veryfront/index.client.js");
    });

    it("should redirect the root veryfront barrel to the client-safe barrel for SSR", () => {
      const result = strategy.rewrite(
        makeInfo("veryfront"),
        makeCtx({ target: "ssr" }),
      );
      assertEquals(result.specifier, "/_vf_modules/_veryfront/index.client.js?ssr=true");
    });

    it("should preserve the captured snapshot on framework child-module URLs", () => {
      const browserResult = strategy.rewrite(
        makeInfo("veryfront"),
        makeCtx({
          target: "browser",
          dependencyPinningCacheKey: "on:snapshot-a",
        }),
      );
      const ssrResult = strategy.rewrite(
        makeInfo("veryfront"),
        makeCtx({
          target: "ssr",
          dependencyPinningCacheKey: "on:snapshot-a",
        }),
      );

      assertEquals(
        browserResult.specifier,
        "/_vf_modules/_pins/on%3Asnapshot-a/_veryfront/index.client.js",
      );
      assertEquals(
        ssrResult.specifier,
        "/_vf_modules/_veryfront/index.client.js?ssr=true&pins=on%3Asnapshot-a",
      );
    });

    it("should not apply SSR override to non-overridden modules", () => {
      const result = strategy.rewrite(
        makeInfo("veryfront/head"),
        makeCtx({ target: "ssr" }),
      );
      assert(result.specifier !== null, "specifier should not be null");
      assert(
        result.specifier!.includes("?ssr=true"),
        `Expected ?ssr=true param for SSR, got: ${result.specifier}`,
      );
      // head should resolve normally, not through override
      assert(
        !result.specifier!.includes("/workflow/"),
        `head should not resolve to workflow path, got: ${result.specifier}`,
      );
    });
  });

  describe("internal import-map resolution", () => {
    it("rejects project imports of private host capability modules", () => {
      for (
        const specifier of [
          "#veryfront/agent/hosted/internal/control-plane-mcp-source.ts",
          "#veryfront/agent/hosted/x/../internal/control-plane-mcp-source.ts",
          "#veryfront/agent/hosted/%2e%2e/hosted/internal/control-plane-mcp-source.ts",
          "#veryfront/agent/hosted%2Finternal%2Fcontrol-plane-mcp-source.ts",
          "#veryfront/agent\\hosted\\internal\\control-plane-mcp-source.ts",
          "#veryfront/agent/hosted/Internal/control-plane-mcp-source.ts",
          "#veryfront/agent/hosted/internal./control-plane-mcp-source.ts",
          "#veryfront/agent/hosted/x/..%20/internal/control-plane-mcp-source.ts",
          "#veryfront/agent/hosted/.%20/internal/control-plane-mcp-source.ts",
          "#veryfront/tool/internal/remote-mcp-transport.ts",
          "#veryfront/tool/x/../internal/remote-mcp-transport.ts",
          "#veryfront/tool/Internal/remote-mcp-transport.ts",
        ]
      ) {
        let thrown: unknown;
        try {
          strategy.rewrite(makeInfo(specifier), makeCtx({ target: "ssr" }));
        } catch (error) {
          thrown = error;
        }
        assertInstanceOf(thrown, VeryfrontError);
        assertEquals(thrown.slug, "security-violation");
        assert(
          thrown.message.includes("Private Veryfront host module cannot be imported"),
        );
      }
    });

    it("should rewrite #deno-config to the framework-scoped browser stub", () => {
      const result = strategy.rewrite(
        makeInfo("#deno-config"),
        makeCtx({ target: "browser" }),
      );
      assertEquals(result.specifier, "/_vf_modules/_veryfront/_deno-config.js");
    });

    it("should preserve the captured snapshot on the deno-config stub URL", () => {
      const result = strategy.rewrite(
        makeInfo("#deno-config"),
        makeCtx({ dependencyPinningCacheKey: "on:snapshot-a" }),
      );
      assertEquals(
        result.specifier,
        "/_vf_modules/_pins/on%3Asnapshot-a/_veryfront/_deno-config.js",
      );
    });

    it("should resolve exact internal aliases using deno.json mappings", () => {
      const result = strategy.rewrite(
        makeInfo("#veryfront/compat/console"),
        makeCtx({ target: "browser" }),
      );
      assertEquals(
        result.specifier,
        "/_vf_modules/_veryfront/platform/compat/console/index.js",
      );
    });

    it("should resolve prefix internal aliases using the longest matching mapping", () => {
      const result = strategy.rewrite(
        makeInfo("#veryfront/compat/path/index.ts"),
        makeCtx({ target: "ssr" }),
      );
      assertEquals(
        result.specifier,
        "/_vf_modules/_veryfront/platform/compat/path/index.js?ssr=true",
      );
    });
  });

  describe("dependency declaration resolution", () => {
    const postedSpecifiers: string[] = [];
    let originalFlag: string | undefined;

    beforeEach(() => {
      originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      clearReactVersionCache();
      _clearNpmVersionCache();
      postedSpecifiers.length = 0;
      _setDependencyResolutionPosterForTest((_projectId, specifiers) => {
        postedSpecifiers.push(...specifiers);
        return Promise.resolve();
      });
    });

    afterEach(async () => {
      await _pendingResolutions();
      _clearNpmVersionCache();
      clearReactVersionCache();
      if (originalFlag === undefined) {
        deleteEnv(DEPENDENCY_PINNING_ENV_FLAG);
      } else {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
      }
    });

    it("schedules a raw veryfront declaration from the captured snapshot", async () => {
      strategy.rewrite(
        makeInfo("veryfront/head"),
        await makeAuthorizedContext({ veryfront: "next" }),
      );
      await _pendingResolutions();

      assertEquals(postedSpecifiers, ["veryfront@next"]);
    });

    it("schedules a bare veryfront import only for a verified dependency map", async () => {
      strategy.rewrite(
        makeInfo("veryfront"),
        await makeAuthorizedContext({}),
      );
      strategy.rewrite(
        makeInfo("veryfront"),
        makeCtx({ dependencyPinningCacheKey: "on:unknown" }),
      );
      await _pendingResolutions();

      assertEquals(postedSpecifiers, ["veryfront"]);
    });

    it("does not schedule exact, off, or internal veryfront imports", async () => {
      strategy.rewrite(
        makeInfo("veryfront"),
        makeCtx({
          dependencyPinningCacheKey: "on:snapshot-exact",
          dependencyPinningDependencies: { veryfront: "v0.1.1150" },
        }),
      );
      strategy.rewrite(
        makeInfo("veryfront/workflow"),
        makeCtx({
          dependencyPinningCacheKey: "off",
          dependencyPinningDependencies: { veryfront: "^0.1" },
        }),
      );
      strategy.rewrite(
        makeInfo("#veryfront/utils"),
        makeCtx({
          dependencyPinningCacheKey: "on:snapshot-internal",
          dependencyPinningDependencies: { veryfront: "^0.1" },
        }),
      );
      await _pendingResolutions();

      assertEquals(postedSpecifiers, []);
    });
  });
});
