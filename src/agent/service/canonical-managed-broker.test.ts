import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { managedStart } from "../../../tests/fixtures/managed-executor-start.ts";
import type {
  ManagedExecutorRuntime,
  ManagedExecutorStartInput,
} from "../hosted/managed-executor-broker.ts";
import { agUiSseEventTypes, parseAgUiSseResponse } from "../ag-ui/sse-parser.ts";
import { createCanonicalManagedBrokerHandler } from "./canonical-managed-broker.ts";
import {
  invocation,
  options,
  projectId,
  signedRequest,
  userId,
} from "./broker-ingress.test-helpers.ts";

const canonicalId = "30000000-3000-4000-8000-300000000001";
const sourceId = "00000000-0000-4000-8000-000000000099";
const terminal = `header.${
  btoa(JSON.stringify({
    runId: "run-1",
    canonicalRunId: canonicalId,
    tokenUse: "run_event_writer",
    writerPurpose: "current_run_terminal",
    dispatchNonce: "33333333-3333-4333-8333-333333333333",
  }))
}.signature`;

async function fixture(input: {
  status?: string;
  cursor?: boolean;
  terminal?: boolean;
  sourceToken?: boolean;
  inferenceToken?: boolean;
  mismatch?: boolean;
  apiStatus?: number;
  probeState?: boolean;
  wrongEntrypoint?: boolean;
  wrongActor?: boolean;
  aborted?: boolean;
  resume?: boolean;
  probeAppend?: boolean;
  stream?: boolean;
  projectWriter?: "valid" | "foreign" | "stale" | "unsafe";
  admission?: { claimed: boolean };
  admissionStatus?: number;
  admissionMismatch?: boolean;
  deadline?: string;
  now?: number;
  advanceDuringStatus?: number;
} = {}) {
  const base = invocation();
  const body = invocation({
    run: {
      ...base.run,
      ...(input.deadline === undefined ? {} : { effectiveDeadlineAt: input.deadline }),
      ...(input.cursor === false ? {} : {
        eventCursor: {
          canonicalRunId: canonicalId,
          latestEventId: 42,
          latestExternalEventSequence: 17,
        },
      }),
      project: { ...base.run.project, runtimeTargetBranchName: "main" },
    },
    sourceProject: {
      projectId: sourceId,
      projectSlug: "private-source",
      runtimeTargetKind: "environment",
      runtimeTargetEnvironmentId: "00000000-0000-4000-8000-000000000098",
      runtimeTargetEnvironmentName: "Production",
    },
    agentEntrypoint: { path: "agents/selected.ts" },
    ...(input.resume
      ? { resumeToolCall: { id: "tool-1", name: "check", input: { approved: true } } }
      : {}),
    credentials: {
      authToken: "api-auth-token",
      ...(input.inferenceToken === false ? {} : { inferenceAuthToken: "inference-token" }),
      ...(input.sourceToken === false ? {} : { sourceAuthToken: "source-read-token" }),
    },
  });
  if (input.projectWriter) {
    Object.assign(body, {
      projectEventPersistence: {
        mode: "runtime-owned-v1",
        canonicalRunId: input.projectWriter === "foreign"
          ? "30000000-3000-4000-8000-300000000099"
          : canonicalId,
        latestEventId: input.projectWriter === "stale"
          ? 41
          : input.projectWriter === "unsafe"
          ? Number.MAX_SAFE_INTEGER + 1
          : 45,
        latestExternalEventSequence: input.projectWriter === "stale" ? 16 : 19,
      },
      platformToolDependencies: [],
    });
  }
  const signed = await signedRequest(body, { projectId: sourceId, audience: "private-source" });
  if (input.terminal !== false) {
    signed.request.headers.set("x-veryfront-run-terminal-token", terminal);
  }
  const calls: { url: URL; authorization: string | null }[] = [];
  const finalizations: { status: string; terminalBound: boolean }[] = [];
  const appends: Array<
    { expected_previous_event_id?: number; expected_previous_external_event_sequence?: number }
  > = [];
  let durableCursor = input.projectWriter ? 45 : 42;
  let externalCursor = input.projectWriter ? 19 : 17;
  let prepared = 0;
  let cleaned = 0;
  let started: ManagedExecutorStartInput | undefined;
  let now = input.now ?? Date.now();
  const handler = createCanonicalManagedBrokerHandler({
    clock: { now: () => now },
    apiUrl: "https://api.example.test",
    responseMode: input.stream ? "sse" : "detached",
    resolveProvider: () => "synthetic",
    resolveIngressOptions: () => ({
      ...options(signed.publicKeyPem),
      projectId: sourceId,
      audience: "private-source",
      expectedOwner: { scopeKind: "project", projectId: sourceId },
    }),
    fetch: (value, init) => {
      const url = new URL(String(value));
      calls.push({ url, authorization: new Headers(init?.headers).get("authorization") });
      if (url.pathname.endsWith("/runtime/admission")) {
        assertEquals(new Headers(init?.headers).get("authorization"), "Bearer api-auth-token");
        assertEquals(new Headers(init?.headers).get("x-veryfront-run-terminal-token"), terminal);
        assertEquals(init?.redirect, "error");
        assertEquals(JSON.parse(String(init?.body)), {
          latest_event_id: durableCursor,
          latest_external_event_sequence: externalCursor,
        });
        if (input.admissionStatus || input.admission?.claimed) {
          return Promise.resolve(new Response(null, { status: input.admissionStatus ?? 409 }));
        }
        if (input.admission) input.admission.claimed = true;
        return Promise.resolve(
          Response.json({
            version: 1,
            accepted: true,
            identity: {
              project_id: input.admissionMismatch ? sourceId : projectId,
              canonical_run_id: canonicalId,
              public_run_id: base.run.runId,
            },
            generation: {
              worker_id: "worker",
              dispatch_nonce: "33333333-3333-4333-8333-333333333333",
              transport_recovery_attempt: 0,
            },
            lease_remaining_ms: 1000,
            acknowledged_event_id: durableCursor,
            acknowledged_external_sequence: externalCursor,
          }),
        );
      }
      if (url.pathname.endsWith("/finalize")) {
        const body = JSON.parse(String(init?.body));
        finalizations.push({
          status: body.status,
          terminalBound:
            new Headers(init?.headers).get("x-veryfront-run-terminal-token") === terminal,
        });
        return Promise.resolve(Response.json({ id: canonicalId, status: body.status }));
      }
      if (url.pathname.endsWith("/events")) {
        const body = JSON.parse(String(init?.body));
        appends.push(body);
        if (body.expected_previous_event_id !== undefined) {
          assertEquals(body.expected_previous_event_id, durableCursor);
        } else {
          assertEquals(body.expected_previous_external_event_sequence, externalCursor);
          externalCursor += body.events.length;
        }
        durableCursor += body.events.length;
        return Promise.resolve(
          Response.json({
            run_id: canonicalId,
            latest_event_id: durableCursor,
            latest_external_event_sequence: externalCursor,
            appended_count: body.events.length,
          }),
        );
      }
      if (url.pathname.startsWith("/runs/")) {
        now += input.advanceDuringStatus ?? 0;
        return Promise.resolve(
          Response.json({ id: canonicalId, status: input.status ?? "running" }, {
            status: input.apiStatus ?? 200,
          }),
        );
      }
      return Promise.resolve(
        url.pathname.endsWith("/AGENTS.md")
          ? Response.json({ path: "AGENTS.md", content: "Source release instructions" })
          : Response.json({ data: [], page_info: { next: null } }),
      );
    },
    async prepareExecutor() {
      prepared++;
      const start = managedStart({ agentId: "builder" });
      start.trustedRuntime = {
        projectToolNames: [],
        sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
      };
      start.installation.owner = { scopeKind: "project", projectId: sourceId };
      start.installation.agentEntrypoint = {
        path: input.wrongEntrypoint ? "agents/internal.ts" : "agents/selected.ts",
      };
      start.installation.grant.execution = {
        kind: "canonical",
        projectId: input.mismatch ? sourceId : projectId,
        conversationId: base.run.conversationId,
        runId: base.run.runId,
        messageId: base.run.messageId,
        providerReplay: "disabled",
        ...(input.wrongActor ? { userId: sourceId } : {}),
      };
      start.prepare.serverResolvedResumeToolCall = { id: "unsigned", name: "wrong", input: {} };
      const execution = new AbortController();
      if (input.aborted) execution.abort();
      return {
        start,
        messages: [],
        executionSignal: execution.signal,
        initialCheckpoints: {
          initialToolExposureCheckpoint: { version: 2, loadedToolNames: ["check"] },
        },
        cleanup: () => {
          cleaned++;
          return Promise.resolve();
        },
      };
    },
    broker: {
      async start(value) {
        started = value;
        if (input.stream) {
          value.bindSessionOwnedWork!((operation) => operation());
          const settled = Promise.withResolvers<void>();
          const runtime: ManagedExecutorRuntime = {
            definition: { id: "builder", name: "Builder", description: "", instructions: "Work" },
            modelId: value.installation.grant.defaultModelId,
            runtimeKind: "framework",
            signal: new AbortController().signal,
            accepted: false,
            settled: settled.promise,
            runOwned: (operation) => operation(),
            accept() {
              Object.defineProperty(runtime, "accepted", { value: true });
            },
            close(reason = "canceled") {
              settled.resolve();
              return Promise.resolve({ reason, release: "released" });
            },
            agent: {
              async stream() {
                return {
                  steps: Promise.resolve([]),
                  toUIMessageStream() {
                    return (async function* () {
                      yield { type: "start", messageId: base.run.messageId } as const;
                      yield { type: "text-start", id: "text-1" } as const;
                      yield { type: "text-delta", id: "text-1", delta: "Scoped output" } as const;
                      yield { type: "text-end", id: "text-1" } as const;
                      yield { type: "finish", finishReason: "stop" } as const;
                    })();
                  },
                };
              },
            },
          };
          return runtime;
        }
        if (input.probeAppend) {
          value.bindSessionOwnedWork!((operation) => operation());
          for (const text of ["First private replay", "Second private replay"]) {
            await value.persistence.persistProviderReplayCheckpoint!({
              version: 1,
              messageId: "assistant-1",
              provider: "anthropic",
              providerBlocks: [{
                type: "provider-block",
                provider: "anthropic",
                block: { type: "text", text },
              }],
              providerBlockPositions: [0],
              totalPartCount: 1,
            });
          }
          await value.persistence.persistToolExposureCheckpoint!({
            version: 2,
            loadedToolNames: ["check", "search"],
          });
        }
        if (input.probeState) {
          const steering = await value.state.prepareProjectSteering?.({
            projectId: sourceId,
            releaseId: "release-1",
            definition: {
              id: "builder",
              name: "Builder",
              description: "",
              instructions: "Work",
              skills: false,
            },
            signal: new AbortController().signal,
          });
          assertEquals(steering?.initialProjectInstructions, "Source release instructions");
        }
        // Preparation is tested without allocating a real executor or invoking a model.
        throw new Error("Test stops before allocation");
      },
    },
  });
  const response = await handler.handle(signed.request);
  return {
    response,
    calls,
    appends,
    finalizations,
    prepared,
    get cleaned() {
      return cleaned;
    },
    started,
    close: () => handler.close(),
  };
}

