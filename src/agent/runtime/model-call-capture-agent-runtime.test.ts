import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { ProviderOverloadedError } from "#veryfront/provider/runtime-loader.ts";
import { getCurrentVeryfrontCloudModelCallCapture } from "#veryfront/provider/veryfront-cloud/context.ts";
import {
  registerVeryfrontCloudModelFacts,
  type VeryfrontCloudModelFacts,
} from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import type { AgentRunEventSink } from "#veryfront/runtime/model-call-context.ts";
import { runWithMandatoryRunEventSink } from "#veryfront/runtime/run-event-sink-context.ts";
import {
  bindRuntimeObservationWriterCapability,
  createRuntimeObservationWriterCapability,
} from "#veryfront/runtime/runtime-observation-carrier.ts";
import { AgentRuntime } from "./index.ts";

const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const localRunId = "33333333-3333-4333-8333-333333333333";

function registerVeryfrontCloudTestModel(model: ModelRuntime): ModelRuntime {
  const facts = {
    provider: "openai",
    surface: "openai",
    native: true,
    transportPlan: { transport: "chat-completions", pinned: true },
  } satisfies VeryfrontCloudModelFacts;
  registerVeryfrontCloudModelFacts(model, () => facts);
  return model;
}

async function consumeStream(stream: ReadableStream<Uint8Array>): Promise<void> {
  for await (const _chunk of stream) {
    // Consume the response body so provider dispatch and finalization run.
  }
}

async function readStreamBody(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let body = "";
  for await (const chunk of stream) body += decoder.decode(chunk, { stream: true });
  return body;
}

function overloadedProviderError(): ProviderOverloadedError {
  return new ProviderOverloadedError({
    provider: "openai",
    status: 503,
    message: "OpenAI temporarily overloaded",
    retryable: true,
  });
}

function erroringRuntimeStream(
  parts: readonly unknown[],
  error: unknown,
): ReadableStream<unknown> {
  let index = 0;
  return new ReadableStream<unknown>({
    pull(controller) {
      if (index < parts.length) {
        controller.enqueue(parts[index]);
        index += 1;
        return;
      }
      controller.error(error);
    },
  });
}

