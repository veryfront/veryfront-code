import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { getHostedToolApprovalCapability } from "#veryfront/agent/hosted/tool-approval-capability.ts";
import { managedStart } from "./managed-executor-start.ts";
import type {
  ManagedExecutorRuntime,
  ManagedExecutorStartInput,
} from "#veryfront/agent/hosted/managed-executor-broker.ts";
import { createCanonicalManagedBrokerHandler } from "#veryfront/agent/service/canonical-managed-broker.ts";
import {
  invocation,
  options,
  projectId,
  signedRequest,
} from "#veryfront/agent/service/broker-ingress.test-helpers.ts";

export const canonicalId = "30000000-3000-4000-8000-300000000001";
export const sourceId = "00000000-0000-4000-8000-000000000099";
export const terminal = `header.${
  btoa(JSON.stringify({
    runId: "run-1",
    canonicalRunId: canonicalId,
    tokenUse: "run_event_writer",
    writerPurpose: "current_run_terminal",
    dispatchNonce: "33333333-3333-4333-8333-333333333333",
  }))
}.signature`;

export async function fixture(input: {
  status?: string;
  probeApproval?: boolean;
  approvalOverride?: boolean;
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
  advanceDuringAdmission?: number;
  observeAdmission?: (signal: AbortSignal) => void;
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
  const approvalReply = (value: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(value));
    calls.push({ url, authorization: new Headers(init?.headers).get("authorization") });
    const payload = JSON.parse(String(init?.body));
    return Promise.resolve(
      Response.json({
        ...payload,
        input_request_id: "40000000-4000-4000-8000-400000000001",
        status: "submitted",
        response: { values: { decision: "approve" }, actor: { type: "human", id: "checker" } },
      }, { status: 201 }),
    );
  };
  const handler = createCanonicalManagedBrokerHandler({
    clock: { now: () => now },
    apiUrl: "https://api.example.test",
    ...(input.approvalOverride
      ? {
        approvalApiBaseUrl: "https://approval.example.test",
        approvalFetch: approvalReply as typeof fetch,
      }
      : {}),
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
      if (url.pathname.endsWith("/input-requests")) return approvalReply(value, init);
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
        now += input.advanceDuringAdmission ?? 0;
        input.observeAdmission?.(init?.signal as AbortSignal);
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
        if (input.probeApproval) {
          const gate = getHostedToolApprovalCapability(value, base.run.runId);
          assert(gate);
          await gate({ toolName: "transfer", toolCallId: "call-1", input: {}, policy: {} });
        }
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
