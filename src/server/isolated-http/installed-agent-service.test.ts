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
Deno.test("installed admission drain keeps transport readiness for existing controls", async () => {
  const f = fixture("unused");
  const service = createInstalledCanonicalAgentService(f.input);
  try {
    service.beginDrain();
    assertEquals(service.ready, true);
    assertEquals(await service.drain({ timeoutMs: 0 }), true);
    assertEquals(
      (await service.handle(new Request("https://broker.test/invalid", { method: "POST" }))).status,
      503,
    );
    assertEquals(f.counts(), { allocations: 0, requests: 0 });
  } finally {
    await service.close();
  }
  assertEquals(service.ready, false);
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
      capabilities: { account_agent_publications: { version: 2 } },
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

Deno.test("installed service validates fixed API, inference and MCP destinations before accepting runs", async () => {
  const signed = await signedRequest(invocation());
  for (
    const [field, value] of [
      ["apiUrl", "not-a-url"],
      ["apiUrl", "https://api.example.test/api?tenant=x"],
      ["apiUrl", "https://api.example.test/api#fragment"],
      ["apiUrl", "https://api.example.test/api?"],
      ["apiUrl", "https://api.example.test/api#"],
      ["apiUrl", "http://public.example.test/api"],
      ["apiUrl", "https://synthetic:credential@api.example.test/api"],
      ["inferenceApiBaseUrl", "not-a-url"],
      ["inferenceApiBaseUrl", "http://public.example.test/api"],
      ["apiMcpUrl", "not-a-url"],
      ["apiMcpUrl", "http://public.example.test/mcp"],
      ["apiMcpUrl", "file:///tmp/mcp"],
      ["studioMcpUrl", "not-a-url"],
      ["studioMcpUrl", "http://public.example.test/mcp"],
      ["studioMcpUrl", "https://synthetic:credential@studio.example.test/mcp"],
    ] as const
  ) {
    const f = fixture(signed.publicKeyPem);
    f.input[field] = value;
    assertThrows(() => createInstalledCanonicalAgentService(f.input));
    assertEquals(f.counts(), { allocations: 0, requests: 0 });
  }
});

Deno.test("installed service requires every explicit model budget before accepting runs", async () => {
  const signed = await signedRequest(invocation());
  for (const key of ["maxCalls", "maxConcurrentCalls", "maxOutputTokens", "maxSteps"] as const) {
    const f = fixture(signed.publicKeyPem);
    Reflect.deleteProperty(f.input.modelLimits, key);
    assertThrows(() => createInstalledCanonicalAgentService(f.input));
    assertEquals(f.counts(), { allocations: 0, requests: 0 });
  }
});

Deno.test("agent configuration capability acknowledges only exact composed installed data after signature validation", async () => {
  const reference = {
    version: 1 as const,
    projectId: "11111111-1111-4111-8111-111111111111",
    environmentId: "22222222-2222-4222-8222-222222222222",
    releaseId: "33333333-3333-4333-8333-333333333333",
    deploymentId: "44444444-4444-4444-8444-444444444444",
    configurationId:
      "configuration-afaf766b6499a05ac73008b9d49a41a9d8171c09ad9cd3a4c2cdaf14c4005954",
  };
  for (const scenario of ["exact", "discovery", "legacy", "unknown", "bad-signature"] as const) {
    const requested = scenario === "unknown"
      ? { ...reference, deploymentId: "55555555-5555-4555-8555-555555555555" }
      : reference;
    const body = JSON.stringify({
      requestId: "captured-capability",
      projectId: reference.projectId,
      surface: "studio",
      ...(scenario === "discovery" ? {} : { runtimeConfiguration: requested }),
    });
    const signed = await createControlPlaneSignature(body, {
      projectId: reference.projectId,
      audience: "example-project",
      requestId: "captured-capability",
      requestMethod: "POST",
      requestPath: CONTROL_PLANE_RUNTIME_CAPABILITIES_PATH,
    });
    const f = fixture(signed.publicKeyPem);
    f.input.ingress = {
      ...f.input.ingress,
      projectId: reference.projectId,
      audience: "example-project",
    };
    f.input.source.installations = [{
      image: "ghcr.io/veryfront/source@sha256:" + "a".repeat(64),
      configuration: {
        projectId: reference.projectId,
        environmentId: reference.environmentId,
        releaseId: reference.releaseId,
        configurationId: reference.configurationId,
        projectSlug: "example-project",
        environmentName: "production",
        variables: Object.fromEntries([["__proto__", "proto-value"], [
          "constructor",
          "constructor-value",
        ], ["toString", "method-value"]]),
      },
    }];
    if (scenario !== "legacy") {
      f.input.source.configurationReferences = { version: 1, references: [reference] };
      f.input.source.projectExecutionConfigurationVersion = 1;
    }
    const service = createInstalledCanonicalAgentService(f.input);
    try {
      const response = await service.capabilities.handle(
        new Request("https://broker.test" + CONTROL_PLANE_RUNTIME_CAPABILITIES_PATH, {
          method: "POST",
          body,
          headers: {
            "x-veryfront-control-plane-jws": scenario === "bad-signature" ? "invalid" : signed.jws,
          },
        }),
      );
      assertEquals(
        response.status,
        scenario === "exact" || scenario === "discovery"
          ? 200
          : scenario === "bad-signature"
          ? 401
          : 503,
      );
      if (scenario === "exact" || scenario === "discovery") {
        assertEquals(await response.json(), {
          project_id: reference.projectId,
          capabilities: {
            account_agent_publications: { version: 2 },
            agent_execution_configuration: {
              version: 1,
              ...(scenario === "discovery" ? {} : { reference }),
            },
          },
        });
      }
      assertEquals(f.counts(), { allocations: 0, requests: 0 });
    } finally {
      await service.close();
      await service.settled;
    }
  }
});
