import "#veryfront/schemas/_test-setup.ts";
import {
  createHostedConversationRunChunkMirrorFromCapability,
  createHostedRunEventWriterCapability,
  runWithHostedRunEventWriterCapability,
} from "./child-run-event-writer-token.ts";
import { createTerminalRunControl } from "#veryfront/agent/runtime/terminal-run-control.ts";
import { bindRuntimeRemoteToolSourcesToCredentialOwner } from "#veryfront/agent/runtime/mcp-server-tool-sources.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";
import type { RemoteMCPToolSourceConfig } from "#veryfront/tool/remote-mcp.ts";
import type { RemoteToolSource, ToolExecutionContext } from "#veryfront/tool/types.ts";
import {
  acceptInheritedRunAdmission,
  acceptWorkflowInheritedRunAdmission,
  hostedAcceptedChildEvidence,
  hostedInheritedRootRunId,
  hostedInheritedTaskInput,
  hostedInheritedTerminalReceipt,
  hostedTerminalToolSourceFactory,
  registerHostedTerminalCredential,
  RUN_TERMINAL_TOKEN_HEADER,
  RUN_TERMINAL_TOOL_CALL_ID_HEADER,
} from "./terminal-credential.ts";

import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { encodeHostedTaskInput, type HostedTaskInput } from "./task-input.ts";

const rootContext = () => createTerminalRunControl({ runId: "run-1" }).context;

const request = () =>
  ({
    projectId: "project-1",
    durableRootRun: { runId: "run-1" },
  }) as ParsedHostedChatRequest;

function recorder() {
  const calls: Array<{ endpoint: unknown; headers: Headers; name: string; args: unknown }> = [];
  const fallback = (config: RemoteMCPToolSourceConfig): RemoteToolSource => ({
    id: config.id ?? "platform",
    listTools: async () => [{
      name: "ordinary",
      description: "ordinary",
      parameters: { type: "object", properties: {} },
    }],
    executeTool: async (name, args, context) => {
      const headers = typeof config.headers === "function"
        ? await config.headers(context)
        : config.headers;
      const endpoint = typeof config.endpoint === "function"
        ? await config.endpoint(context)
        : config.endpoint;
      calls.push({ endpoint, headers: new Headers(headers), name, args });
      return { accepted: true };
    },
  });
  return { calls, fallback };
}

