import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import "#veryfront/schemas/_test-setup.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  createControlPlaneSignature,
  createCtx,
} from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";
import { verifyControlPlaneRequest } from "#veryfront/internal-agents/control-plane-auth.ts";
import { RecoverySessionOwner } from "#veryfront/internal-agents/recovery-session-owner.ts";

const envKey = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
const identity = {
  projectId: "11111111-1111-4111-8111-111111111111",
  canonicalRunId: "22222222-2222-4222-8222-222222222222",
  publicRunId: "run-proof",
  agentId: "proof-agent",
  threadId: "77777777-7777-4777-8777-777777777777",
  sourceHash: "a".repeat(64),
};
function admission(attempt = 0) {
  return {
    version: 1,
    identity,
    generation: {
      workerId: `worker-${attempt}`,
      dispatchNonce: `66666666-6666-4666-8666-${String(attempt).padStart(12, "0")}`,
      transportRecoveryAttempt: attempt,
    },
    acknowledgedExternalSequence: 0,
    leaseRemainingMs: 10_000,
    sourceBinding: {
      projectId: identity.projectId,
      environmentId: "33333333-3333-4333-8333-333333333333",
      releaseId: "44444444-4444-4444-8444-444444444444",
    },
    eventPersistence: "runtime-owned-v1" as const,
    expiresAt: Math.floor(Date.now() / 1000) + 30,
  };
}
function receipt(value = admission()) {
  return {
    version: 1,
    identity: {
      projectId: value.identity.projectId,
      canonicalRunId: value.identity.canonicalRunId,
      publicRunId: value.identity.publicRunId,
      agentId: value.identity.agentId,
      threadId: value.identity.threadId,
    },
    generation: value.generation,
    acknowledgedEventId: 0,
    acknowledgedExternalSequence: value.acknowledgedExternalSequence,
    leaseRemainingMs: value.leaseRemainingMs,
  };
}
async function signed(value = admission()) {
  const body = JSON.stringify({
    managedRecoveryAdmission: value,
    credentials: { authToken: "NEVER_PERSIST_TEST_CREDENTIAL" },
  });
  const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
    projectId: value.sourceBinding.projectId,
    requestId: identity.publicRunId,
  });
  Deno.env.set(envKey, publicKeyPem);
  const ctx = createCtx(publicKeyPem);
  ctx.projectId = value.sourceBinding.projectId;
  return await verifyControlPlaneRequest(
    new Request(`https://veryfront.test/api/control-plane/runs/${identity.publicRunId}/stream`, {
      method: "POST",
      headers: { "x-veryfront-control-plane-jws": jws },
    }),
    ctx,
    body,
  );
}

import { createManagedRecoveryWriter } from "#veryfront/internal-agents/managed-recovery-writer.ts";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import { createRuntimeAgentStreamResponse } from "#veryfront/internal-agents/run-stream.ts";
import { bindManagedRecoveryInput } from "#veryfront/internal-agents/managed-recovery-input.ts";
import { agent as createAgent } from "#veryfront/agent/index.ts";
import { createMockResult } from "#veryfront/agent/runtime/chat-stream-handler.test-helpers.ts";
import {
  createRuntimeStreamSource,
  createStreamState,
  processStream,
} from "#veryfront/agent/runtime/chat-stream-handler.ts";

