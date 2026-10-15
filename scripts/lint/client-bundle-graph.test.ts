import { BROWSER_SAFE_EXPORTS } from "../build/browser-safe-exports.mjs";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type ClientGraph,
  collectClientGraph,
  createRealReader,
  findServerOnlyLeaks,
  loadImportMap,
  type ReadModule,
  SERVER_ONLY_MODULE_PATTERNS,
  staticSpecifiers,
  summarizeGraph,
  traceLeak,
} from "./client-bundle-graph.ts";

const ROOT = new URL("../../", import.meta.url);
const SRC_IMPORT_MAP = { "#veryfront/": "./src/" };

function memoryReader(modules: Record<string, string>): ReadModule {
  return (repoPath) => {
    for (
      const candidate of [repoPath, repoPath + ".ts", repoPath + "/index.ts"]
    ) {
      if (candidate in modules) {
        return Promise.resolve({
          path: candidate,
          source: modules[candidate]!,
        });
      }
    }
    return Promise.resolve(null);
  };
}

function graphFrom(modules: Record<string, string>): Promise<ClientGraph> {
  return collectClientGraph(
    "app/client-entry.ts",
    SRC_IMPORT_MAP,
    memoryReader(modules),
  );
}

describe("scripts/lint/client-bundle-graph", () => {
  describe("findServerOnlyLeaks", () => {
    it("rejects Node builtins through re-exports and side-effect imports", async () => {
      const graph = await graphFrom({
        "app/client-entry.ts": 'export { value } from "./helper.ts";',
        "app/helper.ts":
          'import "node:buffer";\nimport { readFile } from "fs";\nexport const value = readFile;',
      });
      assertEquals(findServerOnlyLeaks(graph), ["node:buffer", "node:fs"]);
      assertEquals(
        traceLeak(graph, "node:buffer"),
        "app/client-entry.ts → app/helper.ts → node:buffer",
      );
    });

    it("fails closed when an internal module cannot be read", async () => {
      let failure: unknown;
      try {
        await graphFrom({
          "app/client-entry.ts": 'export * from "./missing.ts";',
        });
      } catch (error) {
        failure = error;
      }
      assert(failure instanceof Error);
      assert(failure.message.includes("missing.ts"));
    });

    it("flags a server module reached from a client entry, with the import chain", async () => {
      const graph = await graphFrom({
        "app/client-entry.ts":
          'import { open } from "./helper.ts";\nexport const x = open;',
        "app/helper.ts":
          'export { denoAdapter as open } from "#veryfront/platform/adapters/runtime/deno/adapter.ts";',
        "src/platform/adapters/runtime/deno/adapter.ts":
          "export const denoAdapter = {};",
      });

      const leaks = findServerOnlyLeaks(graph);
      assertEquals(leaks, ["src/platform/adapters/runtime/deno/adapter.ts"]);
      assertEquals(
        traceLeak(graph, leaks[0]!),
        "app/client-entry.ts → app/helper.ts → src/platform/adapters/runtime/deno/adapter.ts",
      );
    });

    it("clears a client entry that only reaches client-safe modules", async () => {
      const graph = await graphFrom({
        "app/client-entry.ts":
          'import { env } from "#veryfront/platform/compat/process/env.ts";\n' +
          'import { fmt } from "./util.ts";\nexport const x = [env, fmt];',
        "src/platform/compat/process/env.ts": "export const env = {};",
        "app/util.ts": "export const fmt = (s) => s;",
      });

      assertEquals(findServerOnlyLeaks(graph), []);
    });

    it("ignores type-only and dynamic edges into a server module", async () => {
      const graph = await graphFrom({
        "app/client-entry.ts": [
          'import type { DenoAdapter } from "#veryfront/platform/adapters/runtime/deno/adapter.ts";',
          "export async function load() {",
          '  return await import("#veryfront/platform/adapters/runtime/deno/adapter.ts");',
          "}",
          "export type A = DenoAdapter;",
        ].join("\n"),
        "src/platform/adapters/runtime/deno/adapter.ts":
          "export class DenoAdapter {}",
      });

      assertEquals(findServerOnlyLeaks(graph), []);
    });

    it("ignores an inline type-only clause, which Deno erases entirely", async () => {
      const graph = await graphFrom({
        "app/client-entry.ts": [
          'import { type DenoAdapter } from "#veryfront/platform/adapters/runtime/deno/adapter.ts";',
          'export { type Fs } from "#veryfront/platform/adapters/runtime/node/adapter.ts";',
          "export type A = DenoAdapter;",
        ].join("\n"),
        "src/platform/adapters/runtime/deno/adapter.ts":
          "export class DenoAdapter {}",
        "src/platform/adapters/runtime/node/adapter.ts": "export class Fs {}",
      });

      assertEquals(findServerOnlyLeaks(graph), []);
    });

    it("still follows a clause that mixes a type binding with a value binding", async () => {
      const graph = await graphFrom({
        "app/client-entry.ts":
          'import { type DenoAdapter, open } from "#veryfront/platform/adapters/runtime/deno/adapter.ts";\n' +
          "export const x: DenoAdapter = open;",
        "src/platform/adapters/runtime/deno/adapter.ts":
          "export class DenoAdapter {}\nexport const open = {};",
      });

      assertEquals(findServerOnlyLeaks(graph), [
        "src/platform/adapters/runtime/deno/adapter.ts",
      ]);
    });

    it("still follows `{ type as value }`, which imports a binding named type", async () => {
      // `type as value` renames a binding *called* `type`; it is not the type
      // modifier, so the module ships. Reading the leading word as the modifier
      // dropped the edge and let a server module through the gate unseen.
      const graph = await graphFrom({
        "app/client-entry.ts":
          'import { type as value } from "#veryfront/platform/adapters/runtime/deno/adapter.ts";\n' +
          "export const x = value;",
        "src/platform/adapters/runtime/deno/adapter.ts":
          "export const type = {};",
      });

      assertEquals(findServerOnlyLeaks(graph), [
        "src/platform/adapters/runtime/deno/adapter.ts",
      ]);
    });

    it("follows a bare side-effect import, which still ships the module", async () => {
      const graph = await graphFrom({
        "app/client-entry.ts":
          'import "#veryfront/server/production-server.ts";',
        "src/server/production-server.ts": "console.log('server boot');",
      });

      assertEquals(findServerOnlyLeaks(graph), [
        "src/server/production-server.ts",
      ]);
    });
  });

  describe("staticSpecifiers", () => {
    it("ignores imports in comments and template examples", () => {
      assertEquals([
        ...staticSpecifiers(
          "// import x from \"node:fs\";\nconst example = `\nimport y from './missing.ts';\n`;\nexport { real } from './real.ts';",
        ),
      ], ["./real.ts"]);
    });

    it("keeps two interleaved iterations independent", () => {
      // It is a generator, so it suspends mid-scan with a live `lastIndex`. A
      // shared global regex would let one source advance the other's cursor and
      // silently drop a specifier — a dropped edge is a leak this gate misses.
      const a = 'import x from "./a1.ts";\nimport y from "./a2.ts";';
      const b = 'import p from "./b1.ts";\nimport q from "./b2.ts";';

      const ga = staticSpecifiers(a);
      const gb = staticSpecifiers(b);
      const fromA: string[] = [];
      const fromB: string[] = [];
      for (;;) {
        const ra = ga.next();
        const rb = gb.next();
        if (!ra.done) fromA.push(ra.value);
        if (!rb.done) fromB.push(rb.value);
        if (ra.done && rb.done) break;
      }

      assertEquals(fromA, ["./a1.ts", "./a2.ts"]);
      assertEquals(fromB, ["./b1.ts", "./b2.ts"]);
    });
  });

  describe("summarizeGraph", () => {
    it("counts every reached module and its source bytes", async () => {
      const entry = 'import "./a.ts";';
      const dep = "export const a = 1;";
      const graph = await graphFrom({
        "app/client-entry.ts": entry,
        "app/a.ts": dep,
      });
      const encoder = new TextEncoder();

      const { moduleCount, byteCount } = summarizeGraph(graph);
      assertEquals(moduleCount, 2);
      assertEquals(
        byteCount,
        encoder.encode(entry).length + encoder.encode(dep).length,
      );
    });
  });

  describe("the framework's browser exports", () => {
    for (const entry of BROWSER_SAFE_EXPORTS) {
      it(`${entry} reaches no server modules or Node builtins`, async () => {
        const config = JSON.parse(
          await Deno.readTextFile(new URL("deno.json", ROOT)),
        );
        const source = config.exports[entry];
        assert(typeof source === "string", `Missing browser export ${entry}`);
        const graph = await collectClientGraph(
          source.replace(/^\.\//, ""),
          await loadImportMap(ROOT),
          createRealReader(ROOT),
        );

        assert(
          graph.size >= 1,
          `expected a non-trivial graph, got ${graph.size} modules`,
        );
        const critical = findServerOnlyLeaks(graph);
        assertEquals(
          critical,
          [],
          critical.length
            ? "index.client.ts leaks a runtime adapter:\n" +
              critical.map((leak) => traceLeak(graph, leak)).join("\n")
            : "",
        );
        // Every server-only pattern is a valid RegExp against a normalised path.
        assert(SERVER_ONLY_MODULE_PATTERNS.every((p) => p instanceof RegExp));
      });
    }
  });
});
