import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  createExternalAgentWorkerClient,
  type ExternalAgentWorker,
} from "./external-worker-client.ts";
import type { AgentWorkerRuntimeOwnershipProbe } from "./agent-worker-runtime-ownership-probe.ts";

const API_URL = "https://api.example.com";
const API_TOKEN = "api-token";
const WORKER_TOKEN = "worker-token";
const PROJECT_REFERENCE = "testing-project";
const WORKER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "run_123";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";

const CANONICAL_RUN_ID = "77777777-7777-4777-8777-777777777777";
const TERMINAL_TOKEN = `header.${
  btoa(
    JSON.stringify({
      runId: RUN_ID,
      canonicalRunId: CANONICAL_RUN_ID,
      tokenUse: "run_event_writer",
      writerPurpose: "current_run_terminal",
      dispatchNonce: "generation",
    }),
  )
}.signature`;
const credentials = {
  auth_token: "invocation-token",
  run_event_token: "event-token",
  run_terminal_token: TERMINAL_TOKEN,
};
function claim() {
  return {
    credentials,
    run: {
      run_id: RUN_ID,
      conversation_id: CONVERSATION_ID,
      message_id: WORKER_ID,
      project_id: PROJECT_ID,
      agent_id: "worker",
      status: "running",
      request_snapshot: null,
      latest_event_id: 0,
      latest_external_event_sequence: 0,
      lease_owner: WORKER_ID,
      lease_expires_at: null,
      worker_session: null,
    },
  };
}

type FetchCall = [RequestInfo | URL, RequestInit | undefined];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function worker(overrides: Partial<ExternalAgentWorker> = {}): ExternalAgentWorker {
  return {
    id: WORKER_ID,
    project_id: PROJECT_ID,
    implementation_kind: "veryfront-codex",
    worker_key: "local-codex",
    display_name: "Local Codex",
    status: "online",
    metadata: null,
    last_heartbeat_at: null,
    ...overrides,
  };
}

function fetchSequence(...responses: Response[]): {
  calls: FetchCall[];
  fetchImpl: typeof fetch;
} {
  const calls: FetchCall[] = [];
  const queue = [...responses];
  return {
    calls,
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      const next = queue.shift();
      if (!next) {
        throw new Error("Unexpected fetch call");
      }
      return next;
    }) as typeof fetch,
  };
}

function throwingProbe(
  phase: "afterClaim" | "afterRenew" | "afterTerminal",
  message?: string,
): AgentWorkerRuntimeOwnershipProbe {
  const fail = () => Promise.reject(new Error(message ?? `${phase} probe failed`));
  return {
    afterClaim: phase === "afterClaim" ? fail : () => Promise.resolve(),
    afterRenew: phase === "afterRenew" ? fail : () => Promise.resolve(),
    afterLeaseLost: () => Promise.resolve(),
    afterCancelled: () => Promise.resolve(),
    afterTerminal: phase === "afterTerminal" ? fail : () => Promise.resolve(),
  };
}

function cursorProbe(
  phase: "afterClaim" | "afterRenew",
  latestExternalEventSequence: number,
): AgentWorkerRuntimeOwnershipProbe {
  return {
    afterClaim: phase === "afterClaim"
      ? () => Promise.resolve({ latestExternalEventSequence })
      : () => Promise.resolve(),
    afterRenew: phase === "afterRenew"
      ? () => Promise.resolve({ latestExternalEventSequence })
      : () => Promise.resolve(),
    afterLeaseLost: () => Promise.resolve(),
    afterCancelled: () => Promise.resolve(),
  };
}

function authorization(call: FetchCall): string | null {
  return new Headers(call[1]?.headers).get("Authorization");
}

function requestBody(call: FetchCall): unknown {
  return JSON.parse(String(call[1]?.body));
}

