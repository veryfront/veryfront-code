import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import "#veryfront/schemas/_test-setup.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createEmptyDiscoveryResult } from "#veryfront/discovery";
import { AgentRunSessionManager } from "#veryfront/internal-agents/session-manager.ts";
import { RecoverySessionOwner } from "#veryfront/internal-agents/recovery-session-owner.ts";
import { getVerifiedControlPlaneRecoveryAdmission } from "#veryfront/internal-agents/control-plane-auth.ts";
import {
  INGRESS_RUN_TERMINAL_TOKEN_HEADER,
  sealIngressCredentials,
} from "#veryfront/security/http/ingress-credentials.ts";
import {
  AgentStreamHandler,
  type AgentStreamHandlerDeps,
} from "#veryfront/server/handlers/request/agent-stream.handler.ts";
import {
  createAgentWithConfig,
  createControlPlaneSignature,
} from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";
import {
  createAgentStreamRequestBody,
  createSourceCapableAgentStreamContext as createCtx,
} from "#veryfront/server/handlers/request/agent-stream.handler.test-helpers.ts";
import { AgentRunCancelHandler } from "#veryfront/server/handlers/request/agent-run-cancel.handler.ts";
const TEST_PUBLIC_STUDIO_MCP_URL = "https://93.184.216.35/studio-mcp";
function createTestAgentStreamHandler(deps: AgentStreamHandlerDeps): AgentStreamHandler {
  return new AgentStreamHandler({ loadAgentSourceEnvironment: () => Promise.resolve({}), ...deps });
}

