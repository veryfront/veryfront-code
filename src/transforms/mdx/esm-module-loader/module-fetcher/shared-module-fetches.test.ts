import "#veryfront/schemas/_test-setup.ts";
/** @module transforms/mdx/esm-module-loader/module-fetcher/shared-module-fetches.test */

import { assertEquals, assertNotEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { ModuleFetcherContext } from "../types.ts";
import {
  getSharedModuleFetchCount,
  getSharedModuleFetchKey,
  resetSharedModuleFetches,
  runSharedModuleFetch,
} from "./shared-module-fetches.ts";
import {
  endRenderSession,
  recordModuleToSession,
  runInRenderSession,
  startRenderSession,
} from "./render-sessions.ts";
import {
  clearAllManifests,
  getRouteModulePaths,
} from "#veryfront/modules/manifest/route-module-manifest.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function context(overrides: Partial<ModuleFetcherContext> = {}): ModuleFetcherContext {
  return {
    esmCacheDir: "/cache/project-a/release-1",
    adapter: {} as RuntimeAdapter,
    projectDir: "/projects/a",
    projectId: "project-a",
    contentSourceId: "release-1",
    ...overrides,
  };
}

describe("shared module fetches", () => {
  afterEach(() => {
    resetSharedModuleFetches();
    clearAllManifests();
  });

  describe("getSharedModuleFetchKey", () => {
    it("is stable for the same entry and inputs", () => {
      assertEquals(
        getSharedModuleFetchKey(context(), "_vf_modules/page.js"),
        getSharedModuleFetchKey(context(), "_vf_modules/page.js"),
      );
    });

    for (
      const [name, overrides] of [
        ["project", { projectId: "project-b" }],
        ["content source", { contentSourceId: "release-2" }],
        ["cache directory", { esmCacheDir: "/cache/other" }],
        ["project directory", { projectDir: "/projects/b" }],
        ["compile mode", { dev: true }],
        ["React version", { reactVersion: "18.3.1" }],
        ["dependency snapshot", { dependencyPinningCacheKey: "on:snapshot" }],
        ["module server origin", { moduleServerOrigin: "https://example.test" }],
        ["server external packages", { serverExternalPackages: ["sharp"] }],
        ["missing-module mode", { strictMissingModules: false }],
        ["local project flag", { isLocalProject: true }],
      ] as const
    ) {
      it(`differs by ${name}`, () => {
        assertNotEquals(
          getSharedModuleFetchKey(context(overrides), "_vf_modules/page.js"),
          getSharedModuleFetchKey(context(), "_vf_modules/page.js"),
        );
      });
    }

    it("differs by entry path", () => {
      assertNotEquals(
        getSharedModuleFetchKey(context(), "_vf_modules/a.js"),
        getSharedModuleFetchKey(context(), "_vf_modules/b.js"),
      );
    });
  });

  describe("runSharedModuleFetch", () => {
    it("runs one resolution for concurrent callers with the same key", async () => {
      const gate = deferred<string | null>();
      let runs = 0;
      const resolve = () => {
        runs++;
        return gate.promise;
      };

      const callers = Array.from({ length: 10 }, () => runSharedModuleFetch("key", resolve));
      assertEquals(getSharedModuleFetchCount(), 1);
      gate.resolve("/cache/page.mjs");

      assertEquals(await Promise.all(callers), Array(10).fill("/cache/page.mjs"));
      assertEquals(runs, 1);
      assertEquals(getSharedModuleFetchCount(), 0);
    });

    it("runs separate resolutions for different keys", async () => {
      let runs = 0;
      const results = await Promise.all([
        runSharedModuleFetch("project-a", () => Promise.resolve(`a-${++runs}`)),
        runSharedModuleFetch("project-b", () => Promise.resolve(`b-${++runs}`)),
      ]);

      assertEquals(results, ["a-1", "b-2"]);
    });

    it("shares a rejection and does not keep it for later callers", async () => {
      const gate = deferred<string | null>();
      let runs = 0;
      const failing = () => {
        runs++;
        return gate.promise;
      };

      const callers = Promise.allSettled([
        runSharedModuleFetch("key", failing),
        runSharedModuleFetch("key", failing),
      ]);
      gate.reject(new Error("cache unavailable"));

      const settled = await callers;
      assertEquals(settled.map((result) => result.status), ["rejected", "rejected"]);
      assertEquals(runs, 1);
      assertEquals(getSharedModuleFetchCount(), 0);

      assertEquals(await runSharedModuleFetch("key", () => Promise.resolve("retried")), "retried");
    });

    it("propagates a synchronous resolver failure", async () => {
      await assertRejects(
        () =>
          runSharedModuleFetch("key", () => {
            throw new Error("resolver failed");
          }),
        Error,
        "resolver failed",
      );
      assertEquals(getSharedModuleFetchCount(), 0);
    });

    it("lets a joined caller retry alone after a failure that belongs to the leader", async () => {
      const gate = deferred<string | null>();
      const leader = runSharedModuleFetch("key", () => gate.promise, {
        retryAloneOn: () => true,
      });
      const follower = runSharedModuleFetch("key", () => Promise.resolve("follower-own"), {
        retryAloneOn: (error) => error instanceof RangeError,
      });
      gate.reject(new RangeError("leader deadline"));

      await assertRejects(() => leader, RangeError, "leader deadline");
      assertEquals(await follower, "follower-own");
    });

    it("does not retry a joined caller for other failures", async () => {
      const gate = deferred<string | null>();
      let followerRuns = 0;
      const callers = Promise.allSettled([
        runSharedModuleFetch("key", () => gate.promise),
        runSharedModuleFetch("key", () => {
          followerRuns++;
          return Promise.resolve("unused");
        }, { retryAloneOn: (error) => error instanceof RangeError }),
      ]);
      gate.reject(new Error("source unavailable"));

      assertEquals((await callers).map((result) => result.status), ["rejected", "rejected"]);
      assertEquals(followerRuns, 0);
    });

    it("rejects only the caller whose result hook throws", async () => {
      const gate = deferred<void>();
      const resolve = async () => {
        recordModuleToSession("_vf_modules/page.js");
        await gate.promise;
        return "/cache/page.mjs";
      };
      const callers = Promise.allSettled([
        runSharedModuleFetch("key", resolve),
        runSharedModuleFetch("key", resolve, {
          onResolved: (modules) => {
            throw new Error(`too many modules: ${modules.size}`);
          },
        }),
      ]);
      gate.resolve();

      const [first, second] = await callers;
      assertEquals(first, { status: "fulfilled", value: "/cache/page.mjs" });
      assertEquals(second.status, "rejected");
    });

    it("runs a nested call directly instead of joining another resolution", async () => {
      const outerGate = deferred<string | null>();
      const nestedResults: Array<string | null> = [];

      const outer = runSharedModuleFetch("outer", async () => {
        // A nested entry fetch for a key that is already in flight must not
        // wait on it, or two resolutions could wait on each other.
        nestedResults.push(
          await runSharedModuleFetch("outer", () => Promise.resolve("nested-direct")),
        );
        return await outerGate.promise;
      });
      await Promise.resolve();
      outerGate.resolve("outer-result");

      assertEquals(await outer, "outer-result");
      assertEquals(nestedResults, ["nested-direct"]);
    });

    it("does not join a resolution after a reset", async () => {
      const gate = deferred<string | null>();
      let runs = 0;
      const resolve = () => {
        runs++;
        return gate.promise;
      };

      const before = runSharedModuleFetch("key", resolve);
      resetSharedModuleFetches();
      const after = runSharedModuleFetch("key", resolve);
      gate.resolve("done");

      assertEquals(await Promise.all([before, after]), ["done", "done"]);
      assertEquals(runs, 2);
    });

    it("records the resolved modules into each joined render session", async () => {
      const gate = deferred<void>();
      const resolve = async () => {
        recordModuleToSession("_vf_modules/page.js");
        await gate.promise;
        recordModuleToSession("_vf_modules/lib/utils.js");
        return "/cache/page.mjs";
      };
      const routes = ["/first", "/second"];
      for (const route of routes) startRenderSession(route, "project-a", route);

      const callers = routes.map((route) =>
        runInRenderSession(route, () => runSharedModuleFetch("key", resolve))
      );
      gate.resolve();
      await Promise.all(callers);
      for (const route of routes) endRenderSession(route);

      for (const route of routes) {
        assertEquals(getRouteModulePaths("project-a", route).sort(), ["lib/utils.js", "page.js"]);
      }
    });
  });
});