describe("private terminal credential routing", () => {
  it("does not activate terminal authority for an unbound or invalid request", () => {
    const { fallback } = recorder();
    assertEquals(
      hostedTerminalToolSourceFactory(undefined, "https://api.example/mcp", fallback),
      fallback,
    );
    for (
      const [value, token] of [
        [request(), undefined],
        [request(), ""],
        [request(), "x".repeat(16385)],
        [{ durableRootRun: { runId: "run-1" } }, "test-authority"],
        [{ projectId: "project-1" }, "test-authority"],
      ] as const
    ) {
      registerHostedTerminalCredential(value as ParsedHostedChatRequest, token);
      assertEquals(
        hostedTerminalToolSourceFactory(
          value as ParsedHostedChatRequest,
          "https://api.example/mcp",
          fallback,
        ),
        fallback,
      );
    }
  });

  for (const asyncHeaders of [false, true]) {
    it(`pins finalize to its bound project while preserving ordinary routing; asyncHeaders=${asyncHeaders}`, async () => {
      const value = request();
      registerHostedTerminalCredential(value, "test-authority");
      assert(!JSON.stringify(value).includes("test-authority"));
      const { calls, fallback } = recorder();
      const original = { Authorization: "Bearer test-invocation" };
      const factory = hostedTerminalToolSourceFactory(value, "https://api.example/mcp", fallback);
      const source = factory({
        id: "custom-platform",
        endpoint: () => "https://active.example/mcp",
        headers: asyncHeaders ? async () => original : original,
      }, { kind: "veryfront-api" });
      assertEquals(source.id, "custom-platform");
      assertEquals((await source.listTools()).map((tool) => tool.name), ["ordinary"]);
      for (
        const name of [
          "finalize",
          "veryfront__finalize",
          "succeed_run",
          "veryfront__succeed_run",
          "fail_run",
          "veryfront__fail_run",
        ]
      ) {
        await source.executeTool(name, {}, rootContext());
        const call = calls.at(-1)!;
        assertEquals(call.endpoint, "https://api.example/projects/project-1/mcp");
        assertEquals(call.headers.get(RUN_TERMINAL_TOKEN_HEADER), "test-authority");
        assertEquals(call.headers.get("Authorization"), original.Authorization);
      }
      for (const context of [{ runId: "run-other" }, { runId: "run-1" }]) {
        await source.executeTool("ordinary", {}, context);
        assertEquals(calls.at(-1)!.endpoint, "https://active.example/mcp");
        assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOKEN_HEADER), null);
      }
      await source.executeTool("finalize", {}, { runId: "run-other" });
      assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOKEN_HEADER), null);
      await source.executeTool("finalize", {}, undefined);
      assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOKEN_HEADER), null);
      assertEquals(Object.keys(original), ["Authorization"]);
    });
  }

  it("names the finalize call beside its terminal credential so the API can close it", async () => {
    const value = request();
    registerHostedTerminalCredential(value, "test-authority");
    const { calls, fallback } = recorder();
    const source = hostedTerminalToolSourceFactory(value, "https://api.example/mcp", fallback)(
      { id: "platform", endpoint: "https://active.example/mcp" },
      { kind: "veryfront-api" },
    );
    await source.executeTool("veryfront__finalize", {}, {
      ...rootContext(),
      toolCallId: "call_fin",
    });
    assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOOL_CALL_ID_HEADER), "call_fin");
    const key = calls.at(-1)!.headers.get("Idempotency-Key");
    assertEquals(key!.length, 64);
    await source.executeTool("veryfront__finalize", {}, {
      ...rootContext(),
      toolCallId: "call_fin",
    });
    assertEquals(calls.at(-1)!.headers.get("Idempotency-Key"), key);
    await source.executeTool("finalize", {}, { runId: "run-other", toolCallId: "call_fin" });
    assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOOL_CALL_ID_HEADER), null);
    await source.executeTool("ordinary", {}, { runId: "run-1", toolCallId: "call_other" });
    assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOOL_CALL_ID_HEADER), null);
    for (const context of [rootContext(), { ...rootContext(), toolCallId: "call\nfin" }]) {
      await source.executeTool("finalize", {}, context);
      assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOKEN_HEADER), "test-authority");
      assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOOL_CALL_ID_HEADER), null);
    }
  });

  it("withholds root authority from an in-process delegate despite credential-owner rebinding", async () => {
    const value = request();
    registerHostedTerminalCredential(value, "test-authority");
    const { calls, fallback } = recorder();
    const source = hostedTerminalToolSourceFactory(value, "https://api.example/mcp", fallback)(
      { endpoint: "https://api.example/mcp" },
      { kind: "veryfront-api" },
    );
    const root = rootContext();
    const child = createTerminalRunControl({ runId: "run-child" }).context;
    const inherited = bindRuntimeRemoteToolSourcesToCredentialOwner([source], root)![0]!;
    const unowned = bindRuntimeRemoteToolSourcesToCredentialOwner([source], {
      runId: "run-1",
    })![0]!;
    await unowned.executeTool("finalize", {}, root);
    assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOKEN_HEADER), null);
    const grandchild = createTerminalRunControl({ runId: "run-grandchild" }).context;
    const deepInherited = bindRuntimeRemoteToolSourcesToCredentialOwner([inherited], child)![0]!;
    for (
      const name of [
        "finalize",
        "veryfront__finalize",
        "succeed_run",
        "veryfront__succeed_run",
        "fail_run",
        "veryfront__fail_run",
      ]
    ) {
      await deepInherited.executeTool(name, {}, grandchild);
      assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOKEN_HEADER), null);
      await inherited.executeTool(name, {
        status: "failed",
        error: { code: "FAILED", message: "Failed" },
      }, child);
      assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOKEN_HEADER), null);
      await source.executeTool(name, {}, root);
      assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOKEN_HEADER), "test-authority");
    }
  });

  it("binds canonical run admission to the current durable parent and tool invocation", async () => {
    const value = request();
    const canonicalRunId = "33333333-3333-4333-8333-333333333333";
    const token = `header.${
      btoa(JSON.stringify({
        tokenUse: "run_event_writer",
        writerPurpose: "current_run_terminal",
        runId: "run-1",
        canonicalRunId,
        dispatchNonce: "dispatch-1",
      }))
    }.signature`;
    registerHostedTerminalCredential(value, token);
    const { calls, fallback } = recorder();
    const capability = createHostedRunEventWriterCapability({
      apiUrl: "https://api.example",
      runId: "run-1",
      canonicalRunId,
      runEventAppendToken: "synthetic-event-authority",
      inheritedAdmitter: () => async () => {
        throw new Error("Ordinary admission retains its transport");
      },
      fetch: (async () =>
        Response.json({
          run_id: canonicalRunId,
          latest_event_id: 1,
          latest_external_event_sequence: 1,
          appended_count: 1,
        })) as typeof fetch,
    });
    const mirror = createHostedConversationRunChunkMirrorFromCapability(capability, {
      expectedRunId: "run-1",
      conversationId: "11111111-1111-4111-8111-111111111111",
      latestEventId: 0,
      latestExternalEventSequence: 0,
    })!;
    await mirror.handleChunk({
      type: "tool-input-start",
      toolCallId: "call-task",
      toolName: "create_run",
    });
    const source = runWithHostedRunEventWriterCapability(
      capability,
      () =>
        hostedTerminalToolSourceFactory(value, "https://api.example/mcp", fallback)(
          { endpoint: "https://active.example/mcp" },
          { kind: "veryfront-api" },
        ),
    );

    const args = {
      input: {
        project_id: "project-1",
        target: { type: "task", id: "echo" },
        input: { marker: "ok" },
      },
      idempotency_key: "task-once",
    };
    for (const name of ["create_run", "veryfront__create_run"]) {
      await source.executeTool(name, args, { ...rootContext(), toolCallId: "call-task" });
      assertEquals(calls.at(-1)!.args, {
        ...args,
        input: { ...args.input, parent_run_id: canonicalRunId, tool_call_id: "call-task" },
      });
      assertEquals(calls.at(-1)!.headers.get(RUN_TERMINAL_TOKEN_HEADER), null);
    }
    assertEquals(args.input, {
      project_id: "project-1",
      target: { type: "task", id: "echo" },
      input: { marker: "ok" },
    });
    for (
      const context of [{ runId: "run-1", toolCallId: "unowned" }, {
        ...rootContext(),
        runId: "run-other",
        toolCallId: "other",
      }]
    ) {
      await source.executeTool("create_run", args, context);
      assertEquals(calls.at(-1)!.args, args);
    }
    mirror.dispose();
  });

  for (const name of ["create_run", "veryfront__create_run"]) {
    it(`waits for durable tool start before forwarding ${name}`, async () => {
      const value = request();
      const token = `header.${
        btoa(JSON.stringify({
          tokenUse: "run_event_writer",
          writerPurpose: "current_run_terminal",
          runId: "run-1",
          canonicalRunId: "33333333-3333-4333-8333-333333333333",
          dispatchNonce: "dispatch-1",
        }))
      }.signature`;
      registerHostedTerminalCredential(value, token);
      let acknowledge!: () => void;
      const acknowledgement = new Promise<void>((resolve) => {
        acknowledge = resolve;
      });
      let cursor = 0;
      const capability = createHostedRunEventWriterCapability({
        apiUrl: "https://api.example",
        runId: "run-1",
        canonicalRunId: "33333333-3333-4333-8333-333333333333",
        runEventAppendToken: "synthetic-event-authority",
        inheritedAdmitter: () => async () => {
          throw new Error("Ordinary admission must retain its transport");
        },
        fetch: (async (_url, init) => {
          assert(init && "body" in init, "fetch must receive request options");
          await acknowledgement;
          const count =
            JSON.parse(String(init && "body" in init ? init.body : undefined)).events.length;
          cursor += count;
          return Response.json({
            run_id: "33333333-3333-4333-8333-333333333333",
            latest_event_id: cursor,
            latest_external_event_sequence: cursor,
            appended_count: count,
          });
        }) as typeof fetch,
      });
      const mirror = createHostedConversationRunChunkMirrorFromCapability(capability, {
        expectedRunId: "run-1",
        conversationId: "11111111-1111-4111-8111-111111111111",
        latestEventId: 0,
        latestExternalEventSequence: 0,
      })!;
      const { calls, fallback } = recorder();
      const factory = runWithHostedRunEventWriterCapability(
        capability,
        () => hostedTerminalToolSourceFactory(value, "https://api.example/mcp", fallback),
      );
      // Project routing can assemble its actual source after the private setup scope ends.
      const source = factory({ endpoint: "https://active.example/mcp" }, { kind: "veryfront-api" });
      const admission = source.executeTool(name, {
        input: { target: { type: "task", id: "echo" } },
      }, { ...rootContext(), toolCallId: "call-task" });
      let persistence: Promise<void> | undefined;
      try {
        await Promise.resolve();
        assertEquals(calls.length, 0);
        persistence = mirror.handleChunk({
          type: "tool-input-start",
          toolCallId: "call-task",
          toolName: name,
        });
        await Promise.resolve();
        assertEquals(calls.length, 0);
        acknowledge();
        await persistence;
        await admission;
        assertEquals(calls.length, 1);
        assertEquals(
          (calls[0]!.args as { input: { tool_call_id: string } }).input.tool_call_id,
          "call-task",
        );
      } finally {
        acknowledge();
        await persistence?.catch(() => {});
        mirror.dispose();
        await admission.catch(() => {});
      }
    });
  }

  for (const parent of [undefined, "run-other"]) {
    it(`rejects admission without exact parent persistence authority: ${parent ?? "missing"}`, async () => {
      const value = request();
      const token = `header.${
        btoa(
          JSON.stringify({
            tokenUse: "run_event_writer",
            writerPurpose: "current_run_terminal",
            runId: "run-1",
            canonicalRunId: "33333333-3333-4333-8333-333333333333",
            dispatchNonce: "dispatch-1",
          }),
        )
      }.signature`;
      registerHostedTerminalCredential(value, token);
      const capability = parent
        ? createHostedRunEventWriterCapability({
          apiUrl: "https://api.example",
          runId: parent,
          runEventAppendToken: "synthetic-other-authority",
        })
        : undefined;
      const { calls, fallback } = recorder();
      const source = runWithHostedRunEventWriterCapability(
        capability,
        () =>
          hostedTerminalToolSourceFactory(value, "https://api.example/mcp", fallback)({
            endpoint: "https://active.example/mcp",
          }, { kind: "veryfront-api" }),
      );
      await assertRejects(
        () =>
          source.executeTool("create_run", { input: { target: { type: "task", id: "echo" } } }, {
            ...rootContext(),
            toolCallId: "call-task",
          }),
        Error,
        "Parent tool start persistence authority is required",
      );
      assertEquals(calls.length, 0);
    });
  }

  it("never forwards terminal credentials to a non-platform source", async () => {
    const value = request();
    registerHostedTerminalCredential(value, "test-authority");
    const { calls, fallback } = recorder();
    const factory = hostedTerminalToolSourceFactory(value, "https://api.example/mcp", fallback);
    const source = factory({ endpoint: "https://third-party.example/mcp" });
    await source.executeTool(
      "veryfront__finalize",
      {},
      { runId: "run-1" } as ToolExecutionContext,
    );
    assertEquals(calls[0]!.endpoint, "https://third-party.example/mcp");
    assertEquals(calls[0]!.headers.get(RUN_TERMINAL_TOKEN_HEADER), null);
  });
});

