import "#veryfront/schemas/_test-setup.ts";
import {
  getCurrentToolCallOccurrenceIdentity,
  introduceToolCallOccurrence,
  runWithToolCallOccurrenceDispatch,
} from "#veryfront/runtime/tool-call-occurrence.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { createConnectedLocalRuntime } from "../../../src/agent/ag-ui/connected-local-runtime.ts";
import { createEphemeralAgent } from "../../../src/agent/factory.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  executeConfiguredTool,
  getAvailableTools,
} from "../../../src/agent/runtime/tool-helpers.ts";
import { resolveRuntimeToolLoading } from "../../../src/agent/runtime/runtime-tool-config.ts";
import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import { tool } from "#veryfront/tool/index.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { useServedCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.test-helpers.ts";
it("prepares a tools-true agent with its bounded single-agent catalog", async () => {
  using _catalog = useServedCatalogForTests();
  const workerId = "11111111-1111-4111-8111-111111111111";
  const projectId = "22222222-2222-4222-8222-222222222222";
  const conversationId = "33333333-3333-4333-8333-333333333333";
  const messageId = "44444444-4444-4444-8444-444444444444";
  const canonicalRunId = "55555555-5555-4555-8555-555555555555";
  const runId = "run-connected-tools";
  const persisted: Array<{ type: string; toolCallId?: string; delta?: string }> = [];
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const signed = `${encode({ alg: "RS256", kid: "local-test" })}.${
    encode({
      projectId,
      runId,
      agentId: "coder",
      userId: "server",
      serviceAccountId: "server",
      actorType: "service_account",
      tokenUse: "run_event_writer",
      scopes: ["agent-runs:events:append"],
      exp: Math.floor(Date.now() / 1000) + 60,
      platformToolDependencies: [],
    })
  }`;
  const writerToken = `${signed}.${
    sign("RSA-SHA256", Buffer.from(signed), privateKey).toString("base64url")
  }`;
  const terminalToken = `header.${
    btoa(JSON.stringify({
      runId,
      canonicalRunId,
      tokenUse: "run_event_writer",
      writerPurpose: "current_run_terminal",
      dispatchNonce: "generation",
    }))
  }.signature`;
  const worker = {
    id: workerId,
    project_id: projectId,
    implementation_kind: "veryfront-local",
    worker_key: "local-test",
    status: "online",
  };
  const fetch = ((input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/.well-known/jwks.json") {
      return Promise.resolve(
        Response.json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "local-test" }] }),
      );
    }
    if (path.endsWith("/workers")) {
      return Promise.resolve(Response.json({ worker, token: "worker-token" }));
    }
    if (path.endsWith("/heartbeat")) {
      return Promise.resolve(Response.json({ worker }));
    }
    if (path === "/conversations") {
      return Promise.resolve(Response.json({ id: conversationId }));
    }
    if (path === "/runs") {
      return Promise.resolve(Response.json({ id: canonicalRunId }));
    }
    if (path.endsWith("/claim")) {
      return Promise.resolve(Response.json({
        run: {
          run_id: runId,
          conversation_id: conversationId,
          message_id: messageId,
          project_id: projectId,
          agent_id: "coder",
          status: "running",
          request_snapshot: null,
          latest_event_id: 0,
          latest_external_event_sequence: 0,
          lease_owner: workerId,
          lease_expires_at: null,
          worker_session: null,
        },
        credentials: {
          auth_token: "run-auth-token",
          run_event_token: writerToken,
          run_terminal_token: terminalToken,
          inference_token: "run-inference-token",
        },
      }));
    }
    if (path.endsWith("/finalize")) {
      return Promise.resolve(Response.json({ id: canonicalRunId, status: "cancelled" }));
    }
    throw new Error(`Unexpected connected runtime request: ${path}`);
  }) as typeof globalThis.fetch;
  const makeTool = (id: string, ownerAgentId?: string) => ({
    ...tool({
      id,
      description: id,
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => ({ ok: true }),
    }),
    ...(ownerAgentId ? { ownerAgentId } : {}),
  });
  const registered = [
    "connected-global-tool",
    "coder--connected-owner-tool",
    "writer--connected-foreign-tool",
  ];
  toolRegistryInternal.register(registered[0]!, makeTool(registered[0]!));
  toolRegistryInternal.register(registered[1]!, makeTool(registered[1]!, "coder"));
  toolRegistryInternal.register(registered[2]!, makeTool(registered[2]!, "writer"));
  Deno.env.set("VERYFRONT_API_URL", "http://localhost:4400");
  await withMockFetch(fetch, async () => {
    const runtime = createConnectedLocalRuntime({
      apiBaseUrl: "http://localhost:4400",
      apiToken: "private",
      projectId,
      projectSlug: "sample",
      studioUrl: "http://localhost:3440",
    }, {
      fetch,
      log: () => {},
      append: async (events, sequence) => {
        persisted.push(...events as typeof persisted);
        const call = getCurrentToolCallOccurrenceIdentity();
        return {
          latestExternalEventSequence: sequence + events.length,
          toolCallAdmissions: call
            ? [{
              ...call,
              admissionEventId: "admitted",
              startEventId: "started",
              publicToolCallId: call.toolCallId,
              projectId,
              runId: canonicalRunId,
            }]
            : [],
        };
      },
    });

    try {
      const run = await runtime.admit({
        agentId: "coder",
        threadId: "thread",
        messages: [],
        signal: new AbortController().signal,
      });
      const source = createEphemeralAgent({
        id: "coder",
        system: "Use the project tools.",
        tools: true,
        knowledge: true,
        skills: false,
      });
      assertEquals(source.config.tools, true);
      assertEquals(resolveRuntimeToolLoading(source.config).mode, "deferred");

      const prepared = await run.prepareAgent(source);
      const preparedTools = prepared.config.tools;
      assertEquals(preparedTools, true);
      assertEquals(resolveRuntimeToolLoading(prepared.config).mode, "deferred");
      const definitions = await getAvailableTools(preparedTools, {
        callerAgentId: "coder",
        includeIntegrationTools: false,
        remoteToolSources: [{
          id: "connected-remote",
          listTools: () =>
            Promise.resolve([{
              name: "connected_remote_tool",
              description: "Authorized connected remote tool",
              parameters: { type: "object", properties: {} },
            }]),
          executeTool: () => Promise.resolve({ ok: true }),
        }],
      });
      const names = definitions.map((definition) => definition.name);
      assertEquals(names.includes(registered[0]!), true);
      assertEquals(names.includes(registered[1]!), true);
      assertEquals(names.includes(registered[2]!), false);
      assertEquals(names.includes("connected_remote_tool"), true);
      assertEquals(prepared.config.delegates, undefined);
      const call = { id: "call-test" };
      await run.execute(async () => {
        introduceToolCallOccurrence(call);
        await runWithToolCallOccurrenceDispatch(
          call,
          () =>
            executeConfiguredTool(registered[0]!, {}, {
              [registered[0]!]: makeTool(registered[0]!),
            }, { projectId, runId, agentId: "coder", toolCallId: call.id }),
        );
      });
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          for (
            const event of [
              { type: "tool-input-start", toolCallId: call.id, toolName: registered[0] },
              {
                type: "tool-input-available",
                toolCallId: call.id,
                toolName: registered[0],
                input: {},
              },
              { type: "tool-output-available", toolCallId: call.id, output: { ok: true } },
              { type: "message-finish" },
            ]
          ) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
          c.close();
        },
      });
      await new Response(run.wrapStream(body)).text();
      assertEquals(
        persisted.filter((event) => event.type === "TOOL_CALL_ARGS").map((event) => event.delta)
          .join(""),
        "{}",
      );
    } finally {
      await runtime.dispose().catch(() => {});
      for (const id of registered) toolRegistryInternal.delete(id);
    }
  });
});