function providerStream<T>(chunks: readonly T[]): ReadableStream<T> {
  return new ReadableStream<T>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe("agent runtime model-call capture", () => {
  it("preserves Veryfront Cloud facts through the streaming wrapper before dispatch", async () => {
    const order: string[] = [];
    let recordedModelCallId: string | undefined;
    let dispatchCapture: unknown;
    const sink: AgentRunEventSink = (event) => {
      order.push("event");
      recordedModelCallId = event.modelCallId;
      if (!event.modelCallId) return;
      return {
        eventId: "9007199254740993",
        projectId,
        runId,
        modelCallId: event.modelCallId,
      };
    };
    const capability = createRuntimeObservationWriterCapability({
      scope: { runId: localRunId, canonicalRunId: runId, projectId },
    });
    bindRuntimeObservationWriterCapability(sink, capability);

    const model = registerVeryfrontCloudTestModel(
      {
        provider: "veryfront-cloud",
        modelId: "veryfront-cloud/openai/gpt-test",
        specificationVersion: "v3",
        doGenerate: () => Promise.reject(new Error("Unexpected generate")),
        doStream: () => {
          order.push("dispatch");
          dispatchCapture = getCurrentVeryfrontCloudModelCallCapture();
          return Promise.resolve({
            stream: providerStream([
              { type: "text-delta", delta: "ok" },
              { type: "finish", finishReason: "stop", usage: {} },
            ]),
          });
        },
      } satisfies ModelRuntime,
    );

    const runtime = new AgentRuntime("model-call-capture-stream", {
      model: "veryfront-cloud/openai/gpt-test",
      system: "Synthetic instructions",
      maxSteps: 1,
    }, {
      resolveModelRuntime: () => model,
    });

    const stream = await runWithMandatoryRunEventSink(
      sink,
      () =>
        runtime.stream([{
          id: "synthetic-message",
          role: "user",
          parts: [{ type: "text", text: "Synthetic input" }],
        }]),
    );
    await consumeStream(stream);

    assertEquals(order.slice(0, 2), ["event", "dispatch"]);
    assertEquals(typeof recordedModelCallId, "string");
    assertEquals(dispatchCapture, {
      eventId: "9007199254740993",
      projectId,
      runId,
      modelCallId: recordedModelCallId,
    });
  });

  it("retries a retryable provider stream failure before visible output with fresh capture", async () => {
    const modelCallIds: string[] = [];
    const dispatchCaptures: unknown[] = [];
    const sink: AgentRunEventSink = (event) => {
      if (!event.modelCallId) return;
      modelCallIds.push(event.modelCallId);
      return {
        eventId: `${9007199254740993n + BigInt(modelCallIds.length - 1)}`,
        projectId,
        runId,
        modelCallId: event.modelCallId,
      };
    };
    const capability = createRuntimeObservationWriterCapability({
      scope: { runId: localRunId, canonicalRunId: runId, projectId },
    });
    bindRuntimeObservationWriterCapability(sink, capability);

    let attempts = 0;
    const model = registerVeryfrontCloudTestModel(
      {
        provider: "veryfront-cloud",
        modelId: "veryfront-cloud/openai/gpt-overload-retry",
        specificationVersion: "v3",
        doGenerate: () => Promise.reject(new Error("Unexpected generate")),
        doStream: () => {
          attempts += 1;
          dispatchCaptures.push(getCurrentVeryfrontCloudModelCallCapture());
          if (attempts === 1) {
            throw overloadedProviderError();
          }
          return Promise.resolve({
            stream: providerStream([
              { type: "text-delta", text: "ok" },
              { type: "finish", finishReason: "stop", totalUsage: {} },
            ]),
          });
        },
      } satisfies ModelRuntime,
    );

    const runtime = new AgentRuntime("model-call-capture-overload-retry", {
      model: "veryfront-cloud/openai/gpt-overload-retry",
      system: "Synthetic instructions",
      maxSteps: 1,
    }, {
      resolveModelRuntime: () => model,
    });

    const stream = await runWithMandatoryRunEventSink(
      sink,
      () =>
        runtime.stream([{
          id: "synthetic-message",
          role: "user",
          parts: [{ type: "text", text: "Synthetic input" }],
        }]),
    );
    const body = await readStreamBody(stream);

    assertEquals(attempts, 2);
    assertEquals(modelCallIds.length, 2);
    assertEquals(modelCallIds[0] === modelCallIds[1], false);
    assertEquals(dispatchCaptures, [
      { eventId: "9007199254740993", projectId, runId, modelCallId: modelCallIds[0] },
      { eventId: "9007199254740994", projectId, runId, modelCallId: modelCallIds[1] },
    ]);
    assertEquals(body.match(/\"type\":\"text-delta\"/g)?.length, 1);
    assertEquals(body.includes("ok"), true);
    assertEquals(body.includes("OVERLOADED_ERROR"), false);
  });

  it("does not retry a retryable provider failure after text is visible", async () => {
    let attempts = 0;
    const model = registerVeryfrontCloudTestModel(
      {
        provider: "veryfront-cloud",
        modelId: "veryfront-cloud/openai/gpt-overload-after-text",
        specificationVersion: "v3",
        doGenerate: () => Promise.reject(new Error("Unexpected generate")),
        doStream: () => {
          attempts += 1;
          return Promise.resolve({
            stream: erroringRuntimeStream([
              { type: "text-delta", text: "partial" },
            ], overloadedProviderError()),
          });
        },
      } satisfies ModelRuntime,
    );
    const sink: AgentRunEventSink = (event) =>
      event.modelCallId
        ? { eventId: "9007199254740993", projectId, runId, modelCallId: event.modelCallId }
        : undefined;
    bindRuntimeObservationWriterCapability(
      sink,
      createRuntimeObservationWriterCapability({
        scope: { runId: localRunId, canonicalRunId: runId, projectId },
      }),
    );

    const runtime = new AgentRuntime("model-call-capture-overload-after-text", {
      model: "veryfront-cloud/openai/gpt-overload-after-text",
      system: "Synthetic instructions",
      maxSteps: 1,
    }, {
      resolveModelRuntime: () => model,
    });

    const stream = await runWithMandatoryRunEventSink(
      sink,
      () =>
        runtime.stream([{
          id: "synthetic-message",
          role: "user",
          parts: [{ type: "text", text: "Synthetic input" }],
        }]),
    );
    const body = await readStreamBody(stream);

    assertEquals(attempts, 1);
    assertEquals(body.match(/\"type\":\"text-delta\"/g)?.length, 1);
    assertEquals(body.includes("partial"), true);
    assertEquals(body.includes("OVERLOADED_ERROR"), true);
  });

  it("does not retry a retryable provider failure after a custom data event is visible", async () => {
    let attempts = 0;
    const model = registerVeryfrontCloudTestModel(
      {
        provider: "veryfront-cloud",
        modelId: "veryfront-cloud/openai/gpt-overload-after-data",
        specificationVersion: "v3",
        doGenerate: () => Promise.reject(new Error("Unexpected generate")),
        doStream: () => {
          attempts += 1;
          return Promise.resolve({
            stream: erroringRuntimeStream([
              { type: "data-progress", data: { stage: "started" } },
            ], overloadedProviderError()),
          });
        },
      } satisfies ModelRuntime,
    );
    const sink: AgentRunEventSink = (event) =>
      event.modelCallId
        ? { eventId: "9007199254740993", projectId, runId, modelCallId: event.modelCallId }
        : undefined;
    bindRuntimeObservationWriterCapability(
      sink,
      createRuntimeObservationWriterCapability({
        scope: { runId: localRunId, canonicalRunId: runId, projectId },
      }),
    );

    const runtime = new AgentRuntime("model-call-capture-overload-after-data", {
      model: "veryfront-cloud/openai/gpt-overload-after-data",
      system: "Synthetic instructions",
      maxSteps: 1,
    }, {
      resolveModelRuntime: () => model,
    });

    const stream = await runWithMandatoryRunEventSink(
      sink,
      () =>
        runtime.stream([{
          id: "synthetic-message",
          role: "user",
          parts: [{ type: "text", text: "Synthetic input" }],
        }]),
    );
    const body = await readStreamBody(stream);

    assertEquals(attempts, 1);
    assertEquals(body.match(/\"type\":\"data-progress\"/g)?.length, 1);
    assertEquals(body.includes("started"), true);
    assertEquals(body.includes("OVERLOADED_ERROR"), true);
  });

  it("tries a retryable provider stream failure once and keeps persistent overload terminal", async () => {
    const modelCallIds: string[] = [];
    let attempts = 0;
    const model = registerVeryfrontCloudTestModel(
      {
        provider: "veryfront-cloud",
        modelId: "veryfront-cloud/openai/gpt-overload-persistent",
        specificationVersion: "v3",
        doGenerate: () => Promise.reject(new Error("Unexpected generate")),
        doStream: () => {
          attempts += 1;
          throw overloadedProviderError();
        },
      } satisfies ModelRuntime,
    );
    const sink: AgentRunEventSink = (event) => {
      if (!event.modelCallId) return;
      modelCallIds.push(event.modelCallId);
      return {
        eventId: `${9007199254740993n + BigInt(modelCallIds.length - 1)}`,
        projectId,
        runId,
        modelCallId: event.modelCallId,
      };
    };
    bindRuntimeObservationWriterCapability(
      sink,
      createRuntimeObservationWriterCapability({
        scope: { runId: localRunId, canonicalRunId: runId, projectId },
      }),
    );

    const runtime = new AgentRuntime("model-call-capture-overload-persistent", {
      model: "veryfront-cloud/openai/gpt-overload-persistent",
      system: "Synthetic instructions",
      maxSteps: 1,
    }, {
      resolveModelRuntime: () => model,
    });

    const stream = await runWithMandatoryRunEventSink(
      sink,
      () =>
        runtime.stream([{
          id: "synthetic-message",
          role: "user",
          parts: [{ type: "text", text: "Synthetic input" }],
        }]),
    );
    const body = await readStreamBody(stream);

    assertEquals(attempts, 2);
    assertEquals(modelCallIds.length, 2);
    assertEquals(body.includes('"type":"text-delta"'), false);
    assertEquals(body.includes("OVERLOADED_ERROR"), true);
  });

  it("does not retry a retryable provider stream failure after caller abort", async () => {
    const abort = new AbortController();
    let attempts = 0;
    const model = registerVeryfrontCloudTestModel(
      {
        provider: "veryfront-cloud",
        modelId: "veryfront-cloud/openai/gpt-overload-aborted",
        specificationVersion: "v3",
        doGenerate: () => Promise.reject(new Error("Unexpected generate")),
        doStream: () => {
          attempts += 1;
          abort.abort(new DOMException("cancelled", "AbortError"));
          throw overloadedProviderError();
        },
      } satisfies ModelRuntime,
    );
    const sink: AgentRunEventSink = (event) =>
      event.modelCallId
        ? { eventId: "9007199254740993", projectId, runId, modelCallId: event.modelCallId }
        : undefined;
    bindRuntimeObservationWriterCapability(
      sink,
      createRuntimeObservationWriterCapability({
        scope: { runId: localRunId, canonicalRunId: runId, projectId },
      }),
    );

    const runtime = new AgentRuntime("model-call-capture-overload-aborted", {
      model: "veryfront-cloud/openai/gpt-overload-aborted",
      system: "Synthetic instructions",
      maxSteps: 1,
    }, {
      resolveModelRuntime: () => model,
    });

    const stream = await runWithMandatoryRunEventSink(
      sink,
      () =>
        runtime.stream(
          [{
            id: "synthetic-message",
            role: "user",
            parts: [{ type: "text", text: "Synthetic input" }],
          }],
          undefined,
          undefined,
          undefined,
          undefined,
          abort.signal,
        ),
    );
    await readStreamBody(stream);

    assertEquals(attempts, 1);
  });
});
