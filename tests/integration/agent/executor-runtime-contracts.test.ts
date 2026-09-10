import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import { initializeExecutorRuntimeContracts } from "#veryfront/agent/hosted/executor-runtime-contracts.ts";

it("initializes executor runtime contracts once and preserves their trusted generations", async () => {
  await Promise.all([
    initializeExecutorRuntimeContracts(),
    initializeExecutorRuntimeContracts(),
  ]);
  const first = [
    tryResolve("SchemaValidator"),
    tryResolve("Bundler"),
    tryResolve("ModuleLexer"),
    tryResolve("SkillDocumentParserProvider"),
  ];
  assertEquals(first.every((contract) => contract !== undefined), true);
  await initializeExecutorRuntimeContracts();
  assertEquals([
    tryResolve("SchemaValidator"),
    tryResolve("Bundler"),
    tryResolve("ModuleLexer"),
    tryResolve("SkillDocumentParserProvider"),
  ], first);
});

it("keeps project runtime modules outside the contract initializer graph", async () => {
  const root = new URL("../../../", import.meta.url);
  const command = new Deno.Command(Deno.execPath(), {
    cwd: root,
    args: [
      "info",
      "--frozen",
      "--json",
      "src/agent/hosted/executor-runtime-contracts.ts",
    ],
  });
  const output = await command.output();
  assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
  const graph = JSON.parse(new TextDecoder().decode(output.stdout)) as {
    roots: string[];
    modules: Array<{ specifier: string; dependencies?: Array<{ code?: { specifier: string } }> }>;
  };
  const modules = new Map(graph.modules.map((module) => [module.specifier, module]));
  const visited = new Set<string>();
  const pending = [...graph.roots];
  while (pending.length) {
    const specifier = pending.shift()!;
    if (visited.has(specifier)) continue;
    visited.add(specifier);
    for (const dependency of modules.get(specifier)?.dependencies ?? []) {
      if (dependency.code) pending.push(dependency.code.specifier);
    }
  }
  const forbidden = [
    "/src/config/loader.ts",
    "/src/agent/project/agent-runtime.ts",
    "/src/agent/hosted/cloud-agent-config.ts",
    "/src/agent/hosted/executor-discovery-node.ts",
    "/src/agent/hosted/default-chat-runtime.ts",
  ];
  assertEquals(
    [...visited].filter((specifier) => forbidden.some((path) => specifier.endsWith(path))),
    [],
  );
  assert(
    [...visited].some((specifier) => specifier.endsWith("/src/extensions/bundler/defaults.ts")),
  );
});
