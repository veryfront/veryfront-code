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
  summarizeGraph,
  traceLeak,
} from "./client-bundle-graph.ts";

const ROOT = new URL("../../", import.meta.url);
const SRC_IMPORT_MAP = { "#veryfront/": "./src/" };

// The #3661 crash class — must never reach a browser entrypoint.
const CRITICAL_PATTERNS: readonly RegExp[] = [
  /\/platform\/adapters\/runtime\/[^/]+\/(adapter|filesystem-adapter)\.ts$/,
  /\/platform\/adapters\/runtime\/shared\/node-filesystem-adapter\.ts$/,
];

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

  describe("the framework's real browser barrel", () => {
    it("index.client.ts reaches no server runtime adapter (#3661 crash class)", async () => {
      const graph = await collectClientGraph(
        "src/index.client.ts",
        await loadImportMap(ROOT),
        createRealReader(ROOT),
      );

      assert(
        graph.size > 10,
        `expected a non-trivial graph, got ${graph.size} modules`,
      );
      const critical = findServerOnlyLeaks(graph, CRITICAL_PATTERNS);
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
  });
});
