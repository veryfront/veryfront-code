import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createControlPlaneSignature } from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";
import { BrokerIngressError, parseBrokerRuntimeAgentIngress } from "./broker-ingress.ts";

const projectId = "00000000-0000-4000-8000-000000000005";
const userId = "00000000-0000-4000-8000-000000000006";
const conversationId = "00000000-0000-4000-8000-000000000001";
const messageId = "00000000-0000-4000-8000-000000000002";
const inputAnchorMessageId = "00000000-0000-4000-8000-000000000003";
const path = "/api/control-plane/runs/run-1/stream";

function invocation(overrides: Record<string, unknown> = {}) {
  return {
    run: {
      agentServiceId: "service-1",
      agentId: "builder",
      conversationId,
      runId: "run-1",
      messageId,
      inputAnchorMessageId,
      requestedByUserId: userId,
      project: { projectId, projectSlug: "demo-project", runtimeTargetKind: "main_branch" },
    },
    messages: [],
    tools: [],
    context: [],
    agentSource: { type: "release", releaseId: "release-1" },
    credentials: { authToken: "api-auth-token", inferenceAuthToken: "inference-token" },
    ...overrides,
  };
}

async function signedRequest(
  bodyValue = invocation(),
  overrides: Parameters<typeof createControlPlaneSignature>[1] = {},
) {
  const rawBody = JSON.stringify(bodyValue);
  const signature = await createControlPlaneSignature(rawBody, {
    audience: "demo-project",
    projectId,
    requestId: "run-1",
    requestPath: path,
    ...overrides,
  });
  return {
    publicKeyPem: signature.publicKeyPem,
    request: new Request(`https://broker.test${path}`, {
      method: "POST",
      headers: {
        authorization: "Bearer broker-token",
        "content-type": "application/json",
        "x-veryfront-control-plane-jws": signature.jws,
        "x-veryfront-run-event-token": "run-event-token",
      },
      body: rawBody,
    }),
  };
}

function options(publicKeyPem: string) {
  return {
    publicKeyPem,
    audience: "demo-project",
    projectId,
    expectedRunId: "run-1",
    expectedSurface: "studio" as const,
    boundSource: { type: "release" as const, releaseId: "release-1" },
    expectedOwner: { scopeKind: "project" as const, projectId },
    authorizeScope: (input: {
      authorization: string;
      apiAuthToken: string;
      runEventToken: string;
    }) => {
      assertEquals(input.authorization, "Bearer broker-token");
      assertEquals(input.apiAuthToken, "api-auth-token");
      assertEquals(input.runEventToken, "run-event-token");
      return Promise.resolve({ principal: { userId }, runEventWriter: { id: "writer-1" } });
    },
  };
}

