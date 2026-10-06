import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { defineSchema, type JsonValue } from "#veryfront/schemas/index.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  getCurrentToolCallOccurrence,
  getToolCallOccurrence,
  introduceToolCallOccurrence,
  runWithToolCallOccurrenceDispatch,
  runWithToolCallOccurrences,
} from "#veryfront/runtime/tool-call-occurrence.ts";
import {
  getCurrentToolCallAdmissionReceipt,
  runWithToolCallAdmissionReceipt,
} from "#veryfront/runtime/tool-call-admission-dispatch.ts";
import type { AgentRunToolCallAdmissionReceipt } from "#veryfront/runtime/tool-call-admission-receipt.ts";
import { createExecutorToolBroker } from "./executor-tool-bridge.ts";
import { createExecutorRemoteToolSources } from "./executor-tool-remote-facade.ts";
import { createExecutorChannel } from "../executor/channel.ts";
import { createManagedBrokerPersistence } from "./managed-broker-persistence.ts";
import { bindToolCallStartOccurrence } from "#veryfront/runtime/tool-call-occurrence.ts";
import {
  announceStreamedToolCallInput,
  createStreamState,
  processStream,
} from "../runtime/chat-stream-handler.ts";
import { createMockResult } from "../runtime/chat-stream-handler.test-helpers.ts";
import { createChatUiMessageStreamFromDataStream } from "../streaming/chat-ui-message-stream.ts";
import type { ChatUiMessageChunk } from "#veryfront/chat/types.ts";
import {
  bindObservedToolResultStart,
  isObservedToolResultStart,
} from "#veryfront/runtime/tool-call-occurrence-carrier.ts";
import { getExecutorDataEventSchema } from "../streaming/executor-data-schema.ts";
import {
  createRemoteMCPToolSource,
  createRemoteMCPToolSourceFactoryWithTransport,
} from "#veryfront/tool/remote-mcp.ts";
import type { RemoteToolSource } from "#veryfront/tool/types.ts";
import {
  bindHostedToolCallAdmissionWriter,
  createHostedRunEventWriterCapability,
  getHostedToolCallAdmissionRequestFetch,
} from "./child-run-event-writer-token.ts";

const occurrenceId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const receipt: AgentRunToolCallAdmissionReceipt = {
  occurrenceId,
  projectId,
  runId,
  toolCallId: "provider-call",
  publicToolCallId: "canonical-call-7",
  startEventId: "9007199254740993123",
  admissionEventId: "9007199254740993124",
};
const binding = { allocationId: "allocation", generation: 1, invocationId: "invocation" };
const call = {
  sourceId: "source",
  toolName: "lookup",
  args: {},
  toolCallId: receipt.toolCallId,
  occurrenceId,
};

type TestFetch = Exclude<Parameters<typeof withMockFetch>[0], undefined>;

function managedPersistenceFixture(fetch: TestFetch) {
  const terminalToken = `header.${
    btoa(JSON.stringify({
      runId: "external-run",
      canonicalRunId: runId,
      tokenUse: "run_event_writer",
      writerPurpose: "current_run_terminal",
      dispatchNonce: "generation",
    }))
  }.signature`;
  const persistence = createManagedBrokerPersistence({
    apiUrl: "https://api.example.test",
    runEventToken: "synthetic-append-token",
    completionAuthToken: "synthetic-completion-token",
    terminalAuthToken: terminalToken,
    run: {
      runId: "external-run",
      conversationId: projectId,
      messageId: occurrenceId,
      latestEventId: 0,
      latestExternalEventSequence: 0,
      waitingToolCallId: null,
      waitingToolName: null,
      status: "running",
      streamProtocolVersion: 2,
    },
    modelId: "synthetic-model",
    resolveProvider: () => "synthetic-provider",
    fetch,
    toolCallAdmissions: { projectId },
  });
  persistence.bindSessionOwnedWork((operation) => operation());
  return persistence;
}

