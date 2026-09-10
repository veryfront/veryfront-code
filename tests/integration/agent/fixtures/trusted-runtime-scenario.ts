import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import process from "node:process";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createExecutorChannel } from "#veryfront/agent/executor/channel.ts";
import { connectExecutorTransport } from "#veryfront/agent/hosted/executor-node-transport.ts";
import { createExecutorProjectToolSource } from "#veryfront/agent/hosted/executor-project-tools.ts";
import { createTrustedRuntimePreparation } from "#veryfront/agent/hosted/trusted-runtime-prepare.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import type { ProviderReplayCheckpoint } from "#veryfront/agent/runtime/provider-replay.ts";

export async function runNativeTrustedScenario(
  mode: "complete" | "cancel" | "crash" | "startup-failure" | "denied" | "collections",
) {
  const root = new URL("../../../../", import.meta.url);
  const startedAt = performance.now();
  const marker = `synthetic-trusted-private-${randomUUID()}`;
  const binding = {
    allocationId: "synthetic-allocation",
    generation: 1,
    invocationId: "synthetic-invocation",
  };
  const context = { agentId: "coder", projectId: "synthetic-project", runId: "synthetic-run" };
  const key = randomBytes(32);
  const previous = process.env.VF_NATIVE_PARENT_SECRET;
  process.env.VF_NATIVE_PARENT_SECRET = marker;
  const child = spawn(process.execPath, [
    "--import",
    fileURLToPath(new URL("tests/node/resolver.mjs", root)),
    fileURLToPath(new URL("./trusted-project-executor.ts", import.meta.url)),
  ], {
    cwd: fileURLToPath(root),
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "test",
      DENO_TESTING: "1",
      ...(mode === "collections" ? { VF_NATIVE_PATCH_MEMBERSHIP: "1" } : {}),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(JSON.stringify({ binding, key: [...key], context, mode }) + "\n");
  let output = "";
  let errors = "";
  const ready = Promise.withResolvers<number>();
  child.stdout.on("data", (chunk) => {
    output += chunk;
    const match = output.match(/VF_READY (\{[^\n]+\})/);
    if (match) ready.resolve(JSON.parse(match[1]!).port);
  });
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  const exited = new Promise<number | null>((resolve) => {
    child.once("close", (code) => {
      ready.reject(new Error(`Child exited ${code}: ${errors}`));
      resolve(code);
    });
  });
  child.once("error", ready.reject);
  const timer = setTimeout(() => {
    ready.reject(new Error(`Native fixture timeout: ${errors}`));
    child.kill();
  }, 25_000);
  let owner: ReturnType<typeof createTrustedRuntimePreparation> | undefined;
  try {
    if (mode === "startup-failure") {
      await assertRejects(() => ready.promise);
      assertEquals(await exited, 1);
      return;
    }
    const transport = await connectExecutorTransport({
      binding,
      podIp: "127.0.0.1",
      port: await ready.promise,
      key,
      timeoutMs: 30_000,
    });
    const channel = createExecutorChannel({ binding, transport });
    const lifetime = new AbortController();
    const signal = lifetime.signal;
    const source = await createExecutorProjectToolSource({
      channel,
      signal,
      context: {
        agentId: context.agentId,
        projectId: context.projectId,
        execution: { kind: "canonical", runId: context.runId },
      },
      allowedToolNames: new Set(["inspect"]),
      assertActive() {},
    });
    if (mode === "collections") {
      const frames = await Array.fromAsync(channel.stream("tool.list", { sourceId: "project" }));
      assertEquals(
        frames.filter((frame) =>
          frame && typeof frame === "object" && !Array.isArray(frame) && frame.type === "tool"
        ).length,
        1,
      );
      const denied = await Array.fromAsync(channel.stream("tool.execute", {
        sourceId: "project",
        toolName: "denied",
        toolCallId: "denied",
        args: {},
      }));
      assertEquals(denied, [{ type: "failure" }]);
    }
    if (mode === "denied") {
      await assertRejects(() => source.executeTool("ungranted", {}, { toolCallId: "denied" }));
      await assertRejects(() =>
        source.executeTool("inspect", { query: "authorized query" }, {
          ...context,
          projectId: "other",
          toolCallId: "denied",
        })
      );
      channel.close();
      await channel.settled;
      transport.close();
      assertEquals(await exited, 0);
      const report = output.match(/VF_REPORT (\{[^\n]+\})/);
      assert(report);
      assertEquals(JSON.parse(report[1]!), { observations: [], calls: 0, hasParentSecret: false });
      return;
    }
    const order: string[] = [];
    const query = mode === "cancel" ? "wait" : mode === "crash" ? "crash" : "authorized query";
    const rawUse = { type: "tool_use", id: "synthetic-call", name: "inspect", input: { query } };
    const model = scriptedModel([
      () => {
        order.push("model:1");
        return {
          toolCalls: [{ id: "synthetic-call", name: "inspect", input: { query } }],
          providerMetadata: {
            anthropic: {
              rawAssistantMessages: [[
                { type: "thinking", thinking: "", signature: marker },
                rawUse,
              ]],
            },
          },
        };
      },
      () => {
        order.push("model:2");
        return {
          text: marker,
          providerMetadata: {
            anthropic: { rawAssistantMessages: [[{ type: "text", text: marker }]] },
          },
        };
      },
    ], { provider: "anthropic", modelId: "claude-sonnet-4-6", only: "stream" });
    const modelId = "veryfront-cloud/anthropic/claude-sonnet-4-6";
    const results: unknown[] = [];
    const checkpoints: ProviderReplayCheckpoint[] = [];
    let runtimeCleanups = 0;
    let projectCleanups = 0;
    owner = createTrustedRuntimePreparation({
      binding,
      source: { type: "release", releaseId: "synthetic-release" },
      channel,
      signal,
      projectTools: {
        ...source,
        executeTool: async (name, args, call) => {
          const result = await source.executeTool(name, args, {
            ...call,
            publishDataEvent: async (event) => {
              await call?.publishDataEvent?.(event);
              if (mode === "cancel" && event.type === "fixture.waiting") lifetime.abort();
            },
          });
          results.push(result);
          return result;
        },
      },
      sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
      grant: {
        agentId: "coder",
        defaultModelId: modelId,
        maxSteps: 2,
        models: new Map([[modelId, { maxOutputTokens: 20_000, providerToolNames: [] }]]),
        allowedToolNames: ["inspect"],
        hostToolFacadeIds: [],
        remoteToolSourceIds: ["project"],
        execution: {
          kind: "canonical",
          projectId: context.projectId,
          runId: context.runId,
          conversationId: "synthetic-conversation",
          messageId: "synthetic-message",
          providerReplay: "required",
        },
      },
      facades: {
        resolveModelRuntime: () => model,
        hostTools: new Map(),
        remoteToolSources: new Map(),
        projectSteering: {
          prepare: ({ definition }) => Promise.resolve({ agent: definition }),
          refresh: () => marker,
        },
        publishParentRunEvents: () => Promise.resolve(),
        toolExposureCheckpoint: { persist: () => Promise.resolve() },
        providerReplayCheckpoint: {
          persist: async (checkpoint) => {
            order.push("persist:start");
            await Promise.resolve();
            checkpoints.push(checkpoint);
            order.push("persist:done");
          },
        },
        cleanup: () => {
          runtimeCleanups++;
          return Promise.resolve();
        },
      },
      closeProject: async () => {
        projectCleanups++;
        channel.close();
        await channel.settled;
        transport.close();
        assertEquals(await exited, mode === "crash" ? 23 : 0, errors);
      },
    });
    const operation = owner.operations.get("runtime.prepare")!;
    assertEquals(operation.mode, "unary");
    if (operation.mode !== "unary") throw new Error("Invalid preparation operation");
    const opContext = { binding, signal, deadline: Date.now() + 30_000 };
    const prepared = await operation.handle({
      agentId: "coder",
      instructions: marker,
      thinking: { enabled: false },
    }, opContext) as { ok: boolean; value: { preparedRuntimeHandle: string } };
    assertEquals(prepared.ok, true, JSON.stringify(prepared));
    const stream = owner.operations.get("agent.stream")!;
    if (stream.mode !== "stream") throw new Error("Invalid stream operation");
    const reading = Array.fromAsync(
      stream.handle({
        preparedRuntimeHandle: prepared.value.preparedRuntimeHandle,
        messages: [{
          id: "input",
          role: "user",
          timestamp: 1,
          parts: [{ type: "text", text: marker }],
        }],
      }, opContext),
    );
    if (mode === "cancel" || mode === "crash") {
      await assertRejects(() => reading);
      await owner.close();
      assertEquals(runtimeCleanups, 1);
      assertEquals(projectCleanups, 1);
      assertEquals(model.callCount, 1);
      assertEquals(results.length, 0);
      if (mode === "cancel") {
        const report = output.match(/VF_REPORT (\{[^\n]+\})/);
        assert(report);
        assertEquals(JSON.parse(report[1]!), {
          observations: [],
          calls: 1,
          hasParentSecret: false,
        });
      }
      return;
    }
    const frames = await reading;
    assertEquals(frames[0], { type: "ready" });
    assertEquals(frames.at(-1), { type: "complete" });
    assertEquals(results, [{
      query: "authorized query",
      context: { ...context, toolCallId: "synthetic-call" },
      fields: [
        "abortSignal",
        "agentId",
        "projectId",
        "publishDataEvent",
        "runId",
        "runIdBindsToolAuthorization",
        "toolCallId",
      ],
      observations: [],
      hasParentSecret: false,
      patchedMembership: mode === "collections",
    }]);
    assertEquals(model.callCount, 2);
    assertEquals(checkpoints.length, 2);
    assertEquals(checkpoints[1]?.messageId, "synthetic-message");
    assertEquals(checkpoints[1]?.providerMessageBlockCounts, [2, 1]);
    assert(JSON.stringify(checkpoints[0]).includes(marker));
    assert(order.indexOf("persist:done") >= 0);
    assert(order.indexOf("persist:done") < order.indexOf("model:2"));
    await owner.close();
    assertEquals(runtimeCleanups, 1);
    assertEquals(projectCleanups, 1);
    const report = output.match(/VF_REPORT (\{[^\n]+\})/);
    assert(report);
    assertEquals(JSON.parse(report[1]!), { observations: [], calls: 1, hasParentSecret: false });
    console.info(
      JSON.stringify({
        mode,
        elapsedMs: Math.round(performance.now() - startedAt),
        modelCalls: model.callCount,
      }),
    );
  } finally {
    try {
      await owner?.close();
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null) child.kill();
      await exited;
      if (previous === undefined) delete process.env.VF_NATIVE_PARENT_SECRET;
      else process.env.VF_NATIVE_PARENT_SECRET = previous;
    }
  }
}
