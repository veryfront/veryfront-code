import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("../../../", import.meta.url);
const router = new URL("cli/router.ts", root);
const diagnostics = new URL("src/integrations/error-context.ts", root);
const forbidden = [
  "src/integrations/index.ts",
  "src/integrations/_data.ts",
  "src/integrations/remote-tools.ts",
  "src/integrations/local-tool-source.ts",
].map((path) => new URL(path, root).href);

interface ModuleGraph {
  roots: string[];
  redirects: Record<string, string>;
  modules: {
    specifier: string;
    dependencies?: { isDynamic?: boolean; code?: { specifier?: string; error?: string } }[];
  }[];
}

async function staticModules(entry: URL): Promise<Set<string>> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", "--frozen", entry.href],
    cwd: fileURLToPath(root),
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  const graph: ModuleGraph = JSON.parse(new TextDecoder().decode(result.stdout));
  const modules = new Map(graph.modules.map((module) => [module.specifier, module]));
  const visited = new Set<string>();
  const pending = [...graph.roots];
  while (pending.length) {
    const next = pending.pop()!;
    const specifier = graph.redirects[next] ?? next;
    if (visited.has(specifier)) continue;
    visited.add(specifier);
    const module = modules.get(specifier);
    assert(module, `Missing module: ${specifier}`);
    for (const dependency of module.dependencies ?? []) {
      if (dependency.isDynamic || !dependency.code) continue;
      assert(!dependency.code.error, dependency.code.error);
      assert(dependency.code.specifier, "Unresolved static dependency");
      pending.push(dependency.code.specifier);
    }
  }
  return visited;
}

function assertLightweight(modules: Set<string>): void {
  assertEquals(forbidden.filter((specifier) => modules.has(specifier)), []);
}

describe("public diagnostics startup graph", () => {
  it("keeps the complete static router graph free of integration catalogue and tool modules", async () => {
    const modules = await staticModules(router);
    assert(modules.has(diagnostics.href));
    assertLightweight(modules);
    const leaf = await staticModules(diagnostics);
    assertEquals(
      [...leaf].sort(),
      [
        diagnostics.href,
        new URL("src/integrations/integration-condition.ts", root).href,
      ].sort(),
    );
    const config = JSON.parse(await Deno.readTextFile(new URL("deno.json", root)));
    assertEquals(
      config.exports["./integrations/diagnostics"],
      "./src/integrations/error-context.ts",
    );
    assertEquals(
      config.imports["veryfront/integrations/diagnostics"],
      "./src/integrations/error-context.ts",
    );
  });

  it("detects the barrel regression in an isolated router copy", async () => {
    const source = await Deno.readTextFile(router);
    assert(source.includes('from "veryfront/integrations/diagnostics"'));
    const copy = await Deno.makeTempFile({
      dir: fileURLToPath(new URL("cli/", root)),
      suffix: ".ts",
    });
    try {
      await Deno.writeTextFile(
        copy,
        source.replace(
          'from "veryfront/integrations/diagnostics"',
          'from "veryfront/integrations"',
        ),
      );
      const modules = await staticModules(pathToFileURL(copy));
      assert(modules.has(new URL("src/integrations/_data.ts", root).href));
      assertThrows(() => assertLightweight(modules));
    } finally {
      await Deno.remove(copy);
    }
  });
});
