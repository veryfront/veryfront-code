import "#veryfront/schemas/_test-setup.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { RecoverySessionOwner } from "#veryfront/internal-agents/recovery-session-owner.ts";
import {
  createControlPlaneSignature,
  createCtx,
} from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";
import { verifyControlPlaneRequest } from "#veryfront/internal-agents/control-plane-auth.ts";
import {
  assertManagedRecoveryExecutionBinding,
  assertManagedRecoveryRequestBinding,
  bindManagedRecoveryInput,
} from "#veryfront/internal-agents/managed-recovery-input.ts";
import {
  getInternalAgentStreamRequestSchema,
  toRuntimeRunAgentInput,
} from "#veryfront/internal-agents/schema.ts";

const projectId = "11111111-1111-4111-8111-111111111111";
const threadId = "77777777-7777-4777-8777-777777777777";
const environmentId = "33333333-3333-4333-8333-333333333333";
const releaseId = "44444444-4444-4444-8444-444444444444";
const key = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";

it("signed recovery execution binds immutable source, agent and conversation before discovery", async () => {
  const prior = Deno.env.get(key);
  try {
    const input = getInternalAgentStreamRequestSchema().parse({
      agentId: "proof-agent",
      threadId,
      runId: "run-proof",
      runtimeTargetKind: "environment",
      runtimeTargetEnvironmentId: environmentId,
      sourceTargetEnvironmentId: environmentId,
      agentSource: { type: "environment", environmentName: "test", releaseId },
      messages: [],
    });
    const admission = {
      version: 1,
      identity: {
        projectId,
        canonicalRunId: "22222222-2222-4222-8222-222222222222",
        publicRunId: input.runId,
        agentId: input.agentId,
        threadId: input.threadId,
        sourceHash: "a".repeat(64),
      },
      generation: {
        workerId: "worker-1",
        dispatchNonce: "66666666-6666-4666-8666-666666666666",
        transportRecoveryAttempt: 0,
      },
      eventPersistence: "runtime-owned-v1",
      acknowledgedExternalSequence: 0,
      leaseRemainingMs: 10_000,
      sourceBinding: { projectId, environmentId, releaseId },
      expiresAt: Math.floor(Date.now() / 1000) + 30,
    };
    const body = JSON.stringify({ ...input, managedRecoveryAdmission: admission });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      projectId,
      requestId: input.runId,
    });
    Deno.env.set(key, publicKeyPem);
    const ctx = createCtx(publicKeyPem);
    ctx.projectId = projectId;
    const claims = await verifyControlPlaneRequest(
      new Request(`https://veryfront.test/api/control-plane/runs/${input.runId}/stream`, {
        method: "POST",
        headers: { "x-veryfront-control-plane-jws": jws },
      }),
      ctx,
      body,
    );
    const overriddenInput = getInternalAgentStreamRequestSchema().parse({
      ...input,
      agentConfig: {
        id: input.agentId,
        name: "Request override",
        description: "Synthetic request-scoped override",
        instructions: "Execute a different recovery policy.",
        tools: ["veryfront__search_knowledge"],
      },
    });
    // Ordinary execution still supports per-request definitions. Recovery may
    // execute only the immutable definition covered by its admitted source hash.
    assertManagedRecoveryExecutionBinding(overriddenInput, undefined);
    assertThrows(() => assertManagedRecoveryExecutionBinding(overriddenInput, claims));
    assertManagedRecoveryExecutionBinding(input, claims);
    const directory = await Deno.makeTempDir();
    try {
      const owner = await RecoverySessionOwner.acquire({
        claims,
        directory,
        awaitRetiredPreviousOwner: async () => {},
        validateCurrentOwnership: async () => ({
          version: 1,
          identity: {
            projectId,
            canonicalRunId: admission.identity.canonicalRunId,
            publicRunId: input.runId,
            agentId: input.agentId,
            threadId,
          },
          generation: admission.generation,
          acknowledgedEventId: 0,
          acknowledgedExternalSequence: 0,
          leaseRemainingMs: 10_000,
        }),
      });
      const session = { owner, signal: new AbortController().signal, settle: () => {} };
      const boundInput = { ...input, forwardedProps: { a: 1, b: 2 } };
      await assertManagedRecoveryRequestBinding(boundInput, session);
      await assertManagedRecoveryRequestBinding({
        ...input,
        forwardedProps: { b: 2, a: 1 },
      }, session);
      for (
        const overrides of [
          { context: [{ type: "text", text: "Different runtime context" }] },
          { state: { changed: true } },
          { forwardedProps: { a: 1, b: 3 } },
          { tools: [{ name: "different_tool" }] },
          { allowDelegation: false },
          { resumeToolCall: { id: "pending", name: "different_tool", input: {} } },
        ]
      ) {
        const replacement = getInternalAgentStreamRequestSchema().parse({
          ...boundInput,
          ...overrides,
        });
        await assertRejects(() => assertManagedRecoveryRequestBinding(replacement, session));
        await assertManagedRecoveryRequestBinding(boundInput, session);
      }
      const oversized = getInternalAgentStreamRequestSchema().parse({
        ...input,
        messages: [{ id: "large", role: "user", content: "x".repeat(240_000) }],
      });
      assertManagedRecoveryExecutionBinding(oversized, undefined);
      assertThrows(() => assertManagedRecoveryExecutionBinding(oversized, claims));
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
    bindManagedRecoveryInput(toRuntimeRunAgentInput(input), claims);
    // Shared-source execution resolves its source environment independently of
    // the requesting project's runtime environment.
    assertManagedRecoveryExecutionBinding({
      ...input,
      sourceTargetEnvironmentId: undefined,
      runtimeTargetEnvironmentId: projectId,
      sourceProject: {
        projectId,
        projectSlug: "synthetic-source",
        runtimeTargetKind: "environment",
        runtimeTargetEnvironmentId: environmentId,
      },
    }, claims);
    for (
      const foreign of [
        { ...input, agentId: "other-agent" },
        { ...input, threadId: "88888888-8888-4888-8888-888888888888" },
        { ...input, agentSource: { type: "branch" as const, branch: "main" } },
        {
          ...input,
          agentSource: { ...input.agentSource, type: "release" as const, releaseId: projectId },
        },
        { ...input, sourceTargetEnvironmentId: projectId },
        { ...input, sourceTargetEnvironmentId: undefined, runtimeTargetEnvironmentId: undefined },
      ]
    ) {
      assertThrows(() => assertManagedRecoveryExecutionBinding(foreign, claims));
    }
    assertThrows(() =>
      bindManagedRecoveryInput({ ...toRuntimeRunAgentInput(input), threadId: projectId }, claims)
    );
    assertEquals(input.threadId, threadId);
  } finally {
    if (prior === undefined) Deno.env.delete(key);
    else Deno.env.set(key, prior);
  }
});
