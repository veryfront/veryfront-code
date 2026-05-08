import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createExternalAgentWorkerClient,
  type ExternalAgentWorker,
} from "./external-agent-worker-client.ts";

const API_URL = "https://api.example.com";
const API_TOKEN = "api-token";
const WORKER_TOKEN = "worker-token";
const PROJECT_REFERENCE = "testing-project";
const WORKER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "run_123";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";

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
        run: {
          run_id: RUN_ID,
          conversation_id: CONVERSATION_ID,
          message_id: "44444444-4444-4444-8444-444444444444",
          project_id: PROJECT_ID,
          agent_id: "veryfront-agent",
          status: "running",
          request_snapshot: { messages: [], tools: [], context: [] },
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
      jsonResponse({ completed: true }),
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
    assertEquals(requestBody(calls[1]!), { lease_duration_seconds: 30 });
    assertEquals(
      String(calls[2]?.[0]),
      `${API_URL}/agent-workers/workers/${WORKER_ID}/runs/${RUN_ID}/session`,
    );
    assertEquals(authorization(calls[2]!), `Bearer ${WORKER_TOKEN}`);
    assertEquals(requestBody(calls[2]!), {
      session_key: "codex-session-1",
      status: "active",
      metadata: { workspacePath: "/workspace" },
    });
    assertEquals(
      String(calls[3]?.[0]),
      `${API_URL}/conversations/${CONVERSATION_ID}/runs/${RUN_ID}/events`,
    );
    assertEquals(requestBody(calls[3]!), {
      events: [{ type: "TEXT_MESSAGE_CHUNK", payload: { delta: "hello" } }],
      expected_previous_external_event_sequence: 4,
    });
    assertEquals(String(calls[4]?.[0]), `${API_URL}/runs/${RUN_ID}/complete`);
  });
});