describe("external agent worker client", () => {
  it("registers a worker and uses its scoped worker token for worker-owned requests", async () => {
    const { calls, fetchImpl } = fetchSequence(
      jsonResponse({ worker: worker(), token: WORKER_TOKEN }, 201),
      jsonResponse({ worker: worker({ status: "online" }) }),
    );
    const client = createExternalAgentWorkerClient({
      apiUrl: `${API_URL}/`,
      authToken: API_TOKEN,
      fetch: fetchImpl,
    });

    const registeredWorker = await client.registerWorker({
      projectReference: PROJECT_REFERENCE,
      implementationKind: "veryfront-codex",
      implementationDisplayName: "Veryfront Codex",
      workerKey: "local-codex",
      displayName: "Local Codex",
      metadata: { workspaceIsolation: "project-conversation" },
    });
    await client.heartbeatWorker(registeredWorker.id);

    assertEquals(
      String(calls[0]?.[0]),
      `${API_URL}/agent-workers/projects/${PROJECT_REFERENCE}/workers`,
    );
    assertEquals(authorization(calls[0]!), `Bearer ${API_TOKEN}`);
    assertEquals(requestBody(calls[0]!), {
      implementation_kind: "veryfront-codex",
      implementation_display_name: "Veryfront Codex",
      worker_key: "local-codex",
      display_name: "Local Codex",
      metadata: { workspaceIsolation: "project-conversation" },
    });
    assertEquals(
      String(calls[1]?.[0]),
      `${API_URL}/agent-workers/workers/${WORKER_ID}/heartbeat`,
    );
    assertEquals(authorization(calls[1]!), `Bearer ${WORKER_TOKEN}`);
  });

  it("claims runs, records sessions, appends events, and completes runs through the external worker contract", async () => {
    const { calls, fetchImpl } = fetchSequence(
      jsonResponse({ worker: worker(), token: WORKER_TOKEN }, 201),
      jsonResponse({
        credentials,
        run: {
          run_id: RUN_ID,
          conversation_id: CONVERSATION_ID,
          message_id: "44444444-4444-4444-8444-444444444444",
          project_id: PROJECT_ID,
          agent_id: "veryfront-agent",
          status: "running",
          request_snapshot: {
            messages: [],
            tools: [],
            context: [],
            taskId: "issue-27-veryfront-studio-agent-implementation",
          },
          source_target_kind: "release",
          source_target_release_version: "2026.05.08",
          latest_event_id: 0,
          latest_external_event_sequence: 4,
          lease_owner: WORKER_ID,
          lease_expires_at: "2026-05-08T12:00:00.000Z",
          worker_session: null,
        },
      }),
      jsonResponse({
        session: {
          id: "55555555-5555-4555-8555-555555555555",
          run_id: RUN_ID,
          implementation_kind: "veryfront-codex",
          worker_id: WORKER_ID,
          session_key: "codex-session-1",
          status: "active",
        },
      }),
      jsonResponse({ appended: true, latest_external_event_sequence: 6 }),
      jsonResponse({ id: CANONICAL_RUN_ID, status: "completed" }),
    );
    const client = createExternalAgentWorkerClient({
      apiUrl: API_URL,
      authToken: API_TOKEN,
      fetch: fetchImpl,
    });

    const registeredWorker = await client.registerWorker({
      projectReference: PROJECT_REFERENCE,
      implementationKind: "veryfront-codex",
      implementationDisplayName: "Veryfront Codex",
      workerKey: "local-codex",
    });
    const run = await client.claimRun({
      workerId: registeredWorker.id,
      leaseDurationSeconds: 30,
    });
    assertEquals(run?.source_target_kind, "release");
    assertEquals(run?.source_target_release_version, "2026.05.08");
    assertEquals(
      run?.request_snapshot?.taskId,
      "issue-27-veryfront-studio-agent-implementation",
    );
    await client.recordSession({
      workerId: registeredWorker.id,
      runId: RUN_ID,
      sessionKey: "codex-session-1",
      status: "active",
      metadata: { workspacePath: "/workspace" },
    });
    await client.appendRunEvents({
      conversationId: CONVERSATION_ID,
      runId: RUN_ID,
      events: [{ type: "TEXT_MESSAGE_CHUNK", payload: { delta: "hello" } }],
      expectedPreviousExternalEventSequence: run?.latest_external_event_sequence,
    });
    await client.completeRun({
      runId: RUN_ID,
      status: "completed",
    });

    assertEquals(
      String(calls[1]?.[0]),
      `${API_URL}/agent-workers/workers/${WORKER_ID}/claim`,
    );
    assertEquals(authorization(calls[1]!), `Bearer ${WORKER_TOKEN}`);
    assertEquals(calls[1]?.[1]?.method, "POST", "claiming a run must POST to the claim endpoint");
    assertEquals(requestBody(calls[1]!), { lease_duration_seconds: 30 });
    assertEquals(
      String(calls[2]?.[0]),
      `${API_URL}/agent-workers/workers/${WORKER_ID}/runs/${RUN_ID}/session`,
    );
    assertEquals(authorization(calls[2]!), `Bearer ${WORKER_TOKEN}`);
    assertEquals(calls[2]?.[1]?.method, "PUT", "recording a session must PUT the session record");
    assertEquals(requestBody(calls[2]!), {
      session_key: "codex-session-1",
      status: "active",
      metadata: { workspacePath: "/workspace" },
    });
    assertEquals(
      String(calls[3]?.[0]),
      `${API_URL}/runs/${CANONICAL_RUN_ID}/events`,
    );
    assertEquals(calls[3]?.[1]?.method, "POST", "appending run events must POST them");
    assertEquals(requestBody(calls[3]!), {
      events: [{ type: "TEXT_MESSAGE_CHUNK", payload: { delta: "hello" } }],
      expected_previous_external_event_sequence: 4,
    });
    assertEquals(String(calls[4]?.[0]), `${API_URL}/runs/${CANONICAL_RUN_ID}/finalize`);
    assertEquals(calls[4]?.[1]?.method, "POST", "completing a run must POST the completion");
    assertEquals(
      requestBody(calls[4]!),
      { status: "completed", output: null },
      "completeRun must post the terminal status",
    );
  });

  it("clears previous authority when renewal cannot issue current credentials", async () => {
    const { calls, fetchImpl } = fetchSequence(
      jsonResponse(claim()),
      jsonResponse({ run: { ...claim().run, status: "completed" } }),
    );
    const client = createExternalAgentWorkerClient({
      apiUrl: API_URL,
      authToken: API_TOKEN,
      fetch: fetchImpl,
    });
    await client.claimRun({ workerId: WORKER_ID, leaseDurationSeconds: 30 });
    await client.renewLease({ workerId: WORKER_ID, runId: RUN_ID, leaseDurationSeconds: 30 });
    await assertRejects(
      () => client.completeRun({ runId: RUN_ID, status: "completed" }),
      Error,
      "Current worker claim authority is required",
    );
    assertEquals(calls.length, 2);
  });

  it("forwards the terminal error of a failed completion", async () => {
    const { calls, fetchImpl } = fetchSequence(
      jsonResponse(claim()),
      jsonResponse({ id: CANONICAL_RUN_ID, status: "failed" }),
    );
    const client = createExternalAgentWorkerClient({
      apiUrl: API_URL,
      authToken: API_TOKEN,
      fetch: fetchImpl,
    });

    await client.claimRun({ workerId: WORKER_ID, leaseDurationSeconds: 30 });
    await client.completeRun({
      runId: RUN_ID,
      status: "failed",
      terminalErrorCode: "ABORTED",
      terminalErrorMessage: "stopped",
    });

    assertEquals(
      requestBody(calls[1]!),
      {
        status: "failed",
        error: { code: "ABORTED", message: "stopped" },
      },
      "a failed completion must forward the terminal error",
    );
  });

  it("preserves a claimed run when afterClaim probe observation fails", async () => {
    const { calls, fetchImpl } = fetchSequence(
      jsonResponse(claim()),
      jsonResponse({ id: CANONICAL_RUN_ID, status: "completed" }),
    );
    const client = createExternalAgentWorkerClient({
      apiUrl: API_URL,
      authToken: API_TOKEN,
      fetch: fetchImpl,
      ownershipProbe: throwingProbe("afterClaim"),
    });

    const run = await client.claimRun({ workerId: WORKER_ID, leaseDurationSeconds: 30 });
    await client.completeRun({ runId: RUN_ID, status: "completed" });

    assertEquals(run?.run_id, RUN_ID);
    assertEquals(String(calls[1]?.[0]), `${API_URL}/runs/${CANONICAL_RUN_ID}/finalize`);
    assertEquals(requestBody(calls[1]!), { status: "completed", output: null });
  });

  it("preserves a renewed lease when afterRenew probe observation fails", async () => {
    const { calls, fetchImpl } = fetchSequence(
      jsonResponse(claim()),
      jsonResponse({
        ...claim(),
        run: {
          ...claim().run,
          latest_external_event_sequence: 8,
        },
      }),
      jsonResponse({ id: CANONICAL_RUN_ID, status: "completed" }),
    );
    const client = createExternalAgentWorkerClient({
      apiUrl: API_URL,
      authToken: API_TOKEN,
      fetch: fetchImpl,
      ownershipProbe: throwingProbe("afterRenew"),
    });

    await client.claimRun({ workerId: WORKER_ID, leaseDurationSeconds: 30 });
    const renewed = await client.renewLease({
      workerId: WORKER_ID,
      runId: RUN_ID,
      leaseDurationSeconds: 30,
    });
    await client.completeRun({ runId: RUN_ID, status: "completed" });

    assertEquals(renewed?.latest_external_event_sequence, 8);
    assertEquals(String(calls[2]?.[0]), `${API_URL}/runs/${CANONICAL_RUN_ID}/finalize`);
    assertEquals(requestBody(calls[2]!), { status: "completed", output: null });
  });

  it("does not demote fatal probe cursor errors when String.includes is replaced", async () => {
    const originalIncludes = String.prototype.includes;
    Object.defineProperty(String.prototype, "includes", {
      configurable: true,
      value: () => false,
    });
    try {
      const { fetchImpl } = fetchSequence(jsonResponse(claim()));
      const client = createExternalAgentWorkerClient({
        apiUrl: API_URL,
        authToken: API_TOKEN,
        fetch: fetchImpl,
        ownershipProbe: throwingProbe(
          "afterClaim",
          "Agent worker runtime ownership probe append outcome is ambiguous",
        ),
      });

      let rejected = false;
      try {
        await client.claimRun({ workerId: WORKER_ID, leaseDurationSeconds: 30 });
      } catch (error) {
        rejected = true;
        assertEquals(
          error instanceof Error && error.message ===
              "Agent worker runtime ownership probe append outcome is ambiguous",
          true,
        );
      }
      assertEquals(rejected, true);
    } finally {
      Object.defineProperty(String.prototype, "includes", {
        configurable: true,
        value: originalIncludes,
      });
    }
  });

  it("recovers a claimed run cursor with a fresh lease when the probe outcome is ambiguous", async () => {
    const recoveredClaim = {
      ...claim(),
      credentials: { ...credentials, run_event_token: "recovered-event-token" },
      run: { ...claim().run, latest_external_event_sequence: 7 },
    };
    const { calls, fetchImpl } = fetchSequence(
      jsonResponse(claim()),
      jsonResponse(recoveredClaim),
      jsonResponse({ appended: true }),
    );
    const client = createExternalAgentWorkerClient({
      apiUrl: API_URL,
      authToken: API_TOKEN,
      fetch: fetchImpl,
      ownershipProbe: throwingProbe(
        "afterClaim",
        "Agent worker runtime ownership probe append outcome is ambiguous",
      ),
    });

    const claimed = await client.claimRun({ workerId: WORKER_ID, leaseDurationSeconds: 30 });
    assertEquals(claimed?.latest_external_event_sequence, 7);
    assertEquals(
      String(calls[1]?.[0]),
      `${API_URL}/agent-workers/workers/${WORKER_ID}/runs/${RUN_ID}/lease`,
    );

    await client.appendRunEvents({
      conversationId: CONVERSATION_ID,
      runId: RUN_ID,
      events: [{ type: "AFTER_RECOVERED_CLAIM" }],
      expectedPreviousExternalEventSequence: claimed?.latest_external_event_sequence,
    });
    assertEquals(authorization(calls[2]!), "Bearer recovered-event-token");
    assertEquals(requestBody(calls[2]!), {
      events: [{ type: "AFTER_RECOVERED_CLAIM" }],
      expected_previous_external_event_sequence: 7,
    });
  });

  it("recovers a renewed lease cursor with a fresh lease when the probe outcome is ambiguous", async () => {
    const recoveredClaim = {
      ...claim(),
      credentials: { ...credentials, run_event_token: "renewed-recovered-event-token" },
      run: { ...claim().run, latest_external_event_sequence: 10 },
    };
    const { calls, fetchImpl } = fetchSequence(
      jsonResponse(claim()),
      jsonResponse({
        ...claim(),
        run: { ...claim().run, latest_external_event_sequence: 8 },
      }),
      jsonResponse(recoveredClaim),
      jsonResponse({ appended: true }),
    );
    const client = createExternalAgentWorkerClient({
      apiUrl: API_URL,
      authToken: API_TOKEN,
      fetch: fetchImpl,
      ownershipProbe: throwingProbe(
        "afterRenew",
        "Agent worker runtime ownership probe stale generation outcome is ambiguous",
      ),
    });

    await client.claimRun({ workerId: WORKER_ID, leaseDurationSeconds: 30 });
    const renewed = await client.renewLease({
      workerId: WORKER_ID,
      runId: RUN_ID,
      leaseDurationSeconds: 30,
    });
    assertEquals(renewed?.latest_external_event_sequence, 10);
    assertEquals(
      String(calls[2]?.[0]),
      `${API_URL}/agent-workers/workers/${WORKER_ID}/runs/${RUN_ID}/lease`,
    );

    await client.appendRunEvents({
      conversationId: CONVERSATION_ID,
      runId: RUN_ID,
      events: [{ type: "AFTER_RECOVERED_RENEWAL" }],
      expectedPreviousExternalEventSequence: renewed?.latest_external_event_sequence,
    });
    assertEquals(authorization(calls[3]!), "Bearer renewed-recovered-event-token");
    assertEquals(requestBody(calls[3]!), {
      events: [{ type: "AFTER_RECOVERED_RENEWAL" }],
      expected_previous_external_event_sequence: 10,
    });
  });

  it("clears a failed claim when ambiguous probe recovery cannot prove the cursor", async () => {
    const { calls, fetchImpl } = fetchSequence(
      jsonResponse(claim()),
      jsonResponse({ error: "lease failed" }, 503),
    );
    const client = createExternalAgentWorkerClient({
      apiUrl: API_URL,
      authToken: API_TOKEN,
      fetch: fetchImpl,
      ownershipProbe: throwingProbe(
        "afterClaim",
        "Agent worker runtime ownership probe append outcome is ambiguous",
      ),
    });

    await assertRejects(
      () => client.claimRun({ workerId: WORKER_ID, leaseDurationSeconds: 30 }),
      Error,
      "append outcome is ambiguous",
    );
    await assertRejects(
      () =>
        client.appendRunEvents({
          conversationId: CONVERSATION_ID,
          runId: RUN_ID,
          events: [{ type: "AFTER_FAILED_RECOVERY" }],
          expectedPreviousExternalEventSequence: 0,
        }),
      Error,
      "Current worker claim authority is required",
    );
    assertEquals(calls.length, 2);
  });

  it("clears a failed renewal when ambiguous probe recovery cannot prove the cursor", async () => {
    const { calls, fetchImpl } = fetchSequence(
      jsonResponse(claim()),
      jsonResponse({
        ...claim(),
        run: { ...claim().run, latest_external_event_sequence: 8 },
      }),
      jsonResponse({ error: "lease failed" }, 503),
    );
    const client = createExternalAgentWorkerClient({
      apiUrl: API_URL,
      authToken: API_TOKEN,
      fetch: fetchImpl,
      ownershipProbe: throwingProbe(
        "afterRenew",
        "Agent worker runtime ownership probe stale generation outcome is ambiguous",
      ),
    });

    await client.claimRun({ workerId: WORKER_ID, leaseDurationSeconds: 30 });
    await assertRejects(
      () => client.renewLease({ workerId: WORKER_ID, runId: RUN_ID, leaseDurationSeconds: 30 }),
      Error,
      "stale generation outcome is ambiguous",
    );
    await assertRejects(
      () =>
        client.appendRunEvents({
          conversationId: CONVERSATION_ID,
          runId: RUN_ID,
          events: [{ type: "AFTER_FAILED_RENEWAL_RECOVERY" }],
          expectedPreviousExternalEventSequence: 8,
        }),
      Error,
      "Current worker claim authority is required",
    );
    assertEquals(calls.length, 3);
  });

  it("preserves a claim when the ownership probe returns a reconciled append cursor", async () => {
    const { calls, fetchImpl } = fetchSequence(
      jsonResponse(claim()),
      jsonResponse({ appended: true }),
    );
    const client = createExternalAgentWorkerClient({
      apiUrl: API_URL,
      authToken: API_TOKEN,
      fetch: fetchImpl,
      ownershipProbe: cursorProbe("afterClaim", 2),
    });

    const claimed = await client.claimRun({ workerId: WORKER_ID, leaseDurationSeconds: 30 });
    assertEquals(claimed?.latest_external_event_sequence, 2);
    await client.appendRunEvents({
      conversationId: CONVERSATION_ID,
      runId: RUN_ID,
      events: [{ type: "PROBE_RECONCILED" }],
      expectedPreviousExternalEventSequence: claimed?.latest_external_event_sequence,
    });

    assertEquals(requestBody(calls[1]!), {
      events: [{ type: "PROBE_RECONCILED" }],
      expected_previous_external_event_sequence: 2,
    });
  });

  it("preserves a renewal when the ownership probe returns a reconciled stale-generation cursor", async () => {
    const { fetchImpl } = fetchSequence(
      jsonResponse(claim()),
      jsonResponse({
        ...claim(),
        run: { ...claim().run, latest_external_event_sequence: 8 },
      }),
    );
    const client = createExternalAgentWorkerClient({
      apiUrl: API_URL,
      authToken: API_TOKEN,
      fetch: fetchImpl,
      ownershipProbe: cursorProbe("afterRenew", 9),
    });

    await client.claimRun({ workerId: WORKER_ID, leaseDurationSeconds: 30 });
    const renewed = await client.renewLease({
      workerId: WORKER_ID,
      runId: RUN_ID,
      leaseDurationSeconds: 30,
    });

    assertEquals(renewed?.latest_external_event_sequence, 9);
  });

  it("preserves terminal completion when afterTerminal probe observation fails", async () => {
    const { calls, fetchImpl } = fetchSequence(
      jsonResponse(claim()),
      jsonResponse({ id: CANONICAL_RUN_ID, status: "completed" }),
    );
    const client = createExternalAgentWorkerClient({
      apiUrl: API_URL,
      authToken: API_TOKEN,
      fetch: fetchImpl,
      ownershipProbe: throwingProbe("afterTerminal"),
    });

    await client.claimRun({ workerId: WORKER_ID, leaseDurationSeconds: 30 });
    await client.completeRun({ runId: RUN_ID, status: "completed" });
    await assertRejects(
      () => client.completeRun({ runId: RUN_ID, status: "completed" }),
      Error,
      "Current worker claim authority is required",
    );

    assertEquals(String(calls[1]?.[0]), `${API_URL}/runs/${CANONICAL_RUN_ID}/finalize`);
    assertEquals(requestBody(calls[1]!), { status: "completed", output: null });
  });

  it("raises a network error for non-2xx worker API responses", async () => {
    const { fetchImpl } = fetchSequence(
      jsonResponse(claim()),
      jsonResponse({ error: "boom" }, 500),
    );
    const client = createExternalAgentWorkerClient({
      apiUrl: API_URL,
      authToken: API_TOKEN,
      fetch: fetchImpl,
    });

    await client.claimRun({ workerId: WORKER_ID, leaseDurationSeconds: 30 });
    await assertRejects(
      () => client.completeRun({ runId: RUN_ID, status: "completed" }),
      VeryfrontError,
      "boom",
      "non-2xx API responses must raise NETWORK_ERROR with the body detail",
    );
  });

  it("rejects an unauthorized claim instead of resolving to no run", async () => {
    const { fetchImpl } = fetchSequence(
      jsonResponse({ worker: worker(), token: WORKER_TOKEN }, 201),
      new Response(null, { status: 401 }),
    );
    const client = createExternalAgentWorkerClient({
      apiUrl: API_URL,
      authToken: API_TOKEN,
      fetch: fetchImpl,
    });

    const registeredWorker = await client.registerWorker({
      projectReference: PROJECT_REFERENCE,
      implementationKind: "veryfront-codex",
      implementationDisplayName: "Veryfront Codex",
      workerKey: "local-codex",
    });

    await assertRejects(
      () => client.claimRun({ workerId: registeredWorker.id, leaseDurationSeconds: 30 }),
      VeryfrontError,
      "Veryfront API returned HTTP 401",
      "an unauthorized claim must reject rather than resolve to null",
    );
  });
});