it("sealed ingress preserves terminal authority for managed recovery admission", async () => {
  const projectId = "11111111-1111-4111-8111-111111111111";
  let discoveryCalls = 0;
  let ownershipSuperseded = false;
  const recoveryDirectory = await makeTempDir();
  const handler = createTestAgentStreamHandler({
    ensureProjectDiscovery: async () => {
      discoveryCalls++;
      return createEmptyDiscoveryResult();
    },
    getAgent: () => undefined,
    getAllAgentIds: () => [],
    sessionManager: new AgentRunSessionManager({
      recoveryOwnerFactory: async ({ claims, awaitRetiredPreviousOwner }) => {
        const admission = getVerifiedControlPlaneRecoveryAdmission(claims);
        if (!admission) throw new Error("Expected verified recovery admission");
        const owner = await RecoverySessionOwner.acquire({
          claims,
          directory: recoveryDirectory,
          awaitRetiredPreviousOwner,
          validateCurrentOwnership: async () => ({
            version: 1,
            identity: {
              projectId: admission.identity.projectId,
              canonicalRunId: admission.identity.canonicalRunId,
              publicRunId: admission.identity.publicRunId,
              agentId: admission.identity.agentId,
              threadId: admission.identity.threadId,
            },
            generation: ownershipSuperseded
              ? { ...admission.generation, dispatchNonce: "77777777-7777-4777-8777-777777777777" }
              : admission.generation,
            acknowledgedEventId: 0,
            acknowledgedExternalSequence: 0,
            leaseRemainingMs: 10_000,
          }),
        });
        return { owner };
      },
    }),
  });
  const body = createAgentStreamRequestBody({
    project: { projectId, sourceTargetEnvironmentId: "33333333-3333-4333-8333-333333333333" },
    agentSource: { type: "release", releaseId: "44444444-4444-4444-8444-444444444444" },
    credentials: { authToken: "synthetic-invocation" },
    managedRecoveryAdmission: {
      version: 1,
      identity: {
        projectId,
        canonicalRunId: "22222222-2222-4222-8222-222222222222",
        publicRunId: "run_1",
        agentId: "assistant-1",
        threadId: "10000000-1000-4000-8000-100000000001",
        sourceHash: "a".repeat(64),
      },
      generation: {
        workerId: "worker-1",
        dispatchNonce: "66666666-6666-4666-8666-666666666666",
        transportRecoveryAttempt: 0,
      },
      acknowledgedExternalSequence: 0,
      leaseRemainingMs: 10_000,
      sourceBinding: {
        projectId,
        environmentId: "33333333-3333-4333-8333-333333333333",
        releaseId: "44444444-4444-4444-8444-444444444444",
      },
      eventPersistence: "runtime-owned-v1",
      expiresAt: Math.floor(Date.now() / 1000) + 30,
    },
  });
  const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
    requestId: "run_1",
    projectId,
  });
  const request = sealIngressCredentials(
    new Request("https://example.com/api/control-plane/runs/run_1/stream", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-veryfront-control-plane-jws": jws,
        [INGRESS_RUN_TERMINAL_TOKEN_HEADER]: "synthetic-terminal",
      },
      body,
    }),
  );
  assertEquals(request.headers.get(INGRESS_RUN_TERMINAL_TOKEN_HEADER), null);
  const ctx = createCtx(publicKeyPem);
  ctx.projectId = projectId;
  const previousKey = Deno.env.get("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");
  Deno.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", publicKeyPem);
  try {
    const result = await handler.handle(request, ctx);
    assertExists(result.response);
    assertEquals(result.response.status, 404);
    assertEquals(await result.response.json(), { error: "Agent not found" });
    assertEquals(discoveryCalls, 1);
    // Even validly signed duplicate/stale dispatches must fail before tenant discovery.
    for (const superseded of [false, true]) {
      ownershipSuperseded = superseded;
      const rejected = await handler.handle(
        sealIngressCredentials(
          new Request("https://example.com/api/control-plane/runs/run_1/stream", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-veryfront-control-plane-jws": jws,
              [INGRESS_RUN_TERMINAL_TOKEN_HEADER]: "synthetic-terminal",
            },
            body,
          }),
        ),
        ctx,
      );
      assertExists(rejected.response);
      await rejected.response.body?.cancel();
      assertEquals(rejected.response.status >= 400, true);
      assertEquals(discoveryCalls, 1);
    }
    for (
      const foreignBody of [
        JSON.stringify({
          ...JSON.parse(body),
          messages: [{ id: "large-history", role: "user", content: "x".repeat(240_000) }],
        }),
        JSON.stringify({
          ...JSON.parse(body),
          agentConfig: {
            id: "assistant-1",
            name: "Request override",
            description: "Synthetic request-scoped override",
            instructions: "Execute a different recovery policy.",
            tools: ["veryfront__search_knowledge"],
          },
        }),
        body.replace('"agentId":"assistant-1"', '"agentId":"other-agent"'),
        body.replace(
          '"conversationId":"10000000-1000-4000-8000-100000000001"',
          '"conversationId":"88888888-8888-4888-8888-888888888888"',
        ),
        body.replace(
          '"agentSource":{"type":"release","releaseId":"44444444-4444-4444-8444-444444444444"}',
          '"agentSource":{"type":"release","releaseId":"88888888-8888-4888-8888-888888888888"}',
        ),
        body.replace(
          '"sourceTargetEnvironmentId":"33333333-3333-4333-8333-333333333333"',
          '"sourceTargetEnvironmentId":"88888888-8888-4888-8888-888888888888"',
        ),
      ]
    ) {
      assertEquals(foreignBody !== body, true);
      const signed = await createControlPlaneSignature(foreignBody, {
        requestId: "run_1",
        projectId,
      });
      Deno.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", signed.publicKeyPem);
      const foreignCtx = createCtx(signed.publicKeyPem);
      foreignCtx.projectId = projectId;
      const rejected = await handler.handle(
        sealIngressCredentials(
          new Request("https://example.com/api/control-plane/runs/run_1/stream", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-veryfront-control-plane-jws": signed.jws,
              [INGRESS_RUN_TERMINAL_TOKEN_HEADER]: "synthetic-terminal",
            },
            body: foreignBody,
          }),
        ),
        foreignCtx,
      );
      assertExists(rejected.response);
      assertEquals(rejected.response.status >= 400, true);
      if (foreignBody.length > 200_000) assertEquals(rejected.response.status, 400);
      await rejected.response.body?.cancel();
      assertEquals(discoveryCalls, 1);
    }
  } finally {
    await Deno.remove(recoveryDirectory, { recursive: true });
    if (previousKey === undefined) Deno.env.delete("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");
    else Deno.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", previousKey);
  }
});

