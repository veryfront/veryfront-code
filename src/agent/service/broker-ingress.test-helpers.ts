import { assertEquals } from "#veryfront/testing/assert.ts";
import { createControlPlaneSignature } from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";

export const projectId = "00000000-0000-4000-8000-000000000005";
export const userId = "00000000-0000-4000-8000-000000000006";
const conversationId = "00000000-0000-4000-8000-000000000001";
const messageId = "00000000-0000-4000-8000-000000000002";
const inputAnchorMessageId = "00000000-0000-4000-8000-000000000003";
export const path = "/api/control-plane/runs/run-1/stream";

export function invocation(overrides: Record<string, unknown> = {}) {
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

export async function signedRequest(
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

export function options(publicKeyPem: string) {
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
