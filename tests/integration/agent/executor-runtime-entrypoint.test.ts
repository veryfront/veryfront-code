import "#veryfront/schemas/_test-setup.ts";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { createExecutorChannel } from "#veryfront/agent/executor/channel.ts";
import { connectExecutorTransport } from "#veryfront/agent/hosted/executor-node-transport.ts";
import { createExecutorModelBroker } from "#veryfront/agent/hosted/executor-model-bridge.ts";
import { getExecutorDiscoveryResultSchema } from "#veryfront/agent/hosted/executor-discovery-schema.ts";
import { startExecutorRuntimeEntrypoint } from "#veryfront/agent/hosted/executor-runtime-entrypoint.ts";

const root = new URL("../../../", import.meta.url);
const resolver = fileURLToPath(new URL("tests/node/resolver.mjs", root));

if (typeof Deno !== "undefined") {
  it(
    "runs the actual executor entrypoint in a separate Node process",
    { timeout: 60_000 },
    async () => {
      const child = spawn(
        "node",
        ["--import", resolver, "--test", fileURLToPath(import.meta.url)],
        { cwd: fileURLToPath(root), stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      child.stdout.on("data", (chunk) => output += chunk);
      child.stderr.on("data", (chunk) => output += chunk);
      const timer = setTimeout(() => child.kill(), 55_000);
      try {
        const code = await new Promise<number | null>((resolve, reject) => {
          child.once("error", reject);
          child.once("close", resolve);
        });
        assertEquals(code, 0, output);
      } finally {
        clearTimeout(timer);
        child.kill();
      }
    },
  );
} else {
  it("rejects missing first-party runtime contracts before reading an allocation key", async () => {
    let keyReads = 0;
    let executor: Awaited<ReturnType<typeof startExecutorRuntimeEntrypoint>> | undefined;
    const values: Record<string, string> = {
      VERYFRONT_EXECUTOR_ALLOCATION_ID: randomUUID(),
      VERYFRONT_EXECUTOR_INVOCATION_ID: randomUUID(),
      VERYFRONT_EXECUTOR_GENERATION: "1",
      VERYFRONT_EXECUTOR_ACTIVE_DEADLINE_SECONDS: "30",
      VERYFRONT_EXECUTOR_HARD_DEADLINE_AT: String(Date.now() + 30_000),
      PORT: "8081",
    };
    try {
      await assertRejects(async () => {
        executor = await startExecutorRuntimeEntrypoint({
          environment: { get: (name) => values[name] },
          readArtifact: () =>
            Promise.resolve({
              manifest: {
                version: 1,
                root: "project",
                owner: { scopeKind: "global", serviceName: "veryfront-agent" },
                source: { type: "release", releaseId: "synthetic-release" },
              },
              projectDir: "/synthetic-project",
            }),
          readKey: () => {
            keyReads++;
            return Promise.resolve(randomBytes(32));
          },
        });
      });
      assertEquals(keyReads, 0);
    } finally {
      await executor?.close();
    }
  });
  it("loads a real project only in the executor after the fixed installation operation", {
    timeout: 45_000,
  }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "vf-managed-executor-"));
    const marker = join(dir, "loaded.json");
    await mkdir(join(dir, "crew"));
    await writeFile(
      join(dir, "veryfront.config.ts"),
      `import { writeFileSync } from "node:fs"; import process from "node:process"; writeFileSync(${
        JSON.stringify(marker)
      }, JSON.stringify({pid:process.pid})); export default { ai: { agents: { discovery: { paths: ["crew"] } } } };`,
    );
    await writeFile(
      join(dir, "crew", "writer.md"),
      "---\nname: Writer\n---\nSynthetic instructions.\n",
    );
    const binding = { allocationId: randomUUID(), generation: 1, invocationId: randomUUID() };
    const key = randomBytes(32);
    const child = spawn(process.execPath, [
      "--import",
      resolver,
      fileURLToPath(new URL("tests/fixtures/executor-runtime-process.ts", root)),
      dir,
    ], {
      cwd: fileURLToPath(root),
      env: {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        VERYFRONT_EXECUTOR_ALLOCATION_ID: binding.allocationId,
        VERYFRONT_EXECUTOR_INVOCATION_ID: binding.invocationId,
        VERYFRONT_EXECUTOR_GENERATION: "1",
        VERYFRONT_EXECUTOR_ACTIVE_DEADLINE_SECONDS: "40",
        VERYFRONT_EXECUTOR_HARD_DEADLINE_AT: String(Date.now() + 40_000),
        PORT: "8081",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => stderr += chunk);
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    void exited.catch(() => {});
    const ready = new Promise<{ pid: number; port: number }>((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.includes("\n")) {
          try {
            resolve(JSON.parse(output.split("\n")[0]!));
          } catch {
            reject(new Error("Invalid executor readiness"));
          }
        }
      });
      void exited.then(
        () => reject(new Error(`Executor exited before readiness: ${stderr}`)),
        reject,
      );
    });
    child.stdin.end(key);
    let channel: ReturnType<typeof createExecutorChannel> | undefined;
    const timer = setTimeout(() => child.kill(), 40_000);
    try {
      const endpoint = await ready;
      assert(endpoint.pid !== process.pid);
      assertEquals(existsSync(marker), false);
      const transport = await connectExecutorTransport({
        podIp: "127.0.0.1",
        port: endpoint.port,
        key,
        binding,
        timeoutMs: 30_000,
      });
      const modelId = "veryfront-cloud/openai/synthetic-model";
      channel = createExecutorChannel({
        binding,
        transport,
        operations: createExecutorModelBroker({
          allowedModelIds: new Set([modelId]),
          resolveModelRuntime: () => ({
            provider: "openai",
            modelId: "synthetic-model",
            specificationVersion: "v3",
            doGenerate: () => {
              throw new Error("Unexpected model call");
            },
            doStream: () => {
              throw new Error("Unexpected model call");
            },
          }),
        }),
      });
      await channel.ready;
      await assertRejects(() => channel!.request("discovery.describe", {}));
      assertEquals(existsSync(marker), false);
      const input = {
        version: 1,
        binding,
        root: "project",
        owner: { scopeKind: "global", serviceName: "veryfront-agent" },
        source: { type: "release", releaseId: "synthetic-release" },
        grant: {
          agentId: "writer",
          defaultModelId: modelId,
          maxSteps: 3,
          models: [{ id: modelId, maxOutputTokens: 100, providerToolNames: [] }],
          allowedToolNames: [],
          hostToolFacadeIds: [],
          remoteToolSourceIds: [],
          execution: { kind: "ephemeral", projectId: null },
        },
        capabilities: { persistence: {} },
      };
      await assertRejects(() =>
        channel!.request("runtime.install", {
          ...input,
          source: { type: "release", releaseId: "wrong" },
        })
      );
      assertEquals(existsSync(marker), false);
      assertEquals(await channel.request("runtime.install", input), { installed: true });
      const description = getExecutorDiscoveryResultSchema().parse(
        await channel.request("discovery.describe", {}, { timeoutMs: 30_000 }),
      );
      assert(description.ok, JSON.stringify(description));
      assertEquals(JSON.parse(await readFile(marker, "utf8")).pid, endpoint.pid);
      await assertRejects(() => channel!.request("runtime.install", input));
      channel.close();
      await channel.settled;
      assertEquals(await exited, 0, stderr);
    } finally {
      clearTimeout(timer);
      channel?.close();
      await channel?.settled;
      child.kill();
      await exited.catch(() => {});
      await rm(dir, { recursive: true, force: true });
    }
  });
}
