import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { BROWSER_SAFE_EXPORTS } from "../../../scripts/build/browser-safe-exports.mjs";
import {
  collectClientGraph,
  createRealReader,
  findServerOnlyLeaks,
  loadImportMap,
  traceLeak,
} from "../../../scripts/lint/client-bundle-graph.ts";

const ROOT = new URL("../../../", import.meta.url);

describe("the framework's browser exports", () => {
  for (const entry of BROWSER_SAFE_EXPORTS) {
    it(`${entry} reaches no server modules or Node builtins`, async () => {
      const config = JSON.parse(await Deno.readTextFile(new URL("deno.json", ROOT)));
      const source = config.exports[entry];
      assert(typeof source === "string", `Missing browser export ${entry}`);
      const graph = await collectClientGraph(
        source.replace(/^\.\//, ""),
        await loadImportMap(ROOT),
        createRealReader(ROOT),
      );
      assert(graph.size >= 1, "expected a non-empty graph");
      const leaks = findServerOnlyLeaks(graph);
      assertEquals(leaks, [], leaks.map((leak) => traceLeak(graph, leak)).join("\n"));
    });
  }
});
