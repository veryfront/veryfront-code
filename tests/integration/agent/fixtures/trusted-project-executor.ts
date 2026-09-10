import "#veryfront/schemas/_test-setup.ts";
import { register } from "#veryfront/extensions/contracts.ts";
import { EsbuildBundler, EsModuleLexer } from "@veryfront/ext-bundler-esbuild";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createExecutorDiscovery } from "#veryfront/agent/hosted/executor-discovery.ts";
import { createNodeExecutorDiscoveryBackend } from "#veryfront/agent/hosted/executor-discovery-node.ts";
import { createExecutorChannel } from "#veryfront/agent/executor/channel.ts";
import { createExecutorProjectToolOperations } from "#veryfront/agent/hosted/executor-project-tools.ts";
import { listenExecutorTransport } from "#veryfront/agent/hosted/executor-node-transport.ts";

const lines = createInterface({ input: process.stdin });
register("Bundler", new EsbuildBundler());
register("ModuleLexer", new EsModuleLexer());
const first = await lines[Symbol.asyncIterator]().next();
lines.close();
if (first.done) throw new Error("Missing synthetic bootstrap");
const { binding, key, context, mode } = JSON.parse(first.value);
const signal = new AbortController().signal;
const source = { type: "release", releaseId: "synthetic-release" } as const;
const projectDir = fileURLToPath(new URL("./trusted-project", import.meta.url));
const backend = createNodeExecutorDiscoveryBackend({ projectDir, cacheKey: "synthetic-native" });
const discovery = createExecutorDiscovery({
  binding,
  source,
  signal,
  projectDir,
  backend,
});
const describe = discovery.operations.get("agent.describe");
if (describe?.mode !== "unary") throw new Error("Missing discovery operation");
const description = await describe.handle({
  agentId: mode === "startup-failure" ? "missing" : "coder",
}, { binding, signal, deadline: Date.now() + 30_000 });
if (
  typeof description !== "object" || description === null || Array.isArray(description) ||
  !description.ok
) {
  await discovery.close();
  throw new Error("Synthetic project discovery failed");
}
const runtime = discovery.getRuntime();
const operations = new Map(discovery.operations);
for (
  const [name, operation] of createExecutorProjectToolOperations({
    scope: { binding, signal, assertActive() {} },
    context: {
      agentId: context.agentId,
      projectId: context.projectId,
      execution: { kind: "canonical", runId: context.runId },
    },
    tools: runtime.tools,
    allowedToolNames: new Set(["inspect"]),
    maxCalls: 32,
    maxConcurrent: 1,
  })
) operations.set(name, operation);
const listener = await listenExecutorTransport({
  host: "127.0.0.1",
  port: 0,
  binding,
  key: new Uint8Array(key),
  timeoutMs: 30_000,
});
process.stdout.write(`VF_READY ${JSON.stringify({ port: listener.address.port })}\n`);
try {
  const transport = await listener.connection;
  const channel = createExecutorChannel({ binding, transport, operations });
  await channel.settled;
} finally {
  listener.close();
  await discovery.close();
  const globals = globalThis as typeof globalThis & {
    __vfNativeObservations?: string[];
    __vfNativeCalls?: number;
  };
  process.stdout.write(
    `VF_REPORT ${
      JSON.stringify({
        observations: globals.__vfNativeObservations ?? [],
        calls: globals.__vfNativeCalls ?? 0,
        hasParentSecret: Object.hasOwn(process.env, "VF_NATIVE_PARENT_SECRET"),
      })
    }\n`,
  );
}
