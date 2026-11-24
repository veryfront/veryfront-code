import { createControlPlaneSignature } from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";
import { CONTROL_PLANE_RUNTIME_CAPABILITIES_PATH } from "#veryfront/channels/control-plane.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { createInstalledCanonicalAgentService } from "./installed-agent-service.ts";
import {
  getHostedServiceTokenFromRequest,
  type HostedServiceAuth,
} from "#veryfront/agent/service/auth.ts";
import {
  invocation,
  projectId,
  signedRequest,
  userId,
} from "#veryfront/agent/service/broker-ingress.test-helpers.ts";

function fixture(publicKeyPem: string) {
  let allocations = 0, requests = 0, writers = 0;
  const unavailable = () => {
    throw new Error("Unexpected allocator request");
  };
  const auth: HostedServiceAuth = {
    verifyJwt: async () => ({
      success: true,
      userId,
      email: "synthetic@example.test",
      token: "broker-token",
    }),
    verifyRunEventAppendToken: async () => {
      writers++;
      return { verified: false };
    },
    verifyRunTerminalToken: async () => false,
    verifyRunCancellationToken: async () => false,
    verifyRunResumeToken: async () => false,
    authenticateRequest: async () => new Response(null, { status: 401 }),
    getTokenFromRequest: getHostedServiceTokenFromRequest,
    verifyProjectAccess: async () => unavailable(),
  };
  const input: Parameters<typeof createInstalledCanonicalAgentService>[0] = {
    source: {
      installations: [{
        image: "ghcr.io/veryfront/source@sha256:" + "a".repeat(64),
        configuration: {
          projectId,
          projectSlug: "demo-project",
          environmentId: "00000000-0000-4000-8000-000000000098",
          environmentName: "production",
          releaseId: "release-1",
          configurationId: "config-1",
          variables: { PRIVATE: "never-forward" },
        },
      }],
      expectedBrokerInstanceId: "broker-test",
      allocator: {
        allocate: () => {
          allocations++;
          return unavailable();
        },
        observe: unavailable,
        renew: unavailable,
        release: unavailable,
      },
      connectTransport: unavailable,
    },
    ingress: { publicKeyPem, audience: "demo-project", projectId, expectedSurface: "studio" },
    auth,
    apiUrl: "https://api.example.test",
    inferenceApiBaseUrl: "https://api.example.test",
    apiMcpUrl: "https://api.example.test/mcp",
    modelLimits: { maxCalls: 10, maxConcurrentCalls: 2, maxOutputTokens: 4096, maxSteps: 20 },
    toolLimits: { maxCalls: 20, maxConcurrent: 2 },
    maxActive: 1,
    fetch: () => {
      requests++;
      throw new Error("Unauthenticated execution must not reach the API");
    },
    resolveProvider: () => "anthropic",
  };
  return { input, counts: () => ({ allocations, requests }), writerCalls: () => writers };
}
Deno.test("installed canonical service rejects writer authority before API admission or allocation", async () => {
  const base = invocation();
  const signed = await signedRequest(
    invocation({
      run: {
        ...base.run,
        project: {
          ...base.run.project,
          runtimeTargetKind: "environment",
          runtimeTargetEnvironmentId: "00000000-0000-4000-8000-000000000098",
          runtimeTargetEnvironmentName: "production",
        },
      },
    }),
  );
  signed.request.headers.set("x-veryfront-run-terminal-token", "synthetic-terminal");
  const f = fixture(signed.publicKeyPem);
  const service = createInstalledCanonicalAgentService(f.input);
  try {
    const response = await service.handle(signed.request);
    assertEquals(response.status, 403);
    assertEquals(f.writerCalls(), 1);
    assertEquals(f.counts(), { allocations: 0, requests: 0 });
    assertEquals(service.active, 0);
  } finally {
    await service.close();
    await service.close();
    await service.settled;
  }
});
Deno.test("installed canonical service validates terminal verification and execution ceilings at startup", () => {
  const f = fixture("unused");
  assertThrows(
    () =>
      createInstalledCanonicalAgentService({
        ...f.input,
        auth: { ...f.input.auth, verifyRunTerminalToken: undefined },
      }),
    TypeError,
  );
  assertThrows(
    () =>
      createInstalledCanonicalAgentService({
        ...f.input,
        toolLimits: { maxCalls: 1, maxConcurrent: 2 },
      }),
    TypeError,
  );
  assertThrows(
    () =>
      createInstalledCanonicalAgentService({
        ...f.input,
        modelLimits: { ...f.input.modelLimits, maxCalls: 0 },
      }),
    TypeError,
  );
  assertEquals(f.counts(), { allocations: 0, requests: 0 });
});

Deno.test("composed capabilities authenticate exact source namespace and do no API or allocator work", async () => {
  const path = CONTROL_PLANE_RUNTIME_CAPABILITIES_PATH;
  const body = JSON.stringify({ requestId: "capabilities-test", projectId, surface: "studio" });
  const signed = await createControlPlaneSignature(body, {
    projectId,
    audience: "demo-project",
    requestId: "capabilities-test",
    requestMethod: "POST",
    requestPath: path,
  });
  const f = fixture(signed.publicKeyPem);
  const service = createInstalledCanonicalAgentService(f.input);
  const request = (value = body, signature = signed.jws) =>
    new Request("https://broker.test" + path, {
      method: "POST",
      body: value,
      headers: { "x-veryfront-control-plane-jws": signature },
    });
  try {
    assertEquals(service.ready, true);
    const response = await service.capabilities.handle(request());
    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      project_id: projectId,
      capabilities: { account_agent_publications: { version: 1 } },
    });
    assertEquals((await service.capabilities.handle(request(body, "invalid"))).status, 401);
    assertEquals(
      (await service.capabilities.handle(
        request(body.replace("capabilities-test", "changed-subject")),
      )).status,
      401,
    );
    assertEquals(
      (await service.capabilities.handle(request(body.replace(projectId, "foreign")))).status,
      401,
    );
    assertEquals((await service.capabilities.handle(request("x".repeat(4097)))).status, 413);
    assertEquals(f.counts(), { allocations: 0, requests: 0 });
    await service.close();
    assertEquals(service.ready, false);
    assertEquals((await service.capabilities.handle(request())).status, 503);
  } finally {
    await service.close();
    await service.settled;
  }
});