for (const expireBeforeHandoff of [false, true]) {
  it(`retains reservation cleanup until runtime consumes the session (expired=${expireBeforeHandoff})`, async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    let discoveryCalls = 0;
    let remoteSetupCalls = 0;
    const originalStudioMcpUrl = Deno.env.get("VERYFRONT_STUDIO_MCP_URL");
    Deno.env.set("VERYFRONT_STUDIO_MCP_URL", TEST_PUBLIC_STUDIO_MCP_URL);
    installMockFetch(async () => {
      remoteSetupCalls++;
      if (expireBeforeHandoff) await new Promise((resolve) => setTimeout(resolve, 2100));
      throw new Error("Synthetic Studio discovery unavailable");
    });
    let cancelledReservations = 0;
    let settledReservations = 0;
    class CleanupTrackingSessionManager extends AgentRunSessionManager {
      override cancelRun(...args: Parameters<AgentRunSessionManager["cancelRun"]>): boolean {
        cancelledReservations++;
        return super.cancelRun(...args);
      }
      override settleCancelledRun(
        ...args: Parameters<AgentRunSessionManager["settleCancelledRun"]>
      ): void {
        settledReservations++;
        return super.settleCancelledRun(...args);
      }
    }
    const recoveryDirectory = await makeTempDir();
    const handler = createTestAgentStreamHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls++;
        return createEmptyDiscoveryResult();
      },
      getAgent: () =>
        createAgentWithConfig("assistant-1", {
          tools: true,
          mcpServers: [{ kind: "veryfront-studio" }],
        }),
      getAllAgentIds: () => [],
      sessionManager: new CleanupTrackingSessionManager({
        recoveryOwnerFactory: async ({ claims, awaitRetiredPreviousOwner }) => {
          const admission = getVerifiedControlPlaneRecoveryAdmission(claims);
          if (!admission) throw new Error("Expected verified recovery admission");
          const owner = await RecoverySessionOwner.acquire({
            claims,
            directory: recoveryDirectory,
            awaitRetiredPreviousOwner,
            validateCurrentOwnership: async () => ({
              version: 1,
              identity: {
                projectId: admission.identity.projectId,
                canonicalRunId: admission.identity.canonicalRunId,
                publicRunId: admission.identity.publicRunId,
                agentId: admission.identity.agentId,
                threadId: admission.identity.threadId,
              },
              generation: admission.generation,
              acknowledgedEventId: 0,
              acknowledgedExternalSequence: 0,
              leaseRemainingMs: 10_000,
            }),
          });
          return { owner };
        },
      }),
    });
    const body = createAgentStreamRequestBody({
      project: { projectId, sourceTargetEnvironmentId: "33333333-3333-4333-8333-333333333333" },
      agentSource: { type: "release", releaseId: "44444444-4444-4444-8444-444444444444" },
      credentials: { authToken: "synthetic-invocation" },
      forwardedProps: {
        clientId: "veryfront-studio",
        veryfront: { client: { id: "veryfront-studio", type: "web", platform: "browser" } },
      },
      managedRecoveryAdmission: {
        version: 1,
        identity: {
          projectId,
          canonicalRunId: "22222222-2222-4222-8222-222222222222",
          publicRunId: "run_1",
          agentId: "assistant-1",
          threadId: "10000000-1000-4000-8000-100000000001",
          sourceHash: "a".repeat(64),
        },
        generation: {
          workerId: "worker-1",
          dispatchNonce: "66666666-6666-4666-8666-666666666666",
          transportRecoveryAttempt: 0,
        },
        acknowledgedExternalSequence: 0,
        leaseRemainingMs: 10_000,
        sourceBinding: {
          projectId,
          environmentId: "33333333-3333-4333-8333-333333333333",
          releaseId: "44444444-4444-4444-8444-444444444444",
        },
        eventPersistence: "runtime-owned-v1",
        expiresAt: Math.floor(Date.now() / 1000) + (expireBeforeHandoff ? 2 : 30),
      },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "run_1",
      projectId,
    });
    const request = sealIngressCredentials(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
          [INGRESS_RUN_TERMINAL_TOKEN_HEADER]: "synthetic-terminal",
        },
        body,
      }),
    );
    assertEquals(request.headers.get(INGRESS_RUN_TERMINAL_TOKEN_HEADER), null);
    const ctx = createCtx(publicKeyPem);
    ctx.projectId = projectId;
    ctx.proxyToken = "synthetic-proxy-token";
    const previousKey = Deno.env.get("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");
    Deno.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", publicKeyPem);
    try {
      const result = await handler.handle(request, ctx);
      assertExists(result.response);
      assertEquals(result.response.status, 500);
      await result.response.body?.cancel();
      assertEquals(cancelledReservations, expireBeforeHandoff ? 1 : 0);
      assertEquals(settledReservations, expireBeforeHandoff ? 1 : 0);
      assertEquals(remoteSetupCalls > 0, true);
      assertEquals(discoveryCalls, 1);
    } finally {
      restoreMockFetch();
      if (originalStudioMcpUrl === undefined) Deno.env.delete("VERYFRONT_STUDIO_MCP_URL");
      else Deno.env.set("VERYFRONT_STUDIO_MCP_URL", originalStudioMcpUrl);
      await Deno.remove(recoveryDirectory, { recursive: true });
      if (previousKey === undefined) Deno.env.delete("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");
      else Deno.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", previousKey);
    }
  });
}