for (const mode of ["provider", "trailing-provider", "local"] as const) {
  it(`managed actual streaming preserves observed results and strict local admission (${mode})`, async () => {
    const previous = Deno.env.get(envKey);
    const directory = await makeTempDir();
    try {
      const value = admission();
      const claims = await signed(value);
      let sequence = 0;
      const appended: Record<string, unknown>[] = [];
      const sessionManager = new AgentRunSessionManager({
        recoveryOwnerFactory: async () => {
          const owner = await RecoverySessionOwner.acquire({
            claims,
            directory: `${directory}/owner`,
            validateCurrentOwnership: async () => ({
              ...receipt(value),
              acknowledgedEventId: sequence + 100,
              acknowledgedExternalSequence: sequence,
            }),
            awaitRetiredPreviousOwner: async () => {},
          });
          const writer = await createManagedRecoveryWriter({
            claims,
            owner,
            directory,
            bindAdmissionWriter: () => {},
            append: async (event, occurrence) => {
              appended.push(event);
              if (mode !== "local") assertEquals(occurrence, undefined);
              return { eventId: ++sequence + 100, externalSequence: sequence, toolAdmissions: [] };
            },
          });
          return { owner, writer };
        },
      });
      const input = {
        runId: identity.publicRunId,
        threadId: identity.threadId,
        messages: [],
        tools: [],
        context: [],
      };
      bindManagedRecoveryInput(input, claims);
      const response = await createRuntimeAgentStreamResponse(
        input,
        createAgent({
          id: identity.agentId,
          model: "openai/gpt-4.1",
          system: "Synthetic",
          skills: false,
          tools: {},
        }),
        {
          sessionManager,
          createRuntime: () => ({
            stream: async (_messages, _context, callbacks) => {
              let completion!: Promise<void>;
              const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                  completion = processStream(
                    createRuntimeStreamSource(() =>
                      createMockResult([
                        ...(mode === "local"
                          ? [
                            { type: "tool-input-start", id: "native-1", toolName: "create_file" },
                            { type: "tool-input-delta", id: "native-1", delta: '{"path":"a.md"}' },
                            { type: "tool-input-end", id: "native-1" },
                          ]
                          : [{
                            type: "tool-result",
                            toolCallId: "native-1",
                            toolName: "web_search",
                            output: "done",
                            providerExecuted: true,
                          }]),
                        {
                          type: "finish",
                          finishReason: mode === "local" ? "tool-calls" : "stop",
                          totalUsage: null,
                        },
                      ])
                    ),
                    createStreamState(),
                    controller,
                    new TextEncoder(),
                    "provider-message",
                    {
                      streamLifecycleMode: "active",
                      providerExecutedToolNames: ["web_search"],
                      availableToolNames: ["web_search", "create_file"],
                    },
                    undefined,
                  ).then(() => controller.close(), (error) => {
                    controller.error(error);
                    throw error;
                  });
                },
              });
              callbacks?.onStreamCompletion?.(completion);
              if (mode === "trailing-provider") {
                // Preserve a real producer's observational start but omit its final
                // SSE delimiter to exercise the reader's trailing-frame path.
                const body = await new Response(stream).text();
                const start = body.split("\n\n").find((frame) =>
                  frame.includes('"type":"tool-input-start"')
                );
                if (!start) throw new Error("Actual provider stream omitted its observed start");
                return new ReadableStream<Uint8Array>({
                  start(controller) {
                    controller.enqueue(new TextEncoder().encode(start));
                    controller.close();
                  },
                });
              }
              return stream;
            },
          }),
        },
      );
      const body = await response.text();
      assertEquals(body.includes("event: RunError"), mode === "local", body);
      if (mode === "local") {
        assertEquals(
          body.includes("Recovery tool start lacks exact durable admission"),
          true,
          body,
        );
      }
      assertEquals(body.includes("event: ToolCallResult"), mode === "provider", body);
      if (mode !== "local") assertEquals(body.includes("event: RunFinished"), true, body);
      assertEquals(body.includes("privateObservedToolResult"), false, body);
      assertEquals(
        appended.some((event) =>
          event.type === "TOOL_CALL_START" && event.toolCallId === "native-1"
        ),
        true,
      );
      assertEquals(
        appended.some((event) =>
          event.type === "TOOL_CALL_RESULT" && event.toolCallId === "native-1"
        ),
        mode === "provider",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
      if (previous === undefined) Deno.env.delete(envKey);
      else Deno.env.set(envKey, previous);
    }
  });
}
