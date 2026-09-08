import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";

type Module = { specifier: string; dependencies?: { code?: { specifier: string } }[] };
type Graph = { roots: string[]; modules: Module[] };
const root = fileURLToPath(new URL("../../../", import.meta.url));
const forbidden = [
  "/src/config/loader.ts",
  "/src/agent/factory.ts",
  "/src/tool/factory.ts",
  "/src/agent/project/agent-runtime.ts",
  "/src/agent/service/routes.ts",
  "/src/agent/hosted/cloud-agent-config.ts",
  "/src/agent/hosted/default-chat-runtime.ts",
  "/src/agent/hosted/executor-discovery-node.ts",
  "/src/server/runtime-handler/index.ts",
  "/src/agent/hosted/executor-runtime-entrypoint.ts",
  "/src/agent/hosted/executor-runtime-facades.ts",
];

for (
  const entry of [
    "src/agent/hosted/managed-executor-broker.ts",
    "src/agent/service/broker-ingress.ts",
    "src/agent/service/managed-broker-handler.ts",
    "src/agent/service/managed-broker.ts",
  ]
) {
  it(`keeps project runtime imports out of ${entry}`, { timeout: 30_000 }, async () => {
    const child = spawn(typeof Deno === "undefined" ? "deno" : Deno.execPath(), [
      "info",
      "--frozen",
      "--json",
      entry,
    ], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let diagnostics = "";
    child.stdout.on("data", (chunk) => output += chunk);
    child.stderr.on("data", (chunk) => diagnostics += chunk);
    const timer = setTimeout(() => child.kill(), 25_000);
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      assertEquals(code, 0, diagnostics);
      const graph: Graph = JSON.parse(output);
      const modules = new Map(graph.modules.map((module) => [module.specifier, module]));
      const visited = new Set<string>();
      const pending = [...graph.roots];
      while (pending.length) {
        const specifier = pending.shift()!;
        if (visited.has(specifier)) continue;
        visited.add(specifier);
        // Include statically resolvable dynamic imports; omit erased type edges.
        for (const dependency of modules.get(specifier)?.dependencies ?? []) {
          if (dependency.code) pending.push(dependency.code.specifier);
        }
      }
      assertEquals(
        [...visited].filter((specifier) => forbidden.some((path) => specifier.endsWith(path))),
        [],
      );
    } finally {
      clearTimeout(timer);
      child.kill();
    }
  });
}
