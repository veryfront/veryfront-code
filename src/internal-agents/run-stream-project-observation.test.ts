import "#veryfront/schemas/_test-setup.ts";
import { agent } from "#veryfront/agent";
import { assertEquals, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  buildAgentRunRuntimeContextPromptBlock,
  captureAgentRunRuntimeContext,
} from "#veryfront/agent/runtime/run-runtime-context.ts";
import {
  getActiveRunEventSink,
  runWithMandatoryRunEventSink,
} from "#veryfront/runtime/run-event-sink-context.ts";
import type { AgentRunEventSink } from "#veryfront/runtime/model-call-context.ts";
import { getRuntimeObservationWriterScope } from "#veryfront/runtime/runtime-observation-carrier.ts";
import { bindProjectEventWriter, createProjectEventWriter } from "./project-event-writer.ts";
import { createRuntimeAgentStreamResponse } from "./run-stream.ts";
import { AgentRunSessionManager } from "./session-manager.ts";

it("binds project runtime prompt context to its writer and revokes it on completion", async () => {
  const canonicalRunId = "55555555-5555-4555-8555-555555555555";
  const projectId = "66666666-6666-4666-8666-666666666666";
  const input = {
    runId: "project-observation-run",
    threadId: crypto.randomUUID(),
    messages: [],
    tools: [],
    context: [],
  };
  const writer = createProjectEventWriter({
    apiUrl: "https://api.veryfront.com",
    token: "test-token",
    ...input,
    canonicalRunId,
    projectId,
    latestEventId: 0,
    latestExternalEventSequence: 0,
  });
  bindProjectEventWriter(input, writer);
  let sink: AgentRunEventSink | undefined;
  let prompt = "";
  const response = await createRuntimeAgentStreamResponse(
    input,
    agent({
      id: "project-observation",
      model: "test/model",
      system: "Reply briefly.",
      skills: false,
      tools: {},
    }),
    {
      sessionManager: new AgentRunSessionManager(),
      createRuntime: () => ({
        stream: () => {
          sink = getActiveRunEventSink();
          prompt = buildAgentRunRuntimeContextPromptBlock(captureAgentRunRuntimeContext());
          return Promise.resolve(
            new ReadableStream<Uint8Array>({
              start(c) {
                c.close();
              },
            }),
          );
        },
      }),
    },
  );
  await response.text();
  assertStringIncludes(prompt, `run_id: ${canonicalRunId}`);
  assertEquals(getRuntimeObservationWriterScope(sink), {
    runId: input.runId,
    canonicalRunId,
    projectId,
  });
  assertEquals(captureAgentRunRuntimeContext().runId, undefined);
  assertThrows(() => runWithMandatoryRunEventSink(sink!, () => captureAgentRunRuntimeContext()));
});

it("includes the project canonical run id in a framework-dispatched model prompt", async () => {
  const { scriptedModel } = await import("#veryfront/agent/runtime/model-runtime.test-helpers.ts");
  const { withMockFetch } = await import("#veryfront/testing/mock-fetch.ts");
  const canonicalRunId = "55555555-5555-4555-8555-555555555555";
  const projectId = "66666666-6666-4666-8666-666666666666";
  const input = {
    runId: "project-prompt-run",
    threadId: crypto.randomUUID(),
    messages: [],
    tools: [],
    context: [],
  };
  const model = scriptedModel([{ text: "Verified." }], {
    modelId: "test/project-prompt",
    only: "stream",
  });
  let eventId = 0;
  await withMockFetch(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const events = body.events as Array<{ type: string; modelCallId?: string }>;
    eventId += events.length;
    return Response.json({
      run_id: canonicalRunId,
      latest_event_id: eventId,
      latest_external_event_sequence: eventId,
      appended_count: events.length,
      model_call_captures: events.filter((e) => e.type === "MODEL_CALL_CONTEXT").map((e) => ({
        event_id: String(eventId),
        model_call_id: e.modelCallId,
        run_id: canonicalRunId,
        project_id: projectId,
      })),
    });
  }, async () => {
    bindProjectEventWriter(
      input,
      createProjectEventWriter({
        apiUrl: "https://api.veryfront.com",
        token: "test-token",
        ...input,
        canonicalRunId,
        projectId,
        latestEventId: 0,
        latestExternalEventSequence: 0,
      }),
    );
    const response = await createRuntimeAgentStreamResponse(
      input,
      agent({
        id: "project-prompt",
        model: "test/project-prompt",
        system: "Reply briefly.",
        skills: false,
        tools: {},
        resolveModelTransport: () => ({ model }),
      }),
      { sessionManager: new AgentRunSessionManager() },
    );
    await response.text();
  });
  assertEquals(model.callCount, 1);
  assertStringIncludes(model.systemPrompts()[0]!, `run_id: ${canonicalRunId}`);
});

it("revokes a retained project observation sink immediately on abort", () => {
  const controller = new AbortController();
  const writer = createProjectEventWriter({
    apiUrl: "https://api.veryfront.com",
    token: "test-token",
    runId: "project-aborted-run",
    threadId: crypto.randomUUID(),
    canonicalRunId: "55555555-5555-4555-8555-555555555555",
    projectId: "66666666-6666-4666-8666-666666666666",
    latestEventId: 0,
    latestExternalEventSequence: 0,
  });
  const sink: AgentRunEventSink = async () => {};
  writer.bindSignal(controller.signal);
  writer.bindObservationSink(sink);
  controller.abort();
  assertThrows(() => runWithMandatoryRunEventSink(sink, () => captureAgentRunRuntimeContext()));
  writer.close();
});
