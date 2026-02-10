import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { loadModuleFromEsmSh, loadPlugin } from "./plugin-loader.ts";

describe("styles-builder/plugin-loader", () => {
  it("throws when esm.sh stub request fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch =
      (() => Promise.resolve(new Response("upstream failure", { status: 503 }))) as typeof fetch;

    try {
      await assertRejects(
        () => loadModuleFromEsmSh("missing-plugin@1.0.0"),
        Error,
        "Failed to fetch stub: 503",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("throws when esm.sh stub has no bundle path", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch =
      (() =>
        Promise.resolve(new Response(`export * from "react";`, { status: 200 }))) as typeof fetch;

    try {
      await assertRejects(
        () => loadModuleFromEsmSh("broken-package@1.0.0"),
        Error,
        "Could not find bundle path in esm.sh response",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("throws when esm.sh bundle fetch fails", async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = (() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          new Response(`export * from "/v1/bad-package.bundle.mjs";`, { status: 200 }),
        );
      }
      return Promise.resolve(new Response("bundle failure", { status: 500 }));
    }) as typeof fetch;

    try {
      await assertRejects(
        () => loadModuleFromEsmSh("bad-package@1.0.0"),
        Error,
        "Failed to fetch bundle: 500",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("throws when esm.sh bundle responds with HTML", async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = (() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          new Response(`export * from "/v1/html-package.bundle.mjs";`, { status: 200 }),
        );
      }
      return Promise.resolve(new Response("<html>not javascript</html>", { status: 200 }));
    }) as typeof fetch;

    try {
      await assertRejects(
        () => loadModuleFromEsmSh("html-package@1.0.0"),
        Error,
        "returned HTML instead of JavaScript",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns cached plugin error without refetching", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCallCount = 0;
    globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
      fetchCallCount++;
      return Promise.reject(new Error("fetch should not be called"));
    }) as typeof fetch;

    try {
      const pluginCache = new Map<string, unknown>();
      const pluginErrors = new Map<string, string>();
      pluginCache.set("cached-bad-plugin", null);
      pluginErrors.set("cached-bad-plugin", "cached plugin load failure");

      await assertRejects(
        () => loadPlugin("cached-bad-plugin", pluginCache, pluginErrors),
        Error,
        "cached plugin load failure",
      );
      assertEquals(fetchCallCount, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses plugin cache on subsequent successful loads", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCallCount = 0;
    globalThis.fetch = (() => {
      fetchCallCount++;
      if (fetchCallCount === 1) {
        return Promise.resolve(
          new Response(`export * from "/v1/good-plugin.bundle.mjs";`, { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(`export default { id: "good-plugin", handler() {} };`, { status: 200 }),
      );
    }) as typeof fetch;

    try {
      const pluginCache = new Map<string, unknown>();
      const pluginErrors = new Map<string, string>();

      const first = await loadPlugin("good-plugin@1.0.0", pluginCache, pluginErrors);
      const second = await loadPlugin("good-plugin@1.0.0", pluginCache, pluginErrors);

      assertEquals(typeof first, "object");
      assertEquals(second === first, true);
      assertEquals(fetchCallCount, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