describe("managed broker ingress", () => {
  it("verifies the exact body and produces disjoint private authority and executor data", async () => {
    const signed = await signedRequest();
    const result = await parseBrokerRuntimeAgentIngress(
      signed.request,
      options(signed.publicKeyPem),
    );
    assertEquals(result.privateAuthority.inferenceAuthToken, "inference-token");
    assertEquals(result.privateAuthority.apiAuthToken, "api-auth-token");
    assertEquals(result.privateAuthority.runEventToken, "run-event-token");
    assertEquals(result.privateAuthority.inboundAuthorization, "Bearer broker-token");
    assertEquals(result.executor.run.runId, "run-1");
    assertEquals(result.executor.input.runId, "run-1");
    const visible = JSON.stringify(result.executor);
    for (
      const secret of ["broker-token", "api-auth-token", "run-event-token", "inference-token"]
    ) {
      assertEquals(visible.includes(secret), false);
    }
    assertEquals(signed.request.bodyUsed, true);
  });

  it("rejects invalid signatures and signed method, path, or run mismatches", async () => {
    const signed = await signedRequest();
    const invalid = new Request(signed.request.url, {
      method: "POST",
      headers: signed.request.headers,
      body: `${JSON.stringify(invocation())} `,
    });
    await assertIngressError(
      () => parseBrokerRuntimeAgentIngress(invalid, options(signed.publicKeyPem)),
      401,
      "BROKER_INGRESS_AUTH_INVALID",
    );

    const wrongRun = await signedRequest(
      invocation({ run: { ...invocation().run, runId: "run-2" } }),
    );
    await assertIngressError(
      () => parseBrokerRuntimeAgentIngress(wrongRun.request, options(wrongRun.publicKeyPem)),
      400,
      "CONTROL_PLANE_RUN_ID_MISMATCH",
    );
  });

  it("rejects invalid, oversized, and aborted bodies before authorization", async () => {
    let authorizations = 0;
    const signed = await signedRequest();
    const invalidBody = "{";
    const invalidSignature = await createControlPlaneSignature(invalidBody, {
      audience: "demo-project",
      projectId,
      requestId: "run-1",
      requestPath: path,
    });
    const invalid = new Request(`https://broker.test${path}`, {
      method: "POST",
      headers: {
        authorization: "Bearer broker-token",
        "x-veryfront-control-plane-jws": invalidSignature.jws,
        "x-veryfront-run-event-token": "run-event-token",
      },
      body: invalidBody,
    });
    await assertIngressError(
      () =>
        parseBrokerRuntimeAgentIngress(invalid, {
          ...options(invalidSignature.publicKeyPem),
          authorizeScope: () => {
            authorizations++;
            return Promise.resolve({});
          },
        }),
      400,
      "BROKER_INGRESS_INVALID_BODY",
    );

    const oversized = new Request(`https://broker.test${path}`, {
      method: "POST",
      headers: signed.request.headers,
      body: "x".repeat(1024 * 1024 + 1),
    });
    await assertIngressError(
      () =>
        parseBrokerRuntimeAgentIngress(oversized, {
          ...options(signed.publicKeyPem),
          authorizeScope: () => {
            authorizations++;
            return Promise.resolve({});
          },
        }),
      413,
      "BROKER_INGRESS_BODY_TOO_LARGE",
    );

    const controller = new AbortController();
    const aborted = new Request(
      `https://broker.test${path}`,
      {
        method: "POST",
        headers: signed.request.headers,
        body: new ReadableStream<Uint8Array>(),
        signal: controller.signal,
        duplex: "half",
      } as RequestInit,
    );
    const pending = parseBrokerRuntimeAgentIngress(aborted, {
      ...options(signed.publicKeyPem),
      authorizeScope: () => {
        authorizations++;
        return Promise.resolve({});
      },
      readTimeoutMs: 1_000,
    });
    controller.abort();
    await assertIngressError(() => pending, 499, "BROKER_INGRESS_ABORTED");

    const timedOut = new Request(
      `https://broker.test${path}`,
      {
        method: "POST",
        headers: signed.request.headers,
        body: new ReadableStream<Uint8Array>(),
        duplex: "half",
      } as RequestInit,
    );
    await assertIngressError(
      () =>
        parseBrokerRuntimeAgentIngress(timedOut, {
          ...options(signed.publicKeyPem),
          authorizeScope: () => {
            authorizations++;
            return Promise.resolve({});
          },
          readTimeoutMs: 1,
        }),
      408,
      "BROKER_INGRESS_TIMEOUT",
    );
    assertEquals(authorizations, 0);
  });

  it("fails closed on source, project, owner, and required credential scope", async () => {
    const signed = await signedRequest();
    await assertIngressError(
      () =>
        parseBrokerRuntimeAgentIngress(signed.request.clone(), {
          ...options(signed.publicKeyPem),
          boundSource: { type: "release", releaseId: "release-2" },
        }),
      409,
      "CONTROL_PLANE_AGENT_SOURCE_MISMATCH",
    );

    const wrongProject = await signedRequest(
      invocation({
        run: {
          ...invocation().run,
          project: {
            projectId: "00000000-0000-4000-8000-000000000099",
            projectSlug: "demo-project",
            runtimeTargetKind: "main_branch",
          },
        },
      }),
    );
    await assertIngressError(
      () =>
        parseBrokerRuntimeAgentIngress(wrongProject.request, options(wrongProject.publicKeyPem)),
      403,
      "BROKER_INGRESS_SCOPE_DENIED",
    );

    const noEventToken = await signedRequest();
    noEventToken.request.headers.delete("x-veryfront-run-event-token");
    await assertIngressError(
      () =>
        parseBrokerRuntimeAgentIngress(noEventToken.request, options(noEventToken.publicKeyPem)),
      401,
      "BROKER_INGRESS_AUTH_REQUIRED",
    );

    const noApiToken = await signedRequest(invocation({ credentials: undefined }));
    await assertIngressError(
      () => parseBrokerRuntimeAgentIngress(noApiToken.request, options(noApiToken.publicKeyPem)),
      403,
      "BROKER_INGRESS_SCOPE_DENIED",
    );

    const denied = await signedRequest();
    await assertIngressError(
      () =>
        parseBrokerRuntimeAgentIngress(denied.request, {
          ...options(denied.publicKeyPem),
          authorizeScope: () => Promise.resolve(undefined),
        }),
      403,
      "BROKER_INGRESS_SCOPE_DENIED",
    );
  });
});

async function assertIngressError(
  operation: () => Promise<unknown>,
  status: number,
  errorCode: string,
) {
  const error = await assertRejects(operation, BrokerIngressError) as BrokerIngressError;
  assertEquals({ status: error.status, errorCode: error.errorCode }, { status, errorCode });
}