const inheritedParentId = "33333333-3333-4333-8333-333333333333";
const inheritedChildId = "44444444-4444-4444-8444-444444444444";
const inheritedConversationId = "55555555-5555-4555-8555-555555555555";
const inheritedToken = `header.${
  btoa(JSON.stringify({
    tokenUse: "run_event_writer",
    writerPurpose: "current_run_terminal",
    runId: "child-run",
    canonicalRunId: inheritedChildId,
    dispatchNonce: "child-dispatch",
  }))
}.signature`;

function inheritedExecutionResponse(
  value: Record<string, unknown> = {},
  headers: Record<string, string> = {},
  status = 202,
) {
  return Response.json({
    version: 1,
    projectId: "project-1",
    parentRunId: inheritedParentId,
    agentId: "child",
    canonicalRunId: inheritedChildId,
    dispatchNonce: "child-dispatch",
    conversationId: inheritedConversationId,
    outputMessageId: "66666666-6666-4666-8666-666666666666",
    status: "running",
    ...value,
  }, {
    status,
    headers: {
      "Content-Type": "application/vnd.veryfront.inherited-run+json",
      "Cache-Control": "no-store",
      [RUN_TERMINAL_TOKEN_HEADER]: inheritedToken,
      "X-Veryfront-Run-Invocation-Token": "child-auth",
      "X-Veryfront-Run-Renewal-Token": "child-renewal",
      "X-Veryfront-Run-Event-Token": "child-writer",
      "X-Veryfront-Run-Event-Sequence": "0",
      "X-Veryfront-Run-External-Event-Sequence": "0",
      ...headers,
    },
  });
}