for (const preparation of ["environment", "config"]) {
  it(`cancellation during source ${preparation} prevents discovery`, async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    let discoveryCalls = 0;
    let releasePreparation = () => {};
    let enteredPreparation = () => {};
    const entered = new Promise<void>((resolve) => {
      enteredPreparation = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    const pausePreparation = async () => {
      enteredPreparation();
      await released;
    };
    const recoveryDirectory = await makeTempDir();
    const sessionManager = new AgentRunSessionManager({
      recoveryOwnerFactory: async ({ claims, awaitRetiredPreviousOwner }) => {
        const admission = getVerifiedControlPlaneRecoveryAdmission(claims);
        if (!admission) throw new Error("Expected verified recovery admission");
        const owner = await RecoverySessionOwner.acquire({
          claims,
          directory: recoveryDirectory,
          awaitRetiredPreviousOwner,
          validateCurrentOwnership: async () => ({
            version: 1,
            identity: {
              projectId: admission.identity.projectId,
              canonicalRunId: admission.identity.canonicalRunId,
              publicRunId: admission.identity.publicRunId,
              agentId: admission.identity.agentId,
              threadId: admission.identity.threadId,
            },
            generation: admission.generation,
            acknowledgedEventId: 0,
            acknowledgedExternalSequence: 0,
            leaseRemainingMs: 10_000,
          }),
        });
        return { owner };
      },
    });
    const handler = createTestAgentStreamHandler({
      sessionManager,
      loadAgentSourceEnvironment: async () => {
        if (preparation === "environment") await pausePreparation();
        return {};
      },
      ensureProjectDiscovery: async () => {
        discoveryCalls++;
        return createEmptyDiscoveryResult();
      },
      getAgent: () => undefined,
      getAllAgentIds: () => [],
    });
    const body = createAgentStreamRequestBody({
      project: { projectId, sourceTargetEnvironmentId: "33333333-3333-4333-8333-333333333333" },
      agentSource: { type: "release", releaseId: "44444444-4444-4444-8444-444444444444" },
      credentials: { authToken: "synthetic-invocation" },
      managedRecoveryAdmission: {
        version: 1,
        identity: {
          projectId,
          canonicalRunId: "22222222-2222-4222-8222-222222222222",
          publicRunId: "run_1",
          agentId: "assistant-1",
          threadId: "10000000-1000-4000-8000-100000000001",
          sourceHash: "a".repeat(64),
        },
        generation: {
          workerId: "worker-1",
          dispatchNonce: "66666666-6666-4666-8666-666666666666",
          transportRecoveryAttempt: 0,
        },
        acknowledgedExternalSequence: 0,
        leaseRemainingMs: 10_000,
        sourceBinding: {
          projectId,
          environmentId: "33333333-3333-4333-8333-333333333333",
          releaseId: "44444444-4444-4444-8444-444444444444",
        },
        eventPersistence: "runtime-owned-v1",
        expiresAt: Math.floor(Date.now() / 1000) + 30,
      },
    });
    const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
      requestId: "run_1",
      projectId,
    });
    const request = sealIngressCredentials(
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veryfront-control-plane-jws": jws,
          [INGRESS_RUN_TERMINAL_TOKEN_HEADER]: "synthetic-terminal",
        },
        body,
      }),
    );
    assertEquals(request.headers.get(INGRESS_RUN_TERMINAL_TOKEN_HEADER), null);
    const ctx = createCtx(publicKeyPem);
    ctx.projectId = projectId;
    const originalFreshness = ctx.adapter.fs.ensureSourceSnapshotFresh;
    ctx.adapter.fs.ensureSourceSnapshotFresh = async (reason, options) => {
      if (preparation === "config" && reason === "agent-source-config") await pausePreparation();
      return await originalFreshness?.(reason, options);
    };
    const previousKey = Deno.env.get("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");
    Deno.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", publicKeyPem);
    try {
      const pending = handler.handle(request, ctx);
      await entered;
      const cancelBody = "";
      const cancelSignature = await createControlPlaneSignature(cancelBody, {
        requestMethod: "DELETE",
        requestPath: "/api/control-plane/runs/run_1",
        requestId: "run_1",
        projectId,
      });
      Deno.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", cancelSignature.publicKeyPem);
      const cancelCtx = createCtx(cancelSignature.publicKeyPem);
      cancelCtx.projectId = projectId;
      const cancelled = await new AgentRunCancelHandler(sessionManager).handle(
        new Request("https://example.com/api/control-plane/runs/run_1", {
          method: "DELETE",
          headers: { "x-veryfront-control-plane-jws": cancelSignature.jws },
          body: cancelBody,
        }),
        cancelCtx,
      );
      releasePreparation();
      const result = await pending;
      assertExists(cancelled.response);
      assertEquals(cancelled.response.status, 202);
      assertEquals(await cancelled.response.json(), { accepted: true });
      assertExists(result.response);
      await result.response.body?.cancel();
      assertEquals(result.response.status >= 400, true);
      assertEquals(discoveryCalls, 0);
      assertEquals(sessionManager.getRunStatus("run_1"), null);
      assertEquals(sessionManager.cancelRun("run_1"), false);
    } finally {
      releasePreparation();
      await Deno.remove(recoveryDirectory, { recursive: true });
      if (previousKey === undefined) Deno.env.delete("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");
      else Deno.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", previousKey);
    }
  });
}