function toolFixture(options: {
  admitToolCall?: Parameters<typeof createExecutorToolBroker>[0]["admitToolCall"];
  assertActive?: () => void;
  source?: RemoteToolSource;
} = {}) {
  let executions = 0;
  const observed: Array<Readonly<AgentRunToolCallAdmissionReceipt> | undefined> = [];
  const operations = createExecutorToolBroker({
    scope: {
      binding,
      signal: new AbortController().signal,
      assertActive: options.assertActive ?? (() => {}),
    },
    sources: new Map([["source", {
      source: {
        id: "source",
        async listTools() {
          return [];
        },
        async executeTool(toolName, args, context) {
          executions++;
          await Promise.resolve();
          observed.push(getCurrentToolCallAdmissionReceipt());
          if (options.source) return await options.source.executeTool(toolName, args, context);
          return { ok: true };
        },
      },
      allowedToolNames: new Set(["lookup"]),
      context: {},
    }]]),
    maxCalls: 16,
    maxConcurrent: 2,
    ...options,
  });
  const collect = async (request: JsonValue) => {
    const operation = operations.get("tool.execute")!;
    assert(operation.mode === "stream");
    const frames: JsonValue[] = [];
    for await (
      const frame of operation.handle(request, {
        binding,
        signal: new AbortController().signal,
        deadline: Date.now() + 10_000,
      })
    ) frames.push(frame);
    return frames;
  };
  return { collect, observed, executions: () => executions };
}