function inheritedBinding(
  fetch: typeof globalThis.fetch = () => Promise.reject(new Error("Unexpected fetch")),
) {
  return {
    projectId: "project-1",
    parentRunId: inheritedParentId,
    agentId: "child",
    apiUrl: "https://api.example/v1/",
    fetch,
  };
}

describe("inherited execution input and receipt authority", () => {
  it("restores immutable task input only from exact admission and signed writer binding", async () => {
    const taskInput: HostedTaskInput = {
      version: 1,
      projectId: "project-1",
      rootRunId: "root-run",
      runId: "child-run",
      payload: { record: { path: "note.txt" } },
    };
    const digest = await computeHash(encodeHostedTaskInput(taskInput));
    const verification = {
      verified: true as const,
      rootRunId: "root-run",
      taskInputRootRunId: "root-run",
      taskInputSha256: digest,
    };
    const binding = { ...inheritedBinding(), verifyRunEventAppendToken: async () => verification };
    const run = await acceptInheritedRunAdmission(
      inheritedExecutionResponse({ taskInput }),
      binding,
    );
    assertEquals(run.runId, "child-run");
    const restored = hostedInheritedTaskInput(run, "project-1");
    assertEquals(restored, taskInput);
    assert(Object.isFrozen(restored));
    assert(Object.isFrozen(restored?.payload.record));
    assertEquals(hostedInheritedRootRunId(run, "project-1"), "root-run");
    assertEquals(hostedInheritedTaskInput({ ...run }, "project-1"), undefined);
    assertEquals(hostedInheritedRootRunId({ ...run }, "project-1"), undefined);
    assertThrows(() => hostedInheritedTaskInput(run, "foreign"), Error, "project mismatch");
    assertThrows(() => hostedInheritedRootRunId(run, "foreign"), Error, "project mismatch");
    const plain = await acceptInheritedRunAdmission(
      inheritedExecutionResponse(),
      inheritedBinding(),
    );
    assertEquals(hostedInheritedTaskInput(plain, "project-1"), undefined);
    for (
      const proof of [false, { ...verification, verified: false }, {
        ...verification,
        taskInputRootRunId: "foreign-root",
      }, { ...verification, taskInputSha256: "wrong" }]
    ) {
      await assertRejects(
        () =>
          acceptInheritedRunAdmission(inheritedExecutionResponse({ taskInput }), {
            ...inheritedBinding(),
            verifyRunEventAppendToken: async () => proof,
          }),
        Error,
        "signed binding mismatch",
      );
    }
    await assertRejects(
      () => acceptInheritedRunAdmission(inheritedExecutionResponse(), binding),
      Error,
      "signed binding mismatch",
    );
    await assertRejects(() =>
      acceptInheritedRunAdmission(
        inheritedExecutionResponse({ taskInput: { ...taskInput, projectId: "foreign" } }),
        binding,
      )
    );
  });

  it("rejects inherited envelopes with conflicting identity, generation or resource scope", async () => {
    for (
      const patch of [
        { version: 2 },
        { parentRunId: inheritedChildId },
        { projectId: "foreign" },
        { agentId: "other" },
        { canonicalRunId: inheritedParentId },
        { dispatchNonce: "old-generation" },
        { conversationId: "not-uuid" },
        { outputMessageId: null },
        { status: "unknown" },
        { status: "completed" },
        { error: { code: 1, message: "bad" } },
      ]
    ) {
      await assertRejects(
        () => acceptInheritedRunAdmission(inheritedExecutionResponse(patch), inheritedBinding()),
        Error,
        "binding mismatch",
      );
    }
    for (
      const headers of [
        { "Cache-Control": "public" } as Record<string, string>,
        { [RUN_TERMINAL_TOKEN_HEADER]: "malformed" },
      ]
    ) {
      await assertRejects(
        () =>
          acceptInheritedRunAdmission(inheritedExecutionResponse({}, headers), inheritedBinding()),
        Error,
        "binding mismatch",
      );
    }
    await assertRejects(
      () =>
        acceptInheritedRunAdmission(inheritedExecutionResponse({}, {}, 403), inheritedBinding()),
      Error,
      "binding mismatch",
    );
    await assertRejects(
      () =>
        acceptInheritedRunAdmission(
          new Response("bad-json", {
            headers: { "Content-Type": "application/vnd.veryfront.inherited-run+json" },
          }),
          inheritedBinding(),
        ),
      Error,
      "binding mismatch",
    );
    await assertRejects(
      () =>
        acceptInheritedRunAdmission(inheritedExecutionResponse(), {
          ...inheritedBinding(),
          conversationId: inheritedParentId,
        }),
      Error,
      "binding mismatch",
    );
  });

  it("retains terminal receipts without restoring execution authority", async () => {
    for (const status of ["completed", "failed", "cancelled"] as const) {
      const error = status === "failed" ? { code: "CHILD_FAILED", message: "Failure" } : undefined;
      const response = () =>
        inheritedExecutionResponse({
          status,
          output: { saved: true },
          ...(error ? { error } : {}),
        });
      const workflow = await acceptWorkflowInheritedRunAdmission(response(), inheritedBinding());
      assertEquals(workflow, {
        terminalReceipt: { status, output: { saved: true }, ...(error ? { error } : {}) },
      });
      assertEquals(hostedInheritedTaskInput(workflow as { runId: string }, "project-1"), undefined);
      const run = await acceptInheritedRunAdmission(response(), inheritedBinding());
      assertEquals(hostedInheritedTerminalReceipt(run), {
        status,
        output: { saved: true },
        ...(error ? { error } : {}),
      });
      assertEquals(hostedInheritedTerminalReceipt({ ...run }), undefined);
    }
    const running = await acceptWorkflowInheritedRunAdmission(
      inheritedExecutionResponse(),
      inheritedBinding(),
    );
    assertEquals("runId" in running && running.runId, "child-run");
  });
});

