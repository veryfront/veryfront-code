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
import { startExecutorRuntimeEntrypoint } from "#veryfront/agent/hosted/executor-runtime-entrypoint.ts";
import { generateCsrfToken } from "#veryfront/security/csrf/helpers.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";

const root = new URL("../../../", import.meta.url);
const resolver = fileURLToPath(new URL("tests/node/resolver.mjs", root));

/** Register beside the fixed-port bootstrap tests so Deno file parallelism cannot race port 8081. */
export function registerExecutorRuntimeEntrypointTests(): void {
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
  for (const profile of ["runtime", "project-tools", "http"] as const) {
    it(`loads a real project only after fixed ${profile} installation`, {
      timeout: 45_000,
    }, async () => {
      const dir = await mkdtemp(join(tmpdir(), "vf-managed-executor-"));
      const marker = join(dir, "loaded.json");
      const streamCanceled = join(dir, "stream-canceled.txt");
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
      if (profile === "http") {
        await mkdir(join(dir, "pages", "api"), { recursive: true });
        await writeFile(
          join(dir, "pages", "api", "echo.ts"),
          `import process from "node:process";
          import { trace } from "veryfront/observability";
          const tracer = trace.getTracer("http-fixture");
          export default ({ request, env }: { request: Request; env: Record<string, string> }) => {
            if (request.headers.has("x-token")) throw new Error("Unexpected platform credential");
            if (env.APP_VALUE !== "installed-value") throw new Error("Missing application configuration");
            if (env.OTEL_EXPORTER_OTLP_HEADERS !== undefined) throw new Error("Unexpected collector credential");
            if (process.env.REQUEST_VALUE !== undefined) throw new Error("Request environment leaked");
            const requestValue = request.method + "@" + new URL(request.url).hostname;
            process.env.REQUEST_VALUE = requestValue;
            tracer.startSpan("http.fixture.custom").end();
            const body = request.body?.pipeThrough(new TransformStream({ transform(chunk, controller) {
              if (process.env.APP_VALUE !== "installed-value") { console.error("Lost streamed environment"); throw new Error("Lost streamed environment"); }
              if (process.env.REQUEST_VALUE !== requestValue) throw new Error("Lost request environment mutation");
              tracer.startSpan("http.fixture.stream").end();
              controller.enqueue(chunk);
            }}));
            return new Response(body, { status: 201, headers: {
              "content-type": "application/octet-stream", "x-synthetic-pid": String(process.pid)
            } });
          };`,
        );
      }
      if (profile === "http") {
        await writeFile(
          join(dir, "pages", "api", "stream.ts"),
          `
          import { writeFileSync } from "node:fs";
          import process from "node:process";
          export default () => new Response(new ReadableStream({
            start(controller) { controller.enqueue(new TextEncoder().encode("started")); },
            cancel() {
              if (process.env.APP_VALUE !== "installed-value") throw new Error("Lost cancellation environment");
              writeFileSync(${JSON.stringify(streamCanceled)}, "canceled");
            },
          }, { highWaterMark: 0 }));
        `,
        );
      }
      if (profile === "project-tools") {
        await mkdir(join(dir, "tools"));
        await writeFile(
          join(dir, "tools", "inspect.ts"),
          'import { tool } from "veryfront/tool"; import { defineSchema } from "veryfront/schemas"; export default tool({ id: "inspect", description: "Inspect approved data", inputSchema: defineSchema(v => v.object({ query: v.string() }))(), execute: (input, context) => ({ query: input.query, agentId: context.agentId, projectId: context.projectId, runId: context.runId, toolCallId: context.toolCallId }) });',
        );
      }
      const binding = { allocationId: randomUUID(), generation: 1, invocationId: randomUUID() };
      const key = randomBytes(32);
      let channel: ReturnType<typeof createExecutorChannel> | undefined;
      const httpClient = profile === "http"
        ? (await import("#veryfront/server/isolated-http/executor-http.ts"))
          .createExecutorHttpClient({ binding, channel: () => channel! })
        : undefined;
      const child = spawn(process.execPath, [
        "--experimental-transform-types",
        "--import",
        resolver,
        fileURLToPath(new URL("tests/fixtures/executor-runtime-process.ts", root)),
        dir,
        profile,
      ], {
        cwd: fileURLToPath(root),
        env: {
          PATH: "/usr/local/bin:/usr/bin:/bin",
          // The test runner owns this directory; preserve child-process coverage
          // without inheriting the broker's environment or credentials.
          ...(process.env.NODE_V8_COVERAGE
            ? { NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE }
            : {}),
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
          operations: httpClient
            ? new Map([
              ...httpClient.operations,
              [
                "http.configuration",
                (await import("#veryfront/server/isolated-http/application-configuration.ts"))
                  .createExecutorHttpConfigurationOperation(binding, {
                    projectId: "synthetic-project",
                    projectSlug: "synthetic-project",
                    releaseId: "synthetic-release",
                    environmentId: "synthetic-environment",
                    environmentName: "staging",
                    configurationId: "synthetic-configuration",
                    variables: { APP_VALUE: "installed-value" },
                  }),
              ],
            ])
            : (profile === "project-tools"
              ? new Map()
              : (await import("#veryfront/agent/hosted/executor-model-bridge.ts"))
                .createExecutorModelBroker({
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
                })),
        });
        await channel.ready;
        await assertRejects(() => channel!.request("discovery.describe", {}));
        assertEquals(existsSync(marker), false);
        const runtimeInput = {
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
        const projectContext = {
          agentId: "writer",
          projectId: "synthetic-project",
          runId: "synthetic-run",
        };
        const input: JsonValue = profile === "http"
          ? {
            version: 1,
            mode: "http",
            binding,
            root: "project",
            owner: { scopeKind: "project", projectId: "synthetic-project" },
            source: runtimeInput.source,
            environmentId: "synthetic-environment",
            configurationId: "synthetic-configuration",
          }
          : profile === "runtime"
          ? runtimeInput
          : {
            version: 1,
            mode: "project-tools",
            binding,
            root: "project",
            owner: runtimeInput.owner,
            source: runtimeInput.source,
            context: projectContext,
            allowedToolNames: ["inspect"],
            maxCalls: 32,
            maxConcurrent: 2,
          };
        await assertRejects(() =>
          channel!.request("runtime.install", {
            ...input,
            source: { type: "release", releaseId: "wrong" },
          })
        );
        assertEquals(existsSync(marker), false);
        const installed = await channel.request("runtime.install", input).catch((error) => {
          throw new Error(`Executor installation failed: ${stderr}`, { cause: error });
        });
        assertEquals(installed, { installed: true });
        if (httpClient) {
          const refused = await httpClient.fetch(
            new Request("https://app.example/api/echo", {
              method: "POST",
              body: "no csrf token",
            }),
          );
          assertEquals(refused.status, 403);
          await refused.text();
          const { token: csrfToken } = generateCsrfToken({ secure: true });
          const bytes = Uint8Array.from({ length: 90_000 }, (_, index) => index % 256);
          let spanRecords = "[]";
          const response = await httpClient.fetch(
            new Request("https://app.example/api/echo", {
              method: "POST",
              body: bytes,
              headers: {
                "x-token": "synthetic-platform-credential",
                cookie: `__Host-vf_csrf=${csrfToken}`,
                "x-csrf-token": csrfToken,
              },
            }),
            {
              traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
              onRecords: (records) => {
                spanRecords = records;
              },
            },
          );
          if (response.status !== 201) {
            throw new Error(
              `Unexpected application status ${response.status}: ${await response
                .text()} ${stderr}`,
            );
          }
          assertEquals(response.status, 201);
          assertEquals(response.headers.get("x-synthetic-pid"), String(endpoint.pid));
          const echoed = await response.arrayBuffer().catch((error) => {
            throw new Error(`Application stream failed: ${stderr}`, { cause: error });
          });
          assertEquals(new Uint8Array(echoed), bytes);
          const spans = JSON.parse(spanRecords);
          assert(spans.some((span: { name: string }) => span.name === "http.fixture.custom"));
          assert(spans.some((span: { name: string }) => span.name === "http.fixture.stream"));
          for (const span of spans) {
            assertEquals(span.traceId, "11111111111111111111111111111111");
          }
          assertEquals(spans[0].parentSpanId, "2222222222222222");
          let laterRecords = "[]";
          const later = await httpClient.fetch(
            new Request("https://foreign.preview.veryfront.com/api/echo", {
              headers: { "x-project-id": "foreign", "x-environment-id": "foreign" },
            }),
            {
              traceparent: "00-33333333333333333333333333333333-4444444444444444-01",
              onRecords: (records) => {
                laterRecords = records;
              },
            },
          );
          assertEquals(later.status, 201);
          await later.text();
          const laterSpans = JSON.parse(laterRecords);
          assertEquals(laterSpans.length, 1);
          assertEquals(laterSpans[0].traceId, "33333333333333333333333333333333");
          assertEquals(laterSpans[0].parentSpanId, "4444444444444444");
          const stream = await httpClient.fetch(new Request("https://app.example/api/stream"));
          assertEquals(stream.status, 200);
          const reader = stream.body!.getReader();
          assertEquals(new TextDecoder().decode((await reader.read()).value), "started");
          await reader.cancel();
          reader.releaseLock();
          const cancelDeadline = Date.now() + 2_000;
          while (!existsSync(streamCanceled) && Date.now() < cancelDeadline) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
          assertEquals(
            existsSync(streamCanceled),
            true,
            "Application body cancellation must run in its own environment",
          );
          await assertRejects(() => channel!.request("runtime.prepare", { agentId: "writer" }));
          await assertRejects(() => Array.fromAsync(channel!.stream("agent.stream", {})));
        } else {
          const { getExecutorDiscoveryResultSchema } = await import(
            "#veryfront/agent/hosted/executor-discovery-schema.ts"
          );
          const description = getExecutorDiscoveryResultSchema().parse(
            await channel.request("discovery.describe", {}, { timeoutMs: 30_000 }),
          );
          assert(description.ok, JSON.stringify(description));
        }
        assertEquals(JSON.parse(await readFile(marker, "utf8")).pid, endpoint.pid);
        await assertRejects(() => channel!.request("runtime.install", input));
        if (profile === "project-tools") {
          await assertRejects(() => channel!.request("runtime.prepare", { agentId: "writer" }));
          await assertRejects(() => Array.fromAsync(channel!.stream("agent.stream", {})));
          const { createExecutorProjectToolSource } = await import(
            "#veryfront/agent/hosted/executor-project-tools.ts"
          );
          const projectSource = await createExecutorProjectToolSource({
            channel,
            signal: channel.signal,
            context: {
              agentId: projectContext.agentId,
              projectId: projectContext.projectId,
              execution: { kind: "canonical", runId: projectContext.runId },
            },
            allowedToolNames: new Set(["inspect"]),
            assertActive() {},
          });
          assertEquals((await projectSource.listTools()).map((tool) => tool.name), ["inspect"]);
          assertEquals(
            await projectSource.executeTool("inspect", { query: "approved" }, {
              toolCallId: "call",
            }),
            {
              query: "approved",
              ...projectContext,
              toolCallId: "call",
            },
          );
        }
        channel.close();
        await channel.settled;
        assertEquals(await exited, 0, stderr);
      } finally {
        clearTimeout(timer);
        await httpClient?.close();
        channel?.close();
        await channel?.settled;
        child.kill();
        await exited.catch(() => {});
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
}
