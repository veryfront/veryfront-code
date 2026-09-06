import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { linkRenderModules } from "./link-render-modules.ts";

const limits = { maxEntries: 8, maxBytes: 4096 };
const entry = "file:///snapshot/entry.mjs";

describe("linkRenderModules", () => {
  it("relocates imports and re-exports without changing the surrounding program", async () => {
    const source = `import { value } from './shared.mjs';
export { value } from "./shared.mjs";
export const load = () => import /* lazy */ ('./child.mjs?v=1#part', { with: {} });
export const location = import.meta.url;
export const untouched = "./shared.mjs";
import "node:fs";`;
    const graph = await linkRenderModules({
      modules: [
        { url: entry, source },
        { url: "file:///snapshot/shared.mjs", source: "export const value = 42;" },
        { url: "file:///snapshot/child.mjs", source: 'export * from "./shared.mjs";' },
      ],
      entrypoints: [entry],
    }, limits);
    assertEquals(graph, {
      files: [
        {
          path: "module-0.mjs",
          source: `import { value } from "./module-1.mjs";
export { value } from "./module-1.mjs";
export const load = () => import /* lazy */ ("./module-2.mjs?v=1#part", { with: {} });
export const location = import.meta.url;
export const untouched = "./shared.mjs";
import "node:fs";`,
        },
        { path: "module-1.mjs", source: "export const value = 42;" },
        { path: "module-2.mjs", source: 'export * from "./module-1.mjs";' },
      ],
      entrypoints: ["module-0.mjs"],
    });
  });

  it("produces the same graph for different replica paths and snapshot order", async () => {
    const input = (root: string) => ({
      modules: [
        { url: `${root}/a.mjs`, source: `export * from "${root}/b.mjs";` },
        { url: `${root}/b.mjs`, source: 'export const load = () => import("./a.mjs");' },
      ],
      entrypoints: [`${root}/a.mjs`, `${root}/b.mjs`],
    });
    const first = input("file:///replica-a/cache");
    const second = input("file:///replica-b/other");
    second.modules.reverse();
    assertEquals(await linkRenderModules(first, limits), await linkRenderModules(second, limits));
  });

  it("captures source, roots, and limits before asynchronous work", async () => {
    const data = {
      modules: [{ url: entry, source: "export const value = 42;" }],
      entrypoints: [entry],
    };
    const budget = { ...limits };
    const pending = linkRenderModules(data, budget);
    data.modules[0]!.source = "throw new Error('changed');";
    data.modules.length = 0;
    data.entrypoints.length = 0;
    budget.maxBytes = 1;
    assertEquals(await pending, {
      files: [{ path: "module-0.mjs", source: "export const value = 42;" }],
      entrypoints: ["module-0.mjs"],
    });
  });

  it("escapes rewritten literals and keeps distinct query and fragment identities", async () => {
    const graph = await linkRenderModules({
      modules: [
        {
          url: entry,
          source: `export const a = () => import('./sp\\u0061ce%20name.mjs?v=1#x"y');
export const b = () => import("./space%20name.mjs?v=2");
export const c = () => import("./space%20name.mjs?#");`,
        },
        { url: "file:///snapshot/space%20name.mjs", source: "export const value = 42;" },
      ],
      entrypoints: [entry],
    }, limits);
    assertEquals(
      graph.files[0]!.source,
      `export const a = () => import("./module-1.mjs?v=1#x%22y");
export const b = () => import("./module-1.mjs?v=2");
export const c = () => import("./module-1.mjs?#");`,
    );
    assertEquals(graph.files.length, 2, "URL variants share file bytes, not module instances");
  });

  it("rejects missing, computed, remote, and unresolved package imports without fallback", async () => {
    for (
      const source of [
        'import "./missing.mjs";',
        'import "file:///uncaptured/module.mjs";',
        "export const load = (name) => import(name);",
        "export const load = () => import(`./entry.mjs`);",
        'import "https://example.invalid/module.mjs";',
        'import "react";',
        'import "fs";',
        'import "node:not-a-builtin";',
      ]
    ) {
      await assertRejects(
        () =>
          linkRenderModules({ modules: [{ url: entry, source }], entrypoints: [entry] }, limits),
        Error,
      );
    }
  });

  it("rejects ambiguous snapshot identities and entrypoints", async () => {
    for (
      const url of [
        entry + "?v=1",
        entry + "#",
        "./entry.mjs",
        "https://example.invalid/a.mjs",
        "file:///a/../entry.mjs",
      ]
    ) {
      await assertRejects(() =>
        linkRenderModules({
          modules: [{ url, source: "" }],
          entrypoints: [url],
        }, limits), TypeError);
    }
    for (
      const data of [
        { modules: [{ url: entry, source: "" }, { url: entry, source: "" }], entrypoints: [entry] },
        { modules: [{ url: entry, source: "" }], entrypoints: [] },
        { modules: [{ url: entry, source: "" }], entrypoints: [entry, entry] },
        { modules: [{ url: entry, source: "" }], entrypoints: [entry + "?v=1"] },
      ]
    ) await assertRejects(() => linkRenderModules(data, limits), TypeError);
  });

  it("bounds snapshot bytes and module count and rejects lossy source text", async () => {
    const data = { modules: [{ url: entry, source: "// 😀" }], entrypoints: [entry] };
    const bytes = new TextEncoder().encode(entry + data.modules[0]!.source).length;
    await linkRenderModules(data, { maxEntries: 1, maxBytes: bytes });
    await assertRejects(
      () => linkRenderModules(data, { maxEntries: 1, maxBytes: bytes - 1 }),
      RangeError,
    );
    await assertRejects(
      () =>
        linkRenderModules({
          ...data,
          modules: [...data.modules, { url: "file:///other.mjs", source: "" }],
        }, { ...limits, maxEntries: 1 }),
      RangeError,
    );
    await assertRejects(
      () =>
        linkRenderModules(
          { modules: [{ url: entry, source: "\uD800" }], entrypoints: [entry] },
          limits,
        ),
      TypeError,
    );
    for (const value of [0, -1, NaN, Infinity, 1.5]) {
      await assertRejects(
        () => linkRenderModules(data, { ...limits, maxBytes: value }),
        RangeError,
      );
      await assertRejects(
        () => linkRenderModules(data, { ...limits, maxEntries: value }),
        RangeError,
      );
    }
  });

  it("bounds output growth from repeated rewritten imports", async () => {
    const root = "file:///a";
    const source = 'import "./a";'.repeat(30);
    await assertRejects(() =>
      linkRenderModules({
        modules: [{ url: root, source }],
        entrypoints: [root],
      }, { maxEntries: 1, maxBytes: root.length + source.length }), RangeError);
  });
});
