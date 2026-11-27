import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { clearModelProviders, registerModelProvider } from "#veryfront/provider";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { type Tool, tool, type ToolExecutionContext } from "#veryfront/tool";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { createDefaultHostedChatRuntime } from "#veryfront/agent/hosted/default-chat-runtime.ts";
import { registerHostedToolRunAuthorization } from "#veryfront/agent/hosted/tool-run-authorization.ts";

for (
  const admission of [
    "canonical",
    "legacy-alias",
    "unbound",
    "project-mismatch",
    "run-mismatch",
  ] as const
) {
  it(`hosted chat approval requires private run authority and isolates occurrences: ${admission}`, async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const canonicalRunId = "22222222-2222-4222-8222-222222222222";
    const runId = admission === "legacy-alias" ? "legacy-run" : canonicalRunId;
    const admitted = admission === "canonical" || admission === "legacy-alias";
    const token = "synthetic-host-only-approval-credential";
    const requests: Array<{ url: string; body: Record<string, unknown>; key: string | null }> = [];
    const contexts: ToolExecutionContext[] = [];
    const modelId = "test/hosted-tool-approval";
    const model = scriptedModel([
      { toolCalls: [{ id: "reused-call", name: "transfer", input: { amount: 12 } }] },
      { toolCalls: [{ id: "reused-call", name: "transfer", input: { amount: 12 } }] },
      { text: "Done" },
    ], { provider: "test", modelId });
    clearModelProviders();
    registerModelProvider("test", () => model);
    const gated = tool({
      id: "transfer",
      description: "Transfer the requested amount",
      approval: {},
      inputSchema: defineSchema((v) => v.object({ amount: v.number() }))(),
      execute: (_input, context) => {
        contexts.push(context!);
        return { ok: true };
      },
    });
    const options = {
      projectId,
      runId,
      agentId: "cashier",
      authToken: token,
      model: modelId,
      instructions: "Use transfer when asked.",
      allowedTools: ["transfer"],
      maxSteps: 5,
    };
    if (admission !== "unbound") {
      registerHostedToolRunAuthorization(options, {
        projectId: admission === "project-mismatch" ? "other-project" : projectId,
        runId: admission === "run-mismatch" ? "other-run" : runId,
        ...(admission === "legacy-alias" ? { approvalRunId: canonicalRunId } : {}),
      });
    }
    try {
      await withMockFetch(
        () => Promise.resolve(Response.json({ tools: [], models: [] })),
        async () => {
          const runtime = await createDefaultHostedChatRuntime({
            sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
            options,
            config: {
              apiUrl: "https://api.example.test",
              apiMcpUrl: "https://api.example.test/mcp",
            },
            approvalFetch: async (url, init) => {
              const headers = new Headers(init?.headers);
              assertEquals(headers.get("authorization"), `Bearer ${token}`);
              assertEquals(init?.method, "POST");
              const body = JSON.parse(String(init?.body));
              assertEquals(contexts.length, requests.length);
              requests.push({ url: String(url), body, key: headers.get("idempotency-key") });
              return Response.json({
                ...body,
                input_request_id: crypto.randomUUID(),
                status: "submitted",
                response: {
                  values: { decision: "approve" },
                  actor: { type: "human", id: "checker" },
                },
              }, { status: 201 });
            },
            buildLocalTools: () => ({ transfer: gated as unknown as Tool }),
            createRemoteToolSource: (config) => ({
              id: config.id ?? "source",
              listTools: () => Promise.resolve([]),
              executeTool: () => Promise.reject(new Error("Unexpected remote tool")),
            }),
            preloadLatestConversationUserText: false,
          });
          try {
            const result = await runtime.agent.stream({
              messages: [],
              abortSignal: new AbortController().signal,
            });
            const chunks = [];
            for await (const chunk of result.toUIMessageStream()) chunks.push(chunk);
            assertEquals(JSON.stringify(chunks).includes(token), false);
            assertEquals(requests.length, admitted ? 2 : 0);
            assertEquals(contexts.length, admitted ? 2 : 0);
            if (!admitted) return;
            const [first, second] = requests;
            assertExists(first);
            assertExists(second);
            assertEquals(requests.map((request) => request.url), [
              `https://api.example.test/runs/${canonicalRunId}/input-requests`,
              `https://api.example.test/runs/${canonicalRunId}/input-requests`,
            ]);
            assertEquals(first.body.responder_rules, {
              exclude_run_starters: true,
              required_capability: "project.approvals.decide",
            });
            assertExists(first.body.metadata);
            assertEquals(first.key === second.key, false);
            assertEquals(JSON.stringify(chunks).includes(token), false);
            for (const context of contexts) {
              assertEquals(context.runId, runId);
              assertEquals(context.projectId, projectId);
              assertEquals("authToken" in context, false);
            }
          } finally {
            await runtime.cleanup();
          }
        },
      );
    } finally {
      clearModelProviders();
    }
  });
}
