import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime } from "#veryfront/provider";
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
            stream: ReadableStream.from([
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
});