describe("private tool-call admission", () => {
  it("allocates by introduced call object and survives async wrappers without enumerable metadata", async () => {
    const first = { id: "reused" };
    const second = { id: "reused" };
    assertEquals(introduceToolCallOccurrence(first), undefined);
    await runWithToolCallOccurrences(async () => {
      const firstId = introduceToolCallOccurrence(first);
      const secondId = introduceToolCallOccurrence(second);
      assert(firstId && secondId && firstId !== secondId);
      assertEquals(Object.keys(first), ["id"]);
      await Promise.all(
        [first, second].map((call) =>
          runWithToolCallOccurrenceDispatch(call, async () => {
            await Promise.resolve();
            assertEquals(getCurrentToolCallOccurrence(), getToolCallOccurrence(call));
          })
        ),
      );
    });
    assertEquals(getCurrentToolCallOccurrence(), undefined);
  });

  it("strips the normal start sidecar from public chunks and finished message while retaining exact private association", async () => {
    const toolCall = { id: "provider-call", name: "lookup", arguments: "{}" };
    const stream = runWithToolCallOccurrences(() =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          announceStreamedToolCallInput(controller, new TextEncoder(), toolCall);
          announceStreamedToolCallInput(controller, new TextEncoder(), toolCall);
          controller.enqueue(new TextEncoder().encode('data: {"type":"message-finish"}\n\n'));
          controller.close();
        },
      })
    );
    let finished: unknown;
    const chunks: ChatUiMessageChunk[] = [];
    for await (
      const chunk of createChatUiMessageStreamFromDataStream({ stream }, {
        privateToolCallAdmissions: true,
        onFinish(value) {
          finished = value;
        },
      })
    ) chunks.push(chunk);
    const starts = chunks.filter((chunk) => chunk.type === "tool-input-start");
    assertEquals(starts.length, 1);
    assertEquals(getToolCallOccurrence(starts[0]!), getToolCallOccurrence(toolCall));
    assert(!JSON.stringify({ chunks, finished }).includes("privateToolCallOccurrence"));
    assert(!JSON.stringify({ chunks, finished }).includes(getToolCallOccurrence(toolCall)!));
  });

  it("persists result-only lifecycle observations without minting dispatch admission", async () => {
    const getAppendBodySchema = defineSchema((v) =>
      v.object({
        events: v.array(
          v.object({
            type: v.string(),
            providerExecuted: v.boolean().optional(),
            startObservedFromResult: v.literal(true).optional(),
          }).passthrough(),
        ),
        tool_call_starts: v.array(v.unknown()).optional(),
      }).passthrough()
    );
    const scenarios = ["configured-provider", "unflagged", "explicit-false"];
    for (
      const { scenario, type } of scenarios.flatMap((scenario) =>
        ["tool-result", "tool-error"].map((type) => ({ scenario, type }))
      )
    ) {
      const storedStarts: Array<{
        type: string;
        providerExecuted?: boolean;
        startObservedFromResult?: true;
      }> = [];
      let sequence = 0;
      const fetch: TestFetch = async (_url, init) => {
        const body = getAppendBodySchema().parse(JSON.parse(String(init?.body)));
        assertEquals(body.tool_call_starts, undefined);
        assert(!JSON.stringify(body).includes("privateObservedToolResult"));
        storedStarts.push(...body.events.filter((event) => event.type === "TOOL_CALL_START"));
        sequence += body.events.length;
        return Response.json({
          run_id: runId,
          latest_event_id: sequence,
          latest_external_event_sequence: sequence,
          appended_count: body.events.length,
        });
      };
      {
        const persistence = managedPersistenceFixture(fetch);
        const state = createStreamState();
        const stream = runWithToolCallOccurrences(() =>
          new ReadableStream<Uint8Array>({
            async start(controller) {
              await processStream(
                createMockResult([
                  {
                    type,
                    toolCallId: "provider-only-result",
                    toolName: "web_search",
                    ...(scenario === "explicit-false" ? { providerExecuted: false } : {}),
                    input: { query: "test" },
                    ...(type === "tool-result"
                      ? { output: { result: "test" } }
                      : { error: "test" }),
                  },
                  { type: "finish", finishReason: "stop", totalUsage: null },
                ]),
                state,
                controller,
                new TextEncoder(),
                "test",
                {
                  providerExecutedToolNames: scenario === "configured-provider"
                    ? ["web_search"]
                    : [],
                },
              );
              controller.enqueue(new TextEncoder().encode('data: {"type":"message-finish"}\n\n'));
              controller.close();
            },
          })
        );
        const chunks: ChatUiMessageChunk[] = [];
        let finished: unknown;
        for await (
          const chunk of createChatUiMessageStreamFromDataStream({ stream }, {
            privateToolCallAdmissions: true,
            onFinish(value) {
              finished = value;
            },
          })
        ) {
          chunks.push(chunk);
          await persistence.output.write(chunk);
        }
        const starts = chunks.filter((chunk) => chunk.type === "tool-input-start");
        assertEquals(starts.length, 1);
        assert(isObservedToolResultStart(starts[0]!));
        assertEquals(getToolCallOccurrence(starts[0]!), undefined);
        assertEquals(
          getToolCallOccurrence(state.toolCalls.get("provider-only-result")!),
          undefined,
        );
        assertEquals(storedStarts.length, 1);
        assertEquals(storedStarts[0]?.startObservedFromResult, true);
        assertEquals(
          state.toolCalls.get("provider-only-result")?.providerExecuted,
          scenario === "configured-provider"
            ? true
            : scenario === "explicit-false"
            ? false
            : undefined,
        );
        assertEquals(
          storedStarts[0]?.providerExecuted,
          scenario === "configured-provider" ? true : undefined,
        );
        assert(!JSON.stringify({ chunks, finished }).includes("privateObservedToolResult"));
        assert(!JSON.stringify({ chunks, finished }).includes("startObservedFromResult"));
        await persistence.cleanup();
      }
    }
  });

  it("never treats a public provider flag or conflicting private marker as dispatch admission", async () => {
    const start = {
      type: "tool-input-start" as const,
      toolCallId: "unbound-call",
      toolName: "web_search",
      providerExecuted: true,
    };
    let appends = 0;
    const fetch: TestFetch = async () => {
      appends++;
      throw new Error("Unexpected append");
    };
    const persistence = managedPersistenceFixture(fetch);
    await assertRejects(
      () => persistence.output.write(start),
      TypeError,
      "no exact private occurrence",
    );
    assertEquals(appends, 0);
    await persistence.cleanup();
    assertEquals(
      getExecutorDataEventSchema().safeParse({
        ...start,
        privateObservedToolResult: true,
        privateToolCallOccurrenceId: occurrenceId,
      }).success,
      false,
    );
    for (const providerExecuted of [undefined, false, true]) {
      assertEquals(
        getExecutorDataEventSchema().safeParse({
          ...start,
          providerExecuted,
          privateObservedToolResult: true,
        }).success,
        true,
      );
    }
    bindObservedToolResultStart(start);
    assertThrows(() => bindToolCallStartOccurrence(start, occurrenceId), TypeError);
    const admitted = { id: "admitted-call" };
    bindToolCallStartOccurrence(admitted, occurrenceId);
    assertThrows(() => bindObservedToolResultStart(admitted), TypeError);
  });

  it("pins private proof to owning endpoints and scrubs caller selectors from list and other transports", async () => {
    const owning = [
      "https://api.example.test/prefix/mcp",
      `https://api.example.test/prefix/projects/${projectId}/mcp`,
    ];
    const other = [
      "https://other.example.test/prefix/mcp",
      "https://api.example.test/prefix/mcp/",
      `https://api.example.test/prefix/projects/${occurrenceId}/mcp`,
      "https://api.example.test/prefix/mcp?query=caller",
    ];
    const privateRequests: Request[] = [];
    const configuredRequests: Request[] = [];
    const responseFor: TestFetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: body.method === "tools/list" ? { tools: [] } : { structuredContent: { ok: true } },
      });
    };
    const capability = createHostedRunEventWriterCapability({
      apiUrl: "https://api.example.test/prefix",
      runId: "external-run",
      canonicalRunId: runId,
      runEventAppendToken: "synthetic-private-writer-token",
      fetch: (url, init) => {
        privateRequests.push(new Request(url, init));
        return responseFor(url, init);
      },
    });
    const callback = async () => receipt;
    bindHostedToolCallAdmissionWriter(callback, {
      capability,
      expectedRunId: "external-run",
      projectId,
    });
    const createSource = createRemoteMCPToolSourceFactoryWithTransport({
      trustedEndpoints: [...owning, ...other.slice(0, -1)],
      requestFetch: (url, init) => {
        configuredRequests.push(new Request(url, init));
        return responseFor(url, init);
      },
    });
    let retainedFetch: TestFetch | undefined;
    await runWithToolCallAdmissionReceipt(receipt, () => {}, async () => {
      for (const endpoint of [...owning, ...other]) {
        const source = createSource({
          endpoint,
          headers: {
            Authorization: "Bearer synthetic-application-token",
            "X-Veryfront-Run-Event-Writer-Token": "forged-caller-token",
          },
          listMeta: { tool_call_admission: receipt, ordinary: "kept" },
        });
        await source.listTools();
        if (other.slice(1).includes(endpoint)) {
          await assertRejects(
            () => source.executeTool("lookup", {}, { runId: "forged-caller-run" }),
            Error,
            "exact owning MCP endpoint",
          );
        } else {
          await source.executeTool("lookup", {}, { runId: "forged-caller-run" });
        }
      }
      retainedFetch = getHostedToolCallAdmissionRequestFetch(owning[0]!);
    }, callback);
    assertEquals(privateRequests.map((request) => request.url), owning);
    for (const request of privateRequests) {
      assertEquals(
        request.headers.get("X-Veryfront-Run-Event-Writer-Token"),
        "synthetic-private-writer-token",
      );
      assertEquals(request.headers.get("Authorization"), "Bearer synthetic-application-token");
      const body = await request.json();
      assertEquals(body.params._meta.run_id, "external-run");
      assertEquals(
        body.params._meta.tool_call_admission.admission_event_id,
        receipt.admissionEventId,
      );
    }
    assertEquals(configuredRequests.length, owning.length + other.length + 1);
    for (const request of configuredRequests) {
      assertEquals(request.headers.get("X-Veryfront-Run-Event-Writer-Token"), null);
      const body = await request.json();
      assertEquals(body.params?._meta?.tool_call_admission, undefined);
      if (body.method === "tools/list") assertEquals(body.params._meta.ordinary, "kept");
    }
    assert(
      !JSON.stringify({ capability, receipt, callback }).includes("synthetic-private-writer-token"),
    );
    assert(retainedFetch);
    await assertRejects(
      () => retainedFetch!(owning[0]!, { method: "POST", body: "{}" }),
      TypeError,
      "no longer current",
    );
    assertEquals(privateRequests.length, 2);
    for (
      const wrong of [{ ...receipt, projectId: occurrenceId }, { ...receipt, runId: projectId }]
    ) {
      await assertRejects(
        () =>
          runWithToolCallAdmissionReceipt(wrong, () => {}, async () => {
            getHostedToolCallAdmissionRequestFetch(owning[0]!);
          }, callback),
        TypeError,
        "does not match",
      );
    }
    const controller = new AbortController();
    controller.abort();
    await runWithToolCallAdmissionReceipt(receipt, () => {}, async () => {
      const dispatch = getHostedToolCallAdmissionRequestFetch(owning[0]!);
      assert(dispatch);
      await assertRejects(() =>
        dispatch(owning[0]!, { method: "POST", body: "{}", signal: controller.signal })
      );
    }, callback);
    assertEquals(privateRequests.length, 2);
  });

  it("fails before source execution for missing occurrence and mismatched acknowledgments", async () => {
    for (const request of [{ ...call, occurrenceId: undefined }, call]) {
      const f = toolFixture({ admitToolCall: async () => ({ ...receipt, toolCallId: "other" }) });
      const frames = await f.collect(JSON.parse(JSON.stringify(request)));
      assertEquals(frames, [{ type: "failure", code: "DURABLE_RUN_EVENT_PERSISTENCE_FAILED" }]);
      assertEquals(f.executions(), 0);
    }
  });

  it("awaits acknowledgment, rechecks revoked scope and never dispatches while pending", async () => {
    const pending = Promise.withResolvers<AgentRunToolCallAdmissionReceipt>();
    let active = true;
    const f = toolFixture({
      admitToolCall: () => pending.promise,
      assertActive() {
        if (!active) throw new TypeError("Revoked");
      },
    });
    const work = f.collect(call);
    await Promise.resolve();
    assertEquals(f.executions(), 0);
    active = false;
    pending.resolve(receipt);
    await assertRejects(() => work, TypeError, "Revoked");
    assertEquals(f.executions(), 0);
  });

  it("pins the exact acknowledged receipt only inside dispatch and leaves legacy mode unchanged", async () => {
    const f = toolFixture({ admitToolCall: async () => receipt });
    assertEquals(await f.collect(call), [{ type: "result", result: { ok: true } }]);
    assertEquals(f.observed, [receipt]);
    assertEquals(getCurrentToolCallAdmissionReceipt(), undefined);
    const legacy = toolFixture();
    assertEquals(await legacy.collect({ sourceId: "source", toolName: "lookup", args: {} }), [
      { type: "result", result: { ok: true } },
    ]);
    assertEquals(legacy.observed, [undefined]);
  });

  it("carries each exact occurrence through the actual remote facade and ignores forged caller correlation", async () => {
    const seen: string[] = [];
    const pending = new Map<string, AgentRunToolCallAdmissionReceipt>();
    const source = {
      id: "source",
      async listTools() {
        return [{
          name: "lookup",
          description: "Synthetic lookup",
          parameters: { type: "object" as const },
        }];
      },
      async executeTool() {
        seen.push(getCurrentToolCallAdmissionReceipt()!.occurrenceId);
        return null;
      },
    };
    const operations = createExecutorToolBroker({
      scope: { binding, signal: new AbortController().signal, assertActive() {} },
      sources: new Map([["source", {
        source,
        allowedToolNames: new Set(["lookup"]),
        context: {},
      }]]),
      maxCalls: 16,
      maxConcurrent: 2,
      async admitToolCall(call) {
        const value = pending.get(call.occurrenceId)!;
        assertEquals(call.toolCallId, value.toolCallId);
        await Promise.resolve();
        return value;
      },
    });
    const forward = new TransformStream<Uint8Array, Uint8Array>();
    const backward = new TransformStream<Uint8Array, Uint8Array>();
    const caller = createExecutorChannel({
      binding,
      transport: { readable: backward.readable, writable: forward.writable },
    });
    const broker = createExecutorChannel({
      binding,
      operations,
      transport: { readable: forward.readable, writable: backward.writable },
    });
    try {
      const sources = await createExecutorRemoteToolSources({ channel: caller });
      const calls = [{ id: "same-provider-id" }, { id: "same-provider-id" }];
      await runWithToolCallOccurrences(async () => {
        for (const [index, call] of calls.entries()) {
          const occurrenceId = introduceToolCallOccurrence(call)!;
          pending.set(occurrenceId, {
            ...receipt,
            occurrenceId,
            toolCallId: call.id,
            admissionEventId: `admission-${index}`,
            startEventId: `start-${index}`,
          });
        }
        await Promise.all(calls.map((call) =>
          runWithToolCallOccurrenceDispatch(call, async () => {
            await Promise.resolve();
            await sources[0]!.executeTool("lookup", {}, { toolCallId: "forged-caller-id" });
          })
        ));
      });
      assertEquals(new Set(seen), new Set(pending.keys()));
      assertEquals(seen.length, 2);
    } finally {
      caller.close();
      await broker.closed;
    }
  });

  it("awaits one normal start and sends exact proof with independent auth through owning host transport", async () => {
    let appendCount = 0;
    let mcpCalls = 0;
    const fetch: TestFetch = async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(url) === "https://api.example.test/mcp") {
        mcpCalls++;
        assertEquals(init?.redirect, "error");
        const headers = new Headers(init?.headers);
        assertEquals(headers.get("Authorization"), "Bearer synthetic-application-token");
        assertEquals(headers.get("X-Veryfront-Run-Event-Writer-Token"), "synthetic-append-token");
        assertEquals(body.params._meta, {
          run_id: "external-run",
          tool_call_admission: {
            occurrence_id: occurrenceId,
            project_id: projectId,
            run_id: runId,
            tool_call_id: receipt.toolCallId,
            public_tool_call_id: receipt.publicToolCallId,
            admission_event_id: receipt.admissionEventId,
            start_event_id: receipt.startEventId,
          },
        });
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { structuredContent: { ok: true } },
        });
      }
      appendCount++;
      assertEquals(
        body.events.filter((event: { type: string }) => event.type === "TOOL_CALL_START").length,
        1,
      );
      assertEquals(body.tool_call_starts, [{ occurrence_id: occurrenceId, event_index: 0 }]);
      return Response.json({
        run_id: runId,
        latest_event_id: 2,
        latest_external_event_sequence: body.events.length,
        appended_count: body.events.length,
        tool_call_admissions: [{
          occurrence_id: occurrenceId,
          project_id: projectId,
          run_id: runId,
          tool_call_id: receipt.toolCallId,
          public_tool_call_id: receipt.publicToolCallId,
          admission_event_id: receipt.admissionEventId,
          start_event_id: receipt.startEventId,
        }],
      });
    };
    {
      const terminalToken = `header.${
        btoa(
          JSON.stringify({
            runId: "external-run",
            canonicalRunId: runId,
            tokenUse: "run_event_writer",
            writerPurpose: "current_run_terminal",
            dispatchNonce: "generation",
          }),
        )
      }.signature`;
      const persistence = createManagedBrokerPersistence({
        apiUrl: "https://api.example.test",
        runEventToken: "synthetic-append-token",
        completionAuthToken: "synthetic-completion-token",
        terminalAuthToken: terminalToken,
        run: {
          runId: "external-run",
          conversationId: projectId,
          messageId: occurrenceId,
          latestEventId: 0,
          latestExternalEventSequence: 0,
          waitingToolCallId: null,
          waitingToolName: null,
          status: "running",
          streamProtocolVersion: 2,
        },
        modelId: "synthetic-model",
        resolveProvider: () => "synthetic-provider",
        fetch,
        toolCallAdmissions: { projectId },
      });
      persistence.bindSessionOwnedWork((operation) => operation());
      const f = toolFixture({
        admitToolCall: persistence.admitToolCall,
        source: createRemoteMCPToolSource({
          endpoint: "https://api.example.test/mcp",
          headers: {
            Authorization: "Bearer synthetic-application-token",
            "X-Veryfront-Run-Event-Writer-Token": "forged-caller-writer-token",
          },
        }),
      });
      const work = f.collect(call);
      await Promise.resolve();
      assertEquals(f.executions(), 0);
      const chunk = {
        type: "tool-input-start" as const,
        toolCallId: receipt.toolCallId,
        toolName: "lookup",
      };
      bindToolCallStartOccurrence(chunk, occurrenceId);
      await persistence.output.write(chunk);
      assertEquals(await work, [{ type: "result", result: { ok: true } }]);
      assertEquals(appendCount, 1);
      assertEquals(mcpCalls, 1);
      assertEquals(f.executions(), 1);
      assertEquals(f.observed, [receipt]);
      await assertRejects(
        () => persistence.admitToolCall!(call, new AbortController().signal),
        Error,
        "already dispatched",
      );
      await persistence.cleanup();
    }
  });
});
