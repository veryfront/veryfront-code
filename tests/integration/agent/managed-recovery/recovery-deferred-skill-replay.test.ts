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

import {
  createManagedRecoveryWriter,
  type ManagedRecoveryWriter,
} from "#veryfront/internal-agents/managed-recovery-writer.ts";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import {
  createRuntimeAgentStreamResponse,
  PROVIDER_REPLAY_TURN_COMPLETE_SSE_EVENT_NAME,
} from "#veryfront/internal-agents/run-stream.ts";
import { bindManagedRecoveryInput } from "#veryfront/internal-agents/managed-recovery-input.ts";
import { agent as createAgent, AgentRuntime } from "#veryfront/agent/index.ts";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import { tool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas";
import { markTrustedHostToolProvenance } from "#veryfront/tool/host-tool-provenance.ts";
import { runWithoutRunEventSinks } from "#veryfront/runtime/run-event-sink-context.ts";
import { markRuntimeLocalTool } from "#veryfront/agent/runtime/local-tool.ts";

for (
  const mode of [
    { managed: true, replay: true, delegates: 2, cancel: false, eof: false },
    { managed: true, replay: true, delegates: 2, cancel: true, eof: false },
    { managed: true, replay: true, delegates: 0, cancel: false, eof: true },
    { managed: true, replay: true, delegates: 1, cancel: false, eof: false },
    { managed: false, replay: true, delegates: 2, cancel: false, eof: false },
    { managed: true, replay: false, delegates: 2, cancel: false, eof: false },
  ]
) {
  const name =
    `native skill delegation admits before deferred replay (managed=${mode.managed}, replay=${mode.replay}, delegates=${mode.delegates}, cancel=${mode.cancel}, eof=${mode.eof})`;
  it(name, { sanitizeOps: true, sanitizeResources: true }, async () => {
    const previous = Deno.env.get(envKey);
    const directory = await makeTempDir();
    let producerCompletion: Promise<void> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let manager: AgentRunSessionManager | undefined;
    try {
      const value = admission();
      const claims = await signed(value);
      let sequence = 0;
      let writer: ManagedRecoveryWriter | undefined;
      const admitted = new Set<string>();
      let loaded = 0;
      let timedOut = false;
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
          writer = await createManagedRecoveryWriter({
            claims,
            owner,
            directory,
            bindAdmissionWriter: () => {},
            append: async (event, occurrenceId, checkpoint) => {
              const eventId = ++sequence + 100;
              const toolCallId = String(event.toolCallId);
              if (event.type === "TOOL_CALL_START") admitted.add(toolCallId);
              return {
                eventId,
                externalSequence: sequence,
                toolAdmissions: event.type === "TOOL_CALL_START"
                  ? [{
                    occurrenceId: occurrenceId!,
                    admissionEventId: String(eventId + 10000),
                    startEventId: String(eventId),
                    toolCallId,
                    publicToolCallId: toolCallId,
                    projectId: identity.projectId,
                    runId: identity.canonicalRunId,
                  }]
                  : [],
                ...(checkpoint
                  ? {
                    recoveryCheckpoint: {
                      snapshot_event_id: eventId,
                      snapshot_external_sequence: sequence,
                      checkpoint_event_id: eventId + 20000,
                    },
                  }
                  : {}),
              };
            },
          });
          return { owner, writer };
        },
      });
      manager = sessionManager;
      const model = scriptedModel([
        {
          toolCalls: [
            { id: "load-1", name: "load_skill", input: { skillId: "delegate" } },
            ...Array.from(
              { length: mode.delegates },
              (_, i) => ({
                id: `child-${i + 1}`,
                name: "veryfront__invoke_agent",
                input: { task: `task-${i + 1}` },
              }),
            ),
          ],
        },
        { text: "Done" },
      ], {
        only: "stream",
        provider: "anthropic",
        modelId: "anthropic/managed-skill-replay-proof",
      });
      const input = {
        runId: identity.publicRunId,
        threadId: identity.threadId,
        messageId: crypto.randomUUID(),
        messages: [{ id: "synthetic-user", role: "user", content: "Load skill and delegate" }],
        tools: [{ name: "veryfront__invoke_agent" }],
        context: [],
      };
      if (mode.managed) bindManagedRecoveryInput(input, claims);
      const response = await createRuntimeAgentStreamResponse(
        input,
        createAgent({
          id: identity.agentId,
          model: "anthropic/managed-skill-replay-proof",
          system: "Synthetic",
          skills: true,
          maxSteps: 2,
          resolveModelTransport: () => ({ model }),
          tools: {
            load_skill: markRuntimeLocalTool(markTrustedHostToolProvenance(tool({
              id: "load_skill",
              description: "Load synthetic skill",
              inputSchema: defineSchema((v) => v.object({ skillId: v.string() }))(),
              execute: () => {
                if (mode.managed) assertEquals(admitted.size, mode.delegates + 1);
                loaded++;
                if (mode.cancel) sessionManager.cancelRun(identity.publicRunId);
                return {
                  skillId: "delegate",
                  instructions: "# Delegate",
                  allowedTools: ["veryfront__invoke_agent"],
                  references: [],
                  scripts: [],
                };
              },
            }))),
          },
        }),
        {
          sessionManager,
          providerReplayCheckpointEmissionEnabled: mode.replay,
          persistProviderReplayCheckpoint: async () => {},
          createRuntime: (runtimeAgent) => {
            if (mode.eof) {
              return {
                stream: async (_messages, _context, callbacks) => {
                  const completion = Promise.withResolvers<void>();
                  producerCompletion = completion.promise;
                  callbacks?.onStreamCompletion?.(producerCompletion);
                  return new ReadableStream<Uint8Array>({
                    start(controller) {
                      try {
                        controller.enqueue(
                          new TextEncoder().encode('data: {"type":"start-step"}\n\n'),
                        );
                        controller.close();
                      } finally {
                        completion.resolve();
                      }
                    },
                  });
                },
              };
            }

            let reportCompletion: ((completion: Promise<void>) => void) | undefined;
            const runtime = new AgentRuntime(runtimeAgent.id, runtimeAgent.config, {
              ...(writer ? { persistRecoveryBoundary: writer.persistBoundary } : {}),
              onStreamCompletion: (completion) => {
                producerCompletion = completion;
                reportCompletion?.(completion);
              },
            });
            return {
              // The scripted provider has no billing broker. Exclude only model
              // observation sinks; native replay, tool policy/admissions and actual
              // durable recovery boundaries retain their production paths.
              stream: (...args: Parameters<AgentRuntime["stream"]>) => {
                reportCompletion = args[2]?.onStreamCompletion;
                return runWithoutRunEventSinks(() => runtime.stream(...args));
              },
            };
          },
        },
      );
      for (let i = 0; i < mode.delegates; i++) {
        sessionManager.prepareForToolResult(identity.publicRunId, `child-${i + 1}`);
        sessionManager.submitToolResult(identity.publicRunId, {
          toolCallId: `child-${i + 1}`,
          result: { done: true },
        });
      }
      timer = setTimeout(() => {
        timedOut = true;
        sessionManager.cancelRun(identity.publicRunId);
      }, 5000);
      const body = await response.text();
      await producerCompletion?.catch(() => {});
      assertEquals(timedOut, false, body);
      if (mode.eof) {
        assertEquals(body.includes("event: RunError"), true, body);
        assertEquals(body.includes("event: RunFinished"), false, body);
        assertEquals(sessionManager.getRunStatus(identity.publicRunId), null);
        return;
      }
      assertEquals(loaded, 1, body);
      if (mode.cancel) {
        assertEquals(model.callCount, 1, body);
        assertEquals(body.includes("event: RunError"), true, body);
        assertEquals(body.includes("event: RunFinished"), false, body);
        assertEquals(sessionManager.getRunStatus(identity.publicRunId), null);
        return;
      }
      assertEquals(model.callCount, 2, body);
      assertEquals(body.includes("event: RunError"), false, body);
      assertEquals(body.includes("event: RunFinished"), true, body);
      if (mode.replay) {
        const replay = body.indexOf(PROVIDER_REPLAY_TURN_COMPLETE_SSE_EVENT_NAME);
        const childStart = body.split("\n\n").findIndex((frame) =>
          frame.includes("event: ToolCallStart") && frame.includes('"toolCallId":"child-1"')
        );
        const frames = body.split("\n\n");
        assertEquals(replay >= 0, true, body);
        assertEquals(body.indexOf(frames[childStart]!) > replay, true, body);
      }
    } finally {
      if (timer) clearTimeout(timer);
      manager?.cancelRun(identity.publicRunId);
      await producerCompletion?.catch(() => {});
      await Deno.remove(directory, { recursive: true });
      if (previous === undefined) Deno.env.delete(envKey);
      else Deno.env.set(envKey, previous);
    }
  });
}
