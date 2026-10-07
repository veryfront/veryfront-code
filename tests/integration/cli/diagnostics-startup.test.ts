import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { basename } from "#std/path/basename";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { makeTempDirWithOptions } from "#veryfront/testing/deno-compat.ts";
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

async function createIsolatedCliCopy(
  entryName: string,
  source: string,
): Promise<{ readonly url: URL; readonly cleanup: () => Promise<void> }> {
  const cliRoot = fileURLToPath(new URL("cli/", root));
  const fixtureRoot = fileURLToPath(new URL("cli/__tests__/fixtures/startup-copies/", root));
  await Deno.mkdir(fixtureRoot, { recursive: true });
  const caseRoot = await makeTempDirWithOptions({ dir: fixtureRoot, prefix: "case-" });
  const tempDir = `${caseRoot}/cli`;
  await Deno.mkdir(tempDir);
  await Deno.symlink(fileURLToPath(new URL("deno.json", root)), `${caseRoot}/deno.json`);
  await Deno.symlink(fileURLToPath(new URL("src/", root)), `${caseRoot}/src`);

  for await (const entry of Deno.readDir(cliRoot)) {
    if (entry.name === "__tests__" || entry.name === "deno.json" || entry.name === entryName) {
      continue;
    }
    await Deno.symlink(`${cliRoot}/${entry.name}`, `${tempDir}/${entry.name}`);
  }

  const path = `${tempDir}/${entryName}`;
  await Deno.writeTextFile(path, source);
  return {
    url: pathToFileURL(path),
    cleanup: () => Deno.remove(caseRoot, { recursive: true }),
  };
}

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
    args: [
      "info",
      `--config=${fileURLToPath(new URL("deno.json", root))}`,
      "--json",
      "--frozen",
      entry.href,
    ],
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
    let copy: { readonly url: URL; readonly cleanup: () => Promise<void> } | undefined;
    try {
      copy = await createIsolatedCliCopy(
        basename(fileURLToPath(router)),
        source.replace(
          'from "veryfront/integrations/diagnostics"',
          'from "veryfront/integrations"',
        ),
      );
      const modules = await staticModules(copy.url);
      assert(modules.has(new URL("src/integrations/_data.ts", root).href));
      assertThrows(() => assertLightweight(modules));
    } finally {
      await copy?.cleanup();
    }
  });
});
