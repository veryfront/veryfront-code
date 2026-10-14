import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { createExternalAgentWorkerClient } from "#veryfront/agent/service/external-worker-client.ts";
import type { AgentWorkerRuntimeOwnershipProbe } from "#veryfront/agent/service/agent-worker-runtime-ownership-probe.ts";

const API_URL = "https://api.example.com";
const API_TOKEN = "api-token";
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

function workerResponse() {
  return {
    worker: {
      id: WORKER_ID,
      project_id: PROJECT_ID,
      implementation_kind: "external",
      worker_key: "worker",
      display_name: "External",
      status: "online",
      metadata: null,
      last_heartbeat_at: null,
    },
    token: "worker-token",
  };
}

type FetchCall = [RequestInfo | URL, RequestInit | undefined];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

function authorization(call: FetchCall): string | null {
  return new Headers(call[1]?.headers).get("Authorization");
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

it("installs claim credentials with probe construction guarded from project-mutated Date.parse", async () => {
  const { calls, fetchImpl } = fetchSequence(
    jsonResponse({
      ...claim(),
      run: { ...claim().run, lease_expires_at: "2026-10-12T00:00:00.000Z" },
    }),
    jsonResponse({ appended: true }),
  );
  const originalDateParse = Date.parse;
  Date.parse = () => {
    throw new Error("project Date.parse poison");
  };
  try {
    const client = createExternalAgentWorkerClient({
      apiUrl: API_URL,
      authToken: API_TOKEN,
      fetch: fetchImpl,
    });
    const claimed = await client.claimRun({ workerId: WORKER_ID, leaseDurationSeconds: 30 });
    assertEquals(claimed?.run_id, RUN_ID);
    await client.appendRunEvents({
      conversationId: CONVERSATION_ID,
      runId: RUN_ID,
      events: [{ type: "AFTER_POISONED_INTRINSICS" }],
      expectedPreviousExternalEventSequence: claimed?.latest_external_event_sequence,
    });
    assertEquals(authorization(calls[1]!), "Bearer event-token");
  } finally {
    Date.parse = originalDateParse;
  }
});

it("keeps worker token routing stable when Map.prototype.get is replaced", async () => {
  const { calls, fetchImpl } = fetchSequence(
    jsonResponse(workerResponse(), 201),
    jsonResponse({ worker: workerResponse().worker }),
  );
  const originalMapGet = Map.prototype.get;
  const client = createExternalAgentWorkerClient({
    apiUrl: API_URL,
    authToken: API_TOKEN,
    fetch: fetchImpl,
  });
  const worker = await client.registerWorker({
    projectReference: "proj",
    implementationKind: "external",
    implementationDisplayName: "External",
    workerKey: "worker",
  });
  Map.prototype.get = function (_key: unknown) {
    return "evil-token";
  };
  try {
    await client.heartbeatWorker(worker.id);
  } finally {
    Map.prototype.get = originalMapGet;
  }
  assertEquals(authorization(calls[1]!), "Bearer worker-token");
});
