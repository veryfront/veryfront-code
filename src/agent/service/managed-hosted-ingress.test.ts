import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  parseManagedAgUiAgentIngress,
  parseManagedDurableAgentIngress,
} from "./managed-hosted-ingress.ts";

const projectId = "10000000-1000-4000-8000-100000000005";
const conversationId = "10000000-1000-4000-8000-100000000001";
const messageId = "10000000-1000-4000-8000-100000000002";

function authenticate() {
  return Promise.resolve({ userId: "user-1", authToken: "broker-auth-secret" });
}

function verifyProjectAccess() {
  return Promise.resolve({ success: true as const, projectSlug: "demo" });
}

describe("managed agent ingress", () => {
  it("separates durable broker authority from a detached executor request", async () => {
    const request = new Request("https://agent.example.test/api/runs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Veryfront-Run-Event-Token": "run-event-secret",
        "X-Veryfront-Inference-Token": "inference-secret",
      },
      body: JSON.stringify({
        messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Hello" }] }],
        context: { conversationId, projectId, branchId: "branch-1" },
        durableRootRun: { runId: "run_root_1", messageId },
      }),
    });

    const result = await parseManagedDurableAgentIngress(request, {
      authenticate,
      verifyProjectAccess,
      verifyRunEventAppendToken: () => Promise.resolve(true),
    });
    if (result instanceof Response) throw new Error("Expected managed durable ingress");

    assertEquals(result.kind, "durable");
    assertEquals(result.executor.kind, "durable");
    assertEquals(result.executor.projectId, projectId);
    assertEquals(result.executor.projectSlug, "demo");
    assertEquals(result.executor.durableRootRun, { runId: "run_root_1", messageId });
    assertEquals(result.executor.serverEnvelopeVerified, false);
    assertEquals(
      JSON.stringify(result),
      JSON.stringify({
        kind: "durable",
        broker: {},
        executor: result.executor,
      }),
    );

    const serialized = JSON.stringify(result.executor);
    for (const secret of ["broker-auth-secret", "run-event-secret", "inference-secret"]) {
      assertEquals(serialized.includes(secret), false);
    }
    for (const forbiddenKey of ["authToken", "authorization", "rawRequest", "headers"]) {
      assertEquals(forbiddenKey in result.executor, false);
    }

    assertEquals(typeof result.broker.createInferenceModelResolver(), "function");
    assertEquals(
      typeof result.broker.createRunEventWriterCapability({
        apiUrl: "https://api.example.test",
      })?.mintChildRunEventWriterCapability,
      "function",
    );
    assertEquals(result.broker.getParsedRequest().authToken, "broker-auth-secret");

    const parsed = result.broker.getParsedRequest();
    const originalText = parsed.messages[0]?.parts[0];
    if (originalText && typeof originalText === "object" && "text" in originalText) {
      originalText.text = "mutated after projection";
    }
    assertEquals(JSON.stringify(result.executor).includes("mutated after projection"), false);
  });

  it("preserves AG-UI validation shape and keeps unverified replay state out of the executor", async () => {
    const invalid = await parseManagedAgUiAgentIngress(
      new Request("https://agent.example.test/api/ag-ui", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: "missing-thread-and-messages" }),
      }),
      { authenticate, verifyProjectAccess },
    );
    if (!(invalid instanceof Response)) throw new Error("Expected validation response");
    assertEquals(invalid.status, 400);
    const invalidBody = await invalid.json();
    assertEquals((invalidBody as { errorCode?: unknown }).errorCode, "VALIDATION_ERROR");
    assertEquals(typeof (invalidBody as { message?: unknown }).message, "string");

    const result = await parseManagedAgUiAgentIngress(
      new Request("https://agent.example.test/api/ag-ui", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: "11111111-1111-4111-8111-111111111111",
          runId: "run-1",
          messages: [{ id: "u1", role: "user", content: "Hello" }],
          tools: [],
          context: [{ description: "veryfront.projectId", value: JSON.stringify(projectId) }],
          forwardedProps: {
            serverResolvedProviderReplayCheckpoints: { forged: "replay-secret" },
          },
          serverResolvedProviderReplayCheckpoints: { forged: "top-level-replay-secret" },
        }),
      }),
      { authenticate, verifyProjectAccess },
    );
    if (result instanceof Response) throw new Error("Expected managed AG-UI ingress");

    assertEquals(result.kind, "ag-ui");
    assertEquals(result.executor.kind, "ag-ui");
    assertEquals(result.executor.agUi, {
      threadId: "11111111-1111-4111-8111-111111111111",
      runId: "run-1",
      parentRunId: null,
      tools: [],
      context: [{ description: "veryfront.projectId", value: JSON.stringify(projectId) }],
    });
    const serialized = JSON.stringify(result.executor);
    assertEquals(serialized.includes("broker-auth-secret"), false);
    assertEquals(serialized.includes("replay-secret"), false);
    assertEquals(result.broker.createInferenceModelResolver(), undefined);
    assertEquals(
      result.broker.createRunEventWriterCapability({ apiUrl: "https://api.example.test" }),
      undefined,
    );
  });

  it("authenticates AG-UI before reading the request body", async () => {
    const request = new Request("https://agent.example.test/api/ag-ui", {
      method: "POST",
      headers: { "X-Veryfront-Run-Event-Token": "must-stay-broker-private" },
      body: "not json",
    });
    const response = new Response("unauthenticated", { status: 401 });
    const result = await parseManagedAgUiAgentIngress(request, {
      authenticate: (applicationRequest) => {
        assertEquals(applicationRequest.headers.get("X-Veryfront-Run-Event-Token"), null);
        return Promise.resolve(response);
      },
    });

    assertEquals(result, response);
    assertEquals(request.bodyUsed, false);
    assertEquals(
      request.headers.get("X-Veryfront-Run-Event-Token"),
      "must-stay-broker-private",
    );
  });
});
