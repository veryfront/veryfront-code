import "#veryfront/schemas/_test-setup.ts";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import process from "node:process";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createExecutorChannel } from "#veryfront/agent/executor/channel.ts";
import {
  createExecutorModelBroker,
  createExecutorModelRuntimeResolver,
} from "#veryfront/agent/hosted/executor-model-bridge.ts";
import {
  connectExecutorTransport,
  listenExecutorTransport,
} from "#veryfront/agent/hosted/executor-node-transport.ts";
import type {
  ModelRuntime,
  ModelRuntimeCallOptions,
  ModelRuntimeGenerateResult,
} from "#veryfront/provider/types.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";

// Component interoperability over actual local TLS sockets. Both endpoints run
// in one Node process; this does not establish OS or process isolation.
if (typeof Deno !== "undefined") {
  it("runs model broker, invocation channel, and TLS interoperability on Node", {
    timeout: 25_000,
  }, async () => {
    const root = new URL("../../../", import.meta.url);
    const child = spawn("node", [
      "--import",
      fileURLToPath(new URL("tests/node/resolver.mjs", root)),
      "--test",
      fileURLToPath(import.meta.url),
    ], { cwd: fileURLToPath(root), stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => output += chunk);
    child.stderr.on("data", (chunk) => output += chunk);
    const timer = setTimeout(() => child.kill(), 20_000);
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
  });
} else {
  it("carries model results, cancellation, and connection closure through the TLS channel", {
    timeout: 10_000,
  }, async () => {
    const timersBefore = process.getActiveResourcesInfo().filter((kind) =>
      kind === "Timeout"
    ).length;
    const modelId = "veryfront-cloud/openai/synthetic-model";
    const allowedModelIds = new Set([modelId]);
    const binding = {
      allocationId: "synthetic-model-allocation",
      generation: 1,
      invocationId: "synthetic-model-invocation",
    };
    const prompt: ModelRuntimeCallOptions["prompt"] = [{
      role: "user",
      content: [{ type: "text", text: "Synthetic prompt" }],
    }];
    const generated: ModelRuntimeGenerateResult = {
      content: [{ type: "text", text: "Synthetic answer" }],
      finishReason: "stop",
      usage: { inputTokens: 2, outputTokens: 3 },
    };
    const streamed = [
      { type: "text-delta", delta: "Synthetic introduction" },
      {
        type: "tool-error",
        toolCallId: "synthetic-search",
        toolName: "web_search",
        error: [{ type: "web_search_tool_result_error", error_code: "max_uses_exceeded" }],
        isError: true,
        providerExecuted: true,
      },
      { type: "text-delta", delta: "Synthetic continuation" },
      {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 2, outputTokens: 5 },
      },
    ];
    const cancelledStarted = Promise.withResolvers<AbortSignal>();
    const cancelledAtBroker = Promise.withResolvers<void>();
    const pendingStarted = Promise.withResolvers<void>();
    const pendingAborted = Promise.withResolvers<void>();
    const idleStreamCancelled = Promise.withResolvers<void>();
    const pendingSignals: AbortSignal[] = [];
    let generationCalls = 0;
    let abortedPendingCalls = 0;
    let preparationCalls = 0;
    let resolutionCalls = 0;
    let generationOptions: ModelRuntimeCallOptions | undefined;
    let idleStream = false;
    let idleStreamSignal: AbortSignal | undefined;

    const stubModelRuntime: ModelRuntime<ModelRuntimeCallOptions> = {
      specificationVersion: "v2",
      provider: "veryfront-cloud",
      modelId: "synthetic-model",
      modelProvider: "openai",
      executionMode: "remote",
      _generateViaStream: true,
      runtimeCapabilities: { toolCalling: true, structuredOutput: ["json_schema"] },
      prepare(signal) {
        assert(signal instanceof AbortSignal);
        assertEquals(signal.aborted, false);
        preparationCalls++;
        return Promise.resolve();
      },
      doGenerate(options) {
        const call = ++generationCalls;
        if (call === 1) {
          generationOptions = options;
          return Promise.resolve(generated);
        }
        const signal = options.abortSignal;
        assert(signal instanceof AbortSignal);
        return new Promise<ModelRuntimeGenerateResult>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            if (call === 2) cancelledAtBroker.resolve();
            else if (++abortedPendingCalls === 2) pendingAborted.resolve();
            reject(new Error("Synthetic upstream cancellation"));
          }, { once: true });
          if (call === 2) cancelledStarted.resolve(signal);
          else {
            pendingSignals.push(signal);
            if (pendingSignals.length === 2) pendingStarted.resolve();
          }
        });
      },
      doStream(options) {
        if (idleStream) {
          idleStreamSignal = options.abortSignal;
          return Promise.resolve({
            stream: new ReadableStream({
              cancel() {
                idleStreamCancelled.resolve();
              },
            }, { highWaterMark: 0 }),
          });
        }
        return Promise.resolve({
          stream: new ReadableStream({
            start(controller) {
              for (const part of streamed) controller.enqueue(part);
              controller.close();
            },
          }),
        });
      },
    };
    const operations = createExecutorModelBroker({
      allowedModelIds,
      resolveModelRuntime(id) {
        resolutionCalls++;
        return id === modelId ? stubModelRuntime : undefined;
      },
    });
    const key = randomBytes(32);
    const listener = await listenExecutorTransport({
      host: "127.0.0.1",
      port: 0,
      binding,
      key,
      timeoutMs: 5_000,
    });
    const client = await connectExecutorTransport({
      podIp: "127.0.0.1",
      port: listener.address.port,
      binding,
      key,
      timeoutMs: 5_000,
    });
    key.fill(0);
    const server = await listener.connection;
    const broker = createExecutorChannel({ binding, transport: server, operations });
    const caller = createExecutorChannel({ binding, transport: client });
    try {
      await Promise.all([caller.ready, broker.ready]);
      const resolver = await createExecutorModelRuntimeResolver({
        channel: caller,
        allowedModelIds,
      });
      const proxy = resolver(modelId);
      assert(proxy);
      for (
        const field of [
          "specificationVersion",
          "provider",
          "modelId",
          "modelProvider",
          "executionMode",
          "runtimeCapabilities",
          "_generateViaStream",
        ] as const
      ) assertEquals(proxy[field], stubModelRuntime[field]);
      await proxy.prepare?.();
      assertEquals(preparationCalls, 1);
      assertEquals(await proxy.doGenerate({ prompt, maxOutputTokens: 50 }), generated);
      assertEquals(generationOptions?.prompt, prompt);
      assertEquals(generationOptions?.maxOutputTokens, 50);
      assert(generationOptions?.abortSignal instanceof AbortSignal);

      const { stream } = await proxy.doStream({ prompt });
      const reader = stream.getReader();
      const received: unknown[] = [];
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          received.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      assertEquals(received, streamed);
      assertEquals(resolutionCalls, 1);

      const abort = new AbortController();
      const cancelledCall = proxy.doGenerate({ prompt, abortSignal: abort.signal });
      const cancelled = assertRejects(async () => await cancelledCall, Error, "cancelled");
      const brokerSignal = await cancelledStarted.promise;
      assert(brokerSignal !== abort.signal);
      abort.abort();
      await Promise.all([cancelled, cancelledAtBroker.promise]);
      assertEquals(brokerSignal.aborted, true);

      idleStream = true;
      const pendingStream = await proxy.doStream({ prompt });
      const pendingReader = pendingStream.stream.getReader();
      const readRejected = assertRejects(() => pendingReader.read(), Error, "Executor");
      const pendingCalls = Promise.allSettled([
        proxy.doGenerate({ prompt }),
        proxy.doGenerate({ prompt }),
      ]);
      await pendingStarted.promise;
      // Closing authenticated I/O must propagate through both channel owners.
      listener.close();
      const settled = await pendingCalls;
      assertEquals(settled.map((result) => result.status), ["rejected", "rejected"]);
      await Promise.all([
        readRejected,
        pendingAborted.promise,
        idleStreamCancelled.promise,
        caller.closed,
        broker.closed,
      ]);
      pendingReader.releaseLock();
      assertEquals(pendingSignals.map((signal) => signal.aborted), [true, true]);
      assertEquals(idleStreamSignal?.aborted, true);
      assertEquals(caller.signal.aborted, true);
      assertEquals(broker.signal.aborted, true);
    } finally {
      caller.close();
      broker.close();
      listener.close();
      client.close();
      key.fill(0);
      await Promise.all([caller.closed, broker.closed]);
    }
    await setImmediate();
    assertEquals(
      process.getActiveResourcesInfo().filter((kind) => kind === "Timeout").length,
      timersBefore,
      "Closing model streams must not create cancellation timers after channel closure",
    );
  });
}
