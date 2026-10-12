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