describe("canonical managed broker preparation", () => {
  it("validates its configured admission limit before invoking deployment callbacks", () => {
    assertThrows(
      () =>
        createCanonicalManagedBrokerHandler({
          maxActiveRuns: 0,
          apiUrl: "https://api.example.test",
          responseMode: "sse",
          resolveProvider: () => "synthetic",
          broker: { start: () => Promise.reject(new Error("Unexpected allocation")) },
          resolveIngressOptions() {
            throw new Error("Unexpected ingress resolution");
          },
          prepareExecutor() {
            throw new Error("Unexpected preparation");
          },
        }),
      TypeError,
      "Invalid managed run ownership limit",
    );
  });

  it("acknowledges the signed API writer snapshot and leaves terminal ownership with the API", async () => {
    const result = await fixture({ stream: true, projectWriter: "valid" });
    try {
      assertEquals(result.response.status, 200);
      const parsed = await parseAgUiSseResponse(result.response);
      assertEquals(
        result.response.headers.get("X-Veryfront-Run-Event-Persistence"),
        "runtime-owned-v1",
      );
      assert(parsed.events.some((event) => event.type === agUiSseEventTypes.runFinished));
      assertEquals(result.appends[0]?.expected_previous_external_event_sequence, 19);
      assertEquals(result.finalizations, []);
    } finally {
      await result.close();
    }
  });
  for (const advanceDuringStatus of [0, 2000]) {
    it(`rejects expired deadlines before consuming dispatch (status delay: ${advanceDuringStatus})`, async () => {
      const now = Date.parse("2026-01-01T00:00:00Z");
      const admission = { claimed: false };
      const result = await fixture({
        deadline: new Date(now + (advanceDuringStatus ? 1000 : -1)).toISOString(),
        now,
        advanceDuringStatus,
        admission,
      });
      try {
        assertEquals(admission.claimed, false);
        assertEquals(result.response.status, 409);
        assertEquals(result.prepared, 0);
        assertEquals(
          result.calls.some(({ url }) => url.pathname.endsWith("/runtime/admission")),
          false,
        );
      } finally {
        await result.close();
      }
    });
  }
  it("requires atomic API admission across independent broker replicas before preparation", async () => {
    const admission = { claimed: false };
    const replicas = await Promise.all([
      fixture({ stream: true, projectWriter: "valid", admission }),
      fixture({ stream: true, projectWriter: "valid", admission }),
    ]);
    try {
      assertEquals(replicas.map((result) => result.response.status).sort(), [200, 409]);
      const accepted = replicas.find((result) => result.response.status === 200)!;
      const refused = replicas.find((result) => result.response.status === 409)!;
      assertEquals(refused.prepared, 0);
      assertEquals(refused.started, undefined);
      await accepted.response.text();
    } finally {
      await Promise.all(replicas.map((result) => result.close()));
    }
  });
  for (const admissionStatus of [401, 403, 404, 409, 500]) {
    it(`refuses API admission ${admissionStatus} before preparation`, async () => {
      const result = await fixture({ admissionStatus });
      try {
        assertEquals(
          result.response.status,
          admissionStatus === 409
            ? 409
            : admissionStatus === 401 || admissionStatus === 403
            ? 403
            : 503,
        );
        assertEquals(result.prepared, 0);
        assertEquals(result.started, undefined);
      } finally {
        await result.close();
      }
    });
  }
  it("refuses a foreign admission receipt before preparation", async () => {
    const result = await fixture({ admissionMismatch: true });
    try {
      assertEquals(result.response.status, 403);
      assertEquals(result.prepared, 0);
    } finally {
      await result.close();
    }
  });

  it("marks a signed resumed segment consistently with the API opening event", async () => {
    const result = await fixture({ stream: true, projectWriter: "valid", resume: true });
    try {
      const parsed = await parseAgUiSseResponse(result.response);
      const start = parsed.events.find((event) => event.type === agUiSseEventTypes.runStarted);
      assertEquals((start as { metadata?: unknown })?.metadata, { resumed: true });
      assertEquals(result.finalizations, []);
    } finally {
      await result.close();
    }
  });
  for (const projectWriter of ["foreign", "stale", "unsafe"] as const) {
    it(`refuses ${projectWriter} signed writer negotiation before preparation`, async () => {
      const result = await fixture({ projectWriter });
      try {
        assertEquals(result.response.status, projectWriter === "unsafe" ? 400 : 403);
        assertEquals(result.prepared, 0);
        assertEquals(result.started, undefined);
      } finally {
        await result.close();
      }
    });
  }

  it("persists and finalizes a signed canonical SSE turn with separate append and terminal authority", async () => {
    const result = await fixture({ stream: true });
    try {
      assertEquals(result.response.status, 200);
      const parsed = await parseAgUiSseResponse(result.response);
      assert(parsed.events.some((event) => event.type === agUiSseEventTypes.runFinished));
      assert(result.appends.length > 0);
      assertEquals(result.finalizations, [{ status: "completed", terminalBound: true }]);
      const finalization = result.calls.filter((call) => call.url.pathname.endsWith("/finalize"));
      assertEquals(finalization.map((call) => [call.url.pathname, call.authorization]), [[
        `/runs/${canonicalId}/finalize`,
        "Bearer api-auth-token",
      ]]);
      assertEquals(
        result.calls.filter((call) => call.url.pathname.endsWith("/events")).every((call) =>
          call.authorization === "Bearer run-event-token"
        ),
        true,
      );
    } finally {
      await result.close();
    }
    assertEquals(result.cleaned, 1);
  });

  it("refuses a shared run without consuming inference authority before preparation", async () => {
    const result = await fixture({ stream: true, inferenceToken: false });
    try {
      assertEquals(result.response.status, 403);
      assertEquals(result.prepared, 0);
      assertEquals(result.started, undefined);
      assertEquals(result.calls, []);
    } finally {
      await result.close();
    }
  });

  it("reads execution lifecycle with execution authority before constructing persistence", async () => {
    const result = await fixture();
    assertEquals(result.response.status, 500);
    assertEquals(result.prepared, 1);
    assertEquals(result.cleaned, 1);
    assertEquals(result.calls.map((call) => [call.url.pathname, call.authorization]), [
      [`/runs/${canonicalId}`, "Bearer api-auth-token"],
      [`/runs/${canonicalId}/runtime/admission`, "Bearer api-auth-token"],
    ]);
    assert(result.started?.bindSessionOwnedWork);
    assert(result.started.persistence.publishParentRunEvents);
    assert(result.started.model.runEventSink);
    assertEquals(result.started.tools.admitToolCall, undefined);
    assertEquals(result.started.prepare.serverResolvedResumeToolCall, undefined);
    assertEquals(result.started.persistence.initialToolExposureCheckpoint, {
      version: 2,
      loadedToolNames: ["check"],
    });
    assertEquals(result.started.installation.grant.execution.userId, userId);
    assertEquals(
      JSON.stringify({ installation: result.started.installation, prepare: result.started.prepare })
        .includes("source-read-token"),
      false,
    );
    assertEquals(result.started.trustedRuntime?.hostedKnowledgeAuthToken, "source-read-token");
  });

  for (const absent of ["cursor", "terminal", "sourceToken"] as const) {
    it(`refuses missing ${absent} without an API read, executor preparation or allocation`, async () => {
      const result = await fixture({ [absent]: false });
      assertEquals(result.response.status, absent === "sourceToken" ? 400 : 503);
      assertEquals(result.calls.length, 0);
      assertEquals(result.prepared, 0);
      assertEquals(result.started, undefined);
    });
  }

  it("refuses a waiting run without its signed resume decision before preparation", async () => {
    const result = await fixture({ status: "waiting" });
    try {
      assertEquals(result.response.status, 409);
      assertEquals(result.prepared, 0);
      assertEquals(result.started, undefined);
    } finally {
      await result.close();
    }
  });

  it("refuses a replayed signed resume after its segment has entered another wait", async () => {
    const result = await fixture({
      status: "waiting",
      resume: true,
      stream: true,
      projectWriter: "valid",
    });
    try {
      assertEquals(result.response.status, 409);
      assertEquals(result.prepared, 0);
      assertEquals(result.started, undefined);
    } finally {
      await result.close();
    }
  });

  for (const status of ["completed", "cancelled", "failed"]) {
    it(`refuses a ${status} run before executor preparation`, async () => {
      const result = await fixture({ status });
      assertEquals(result.response.status, 409);
      assertEquals(result.prepared, 0);
      assertEquals(result.started, undefined);
    });
  }

  it("propagates failed authority reads without preparing an executor", async () => {
    const result = await fixture({ apiStatus: 403 });
    assertEquals(result.response.ok, false);
    assertEquals(result.prepared, 0);
    assertEquals(result.started, undefined);
  });

  it("rejects a prepared source project substituted for the execution project and cleans up", async () => {
    const result = await fixture({ mismatch: true });
    assertEquals(result.response.status, 403);
    assertEquals(result.started, undefined);
    assertEquals(result.cleaned, 1);
  });

  it("reads source instructions with the source credential and captured release, never the execution project", async () => {
    const result = await fixture({ probeState: true });
    const sourceReads = result.calls.filter((call) => call.url.pathname.startsWith("/projects/"));
    assert(sourceReads.length > 0);
    assertEquals(
      sourceReads.every((call) =>
        call.url.pathname.startsWith(`/projects/${sourceId}/releases/release-1/files`) &&
        call.authorization === "Bearer source-read-token" &&
        !call.url.searchParams.has("ref")
      ),
      true,
    );
    assertEquals(result.cleaned, 1);
  });

  for (const mismatch of ["wrongEntrypoint", "wrongActor", "aborted"] as const) {
    it(`refuses ${mismatch} before allocation and releases prepared resources`, async () => {
      const result = await fixture({ [mismatch]: true });
      assertEquals(result.response.ok, false);
      assertEquals(result.started, undefined);
      assertEquals(result.cleaned, 1);
    });
  }

  it("forwards only the signed resume decision", async () => {
    const result = await fixture({ resume: true });
    assertEquals(result.started?.prepare.serverResolvedResumeToolCall, {
      id: "tool-1",
      name: "check",
      input: { approved: true },
    });
  });

  it("appends from the signed nonzero durable cursor and advances only on API acknowledgements", async () => {
    const result = await fixture({ probeAppend: true });
    assertEquals(result.appends.map((append) => append.expected_previous_event_id), [
      42,
      43,
      undefined,
    ]);
    assertEquals(result.appends.map((append) => append.expected_previous_external_event_sequence), [
      undefined,
      undefined,
      17,
    ]);
    assertEquals(
      result.calls.filter((call) => call.url.pathname.endsWith("/events")).map(
        (call) => [call.url.pathname, call.authorization],
      ),
      [
        [`/runs/${canonicalId}/events`, "Bearer run-event-token"],
        [`/runs/${canonicalId}/events`, "Bearer run-event-token"],
        [`/runs/${canonicalId}/events`, "Bearer run-event-token"],
      ],
    );
    assertEquals(result.cleaned, 1);
  });
});