describe("authenticated accepted child evidence readers", () => {
  const versionId = "77777777-7777-4777-8777-777777777777";
  function readers(send: typeof globalThis.fetch, signal?: AbortSignal) {
    const owner = { ...request(), authToken: "parent-auth" };
    const token = `header.${
      btoa(
        JSON.stringify({
          tokenUse: "run_event_writer",
          writerPurpose: "current_run_terminal",
          runId: "run-1",
          canonicalRunId: inheritedParentId,
          dispatchNonce: "parent-dispatch",
        }),
      )
    }.signature`;
    registerHostedTerminalCredential(owner, token);
    return {
      owner,
      evidence: hostedAcceptedChildEvidence(owner, "project-1", signal, {
        apiUrl: "https://api.example/v1///",
        fetch: send,
      }),
    };
  }
  it("reads only canonical parent results and exact immutable versions with private credentials", async () => {
    const calls: Request[] = [];
    const row = {
      run_id: inheritedParentId,
      event_type: "TOOL_CALL_RESULT",
      event_id: 7,
      result: { saved: true },
    };
    const { owner, evidence } = readers((input, init) => {
      const request = new Request(input, init);
      calls.push(request);
      return Promise.resolve(
        Response.json(
          calls.length === 1
            ? { data: [row], page_info: { next: null } }
            : { path: "notes/a b.txt", id: versionId, content: "pinned bytes" },
        ),
      );
    });
    const rows = await evidence.readParentToolResults();
    assertEquals(rows, [row]);
    assert(Object.isFrozen(rows));
    assert(Object.isFrozen(rows[0]));
    assertEquals(
      calls[0]?.url,
      `https://api.example/v1/runs/${inheritedParentId}/events?event_type=TOOL_CALL_RESULT&limit=100&sort_order=desc&include_descendants=false`,
    );
    assertEquals(await evidence.readCommittedVersion("notes/a b.txt", versionId), {
      path: "notes/a b.txt",
      versionId,
      content: "pinned bytes",
    });
    assertEquals(
      calls[1]?.url,
      `https://api.example/v1/projects/project-1/files/notes%2Fa%20b.txt/versions/${versionId}`,
    );
    for (const request of calls) {
      assertEquals(request.headers.get("authorization"), "Bearer parent-auth");
      assertEquals(request.headers.get("accept"), "application/json");
      assertEquals(request.redirect, "error");
    }
    assertThrows(
      () =>
        hostedAcceptedChildEvidence({ ...owner }, "project-1", undefined, {
          apiUrl: "https://api.example",
        }),
      Error,
      "exact parent authority",
    );
    assertThrows(
      () =>
        hostedAcceptedChildEvidence(owner, "foreign", undefined, { apiUrl: "https://api.example" }),
      Error,
      "exact parent authority",
    );
  });
  it("rejects incomplete or wrongly scoped parent event pages", async () => {
    const row = { run_id: inheritedParentId, event_type: "TOOL_CALL_RESULT", event_id: 1 };
    for (
      const page of [
        { data: [], page_info: { next: "cursor" } },
        { data: [] },
        { data: {}, page_info: { next: null } },
        { data: Array.from({ length: 101 }, () => row), page_info: { next: null } },
        ...[null, { ...row, run_id: inheritedChildId }, { ...row, event_type: "RUN_FINISHED" }, {
          ...row,
          event_id: 0,
        }, { ...row, event_id: 1.5 }].map((entry) => ({
          data: [entry],
          page_info: { next: null },
        })),
      ]
    ) {
      const { evidence } = readers(() => Promise.resolve(Response.json(page)));
      await assertRejects(() => evidence.readParentToolResults(), Error, "receipt evidence");
    }
  });
  it("rejects bad version references before fetch and mismatched historical identity after fetch", async () => {
    let calls = 0;
    const { evidence } = readers(() => {
      calls++;
      return Promise.resolve(Response.json({ path: "note.txt", id: versionId, content: "bytes" }));
    });
    for (
      const [path, version] of [["", versionId], ["x".repeat(513), versionId], ["note.txt", "main"]]
    ) {
      await assertRejects(
        () => evidence.readCommittedVersion(path!, version!),
        Error,
        "Invalid accepted artifact reference",
      );
    }
    assertEquals(calls, 0);
    for (const patch of [{ path: "other" }, { id: inheritedChildId }, { content: 1 }]) {
      const { evidence } = readers(() =>
        Promise.resolve(
          Response.json({ path: "note.txt", id: versionId, content: "bytes", ...patch }),
        )
      );
      await assertRejects(
        () => evidence.readCommittedVersion("note.txt", versionId),
        Error,
        "Historical artifact identity mismatch",
      );
    }
  });
  it("fails closed on status errors, invalid JSON, oversized bodies and cancellation", async () => {
    for (
      const response of [
        new Response("denied", { status: 403 }),
        new Response("not-json"),
        new Response("x".repeat(3_000_001)),
      ]
    ) {
      const { evidence } = readers(() => Promise.resolve(response));
      await assertRejects(() => evidence.readParentToolResults());
    }
    const controller = new AbortController();
    controller.abort(new Error("parent cancelled"));
    const { evidence } = readers((_input, init) => {
      new Request("https://api.example", init).signal.throwIfAborted();
      return Promise.resolve(Response.json({ data: [], page_info: { next: null } }));
    }, controller.signal);
    await assertRejects(() => evidence.readParentToolResults(), Error, "parent cancelled");
    const noAuth = request();
    registerHostedTerminalCredential(noAuth, inheritedToken);
    assertThrows(
      () =>
        hostedAcceptedChildEvidence(noAuth, "project-1", undefined, {
          apiUrl: "https://api.example",
        }),
      Error,
      "exact parent authority",
    );
  });
});
