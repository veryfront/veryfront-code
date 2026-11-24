import "#veryfront/schemas/_test-setup.ts";
import type { AgUiResumeValue } from "#veryfront/agent/ag-ui/tool-shared.ts";
import {
  parseRuntimeAgentRunInvocationValue,
  RuntimeAgentIngressCredentialConflictError,
  safeParseRuntimeAgentRunInvocationValue,
} from "#veryfront/agent/runtime/agent-invocation-contract.ts";
import { createHostedInferenceModelResolver } from "#veryfront/agent/hosted/inference-credential.ts";
import type { HostedServiceAuthenticatedRequest } from "#veryfront/agent/service/auth.ts";
import { createDetachedRunTracker } from "#veryfront/agent/service/detached-run-tracker.ts";
import { createHostedAgentServiceRouteSet } from "#veryfront/agent/service/routes.ts";
import { seedServedCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.test-helpers.ts";
import { __resetVeryfrontCloudCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import {
  INGRESS_INFERENCE_TOKEN_HEADER,
  INGRESS_SOURCE_TOKEN_HEADER,
  readIngressCredential,
  readInvocationIngressCredentials,
  sealIngressCredentials,
} from "#veryfront/security/http/ingress-credentials.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";

const runtimeSource = { type: "release", releaseId: "release-42" } as const;
const RUN_URL = "https://agent.example.test/api/control-plane/runs/run-1/stream";
const sourceProject = {
  projectId: "00000000-0000-4000-8000-000000000099",
  projectSlug: "shared-source",
  runtimeTargetKind: "environment",
  runtimeTargetEnvironmentId: "00000000-0000-4000-8000-000000000098",
  runtimeTargetEnvironmentName: "Production",
} as const;

type BodyCredentials = {
  inferenceAuthToken?: string;
  sourceAuthToken?: string;
};

function invocation(
  credentials: BodyCredentials | null = {},
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    run: {
      agentServiceId: "test-agent-service",
      agentId: "builder",
      conversationId: "00000000-0000-4000-8000-000000000001",
      runId: "run-1",
      messageId: "00000000-0000-4000-8000-000000000002",
      inputAnchorMessageId: "00000000-0000-4000-8000-000000000003",
      requestedByUserId: "00000000-0000-4000-8000-000000000004",
      project: {
        projectId: "00000000-0000-4000-8000-000000000005",
        projectSlug: "demo",
        runtimeTargetBranchName: "main",
      },
    },
    messages: [],
    tools: [],
    context: [],
    agentSource: runtimeSource,
    ...(credentials === null ? {} : {
      credentials: { authToken: "control-plane-auth-token", ...credentials },
    }),
    ...extra,
  };
}

function ingress(
  inferenceAuthToken: string | null,
  sourceAuthToken: string | null = null,
) {
  return { inferenceAuthToken, sourceAuthToken };
}

describe("invocation credentials from ingress headers", () => {
  describe("invocation parsing", () => {
    for (const field of ["inferenceAuthToken", "sourceAuthToken"] as const) {
      const header = (value: string | null) =>
        field === "inferenceAuthToken" ? ingress(value) : ingress(null, value);

      it(`keeps the body ${field} when no header is sent`, () => {
        const parsed = parseRuntimeAgentRunInvocationValue(
          invocation({ [field]: "body-token" }),
          header(null),
        );
        assertEquals(parsed.credentials?.[field], "body-token");
      });

      it(`takes ${field} from its header when the body leaves it out`, () => {
        const parsed = parseRuntimeAgentRunInvocationValue(
          invocation(),
          header("header-token"),
        );
        assertEquals(parsed.credentials?.[field], "header-token");
      });

      it(`accepts a body ${field} equal to its header`, () => {
        const parsed = parseRuntimeAgentRunInvocationValue(
          invocation({ [field]: "same-token" }),
          header("same-token"),
        );
        assertEquals(parsed.credentials?.[field], "same-token");
      });

      it(`rejects a body ${field} that differs from its header`, () => {
        const error = assertThrows(
          () =>
            parseRuntimeAgentRunInvocationValue(
              invocation({ [field]: "body-secret-value" }),
              header("header-secret-value"),
            ),
          RuntimeAgentIngressCredentialConflictError,
        );
        assertEquals(
          (error as Error).message,
          `credentials.${field} does not match its ingress header`,
        );
        const result = safeParseRuntimeAgentRunInvocationValue(
          invocation({ [field]: "body-secret-value" }),
          header("header-secret-value"),
        );
        assertEquals(result.success, false);
        const message = String((result as { error: Error }).error.message);
        assertEquals(message.includes("secret-value"), false);
      });

      for (
        const malformed of [
          "",
          "contains space",
          "non-ascii-é",
          "x".repeat(16_385),
        ]
      ) {
        it(`rejects a malformed ${field} header (${malformed.length} chars)`, () => {
          const result = safeParseRuntimeAgentRunInvocationValue(
            invocation(),
            header(malformed),
          );
          assertEquals(result.success, false);
          if (malformed.length > 0) {
            const message = String((result as { error: Error }).error.message);
            assertEquals(message.includes(malformed), false);
          }
        });
      }
    }

    it("leaves an invocation without credentials as it is", () => {
      const parsed = parseRuntimeAgentRunInvocationValue(
        invocation(null),
        ingress("header-token", "header-source-token"),
      );
      assertEquals(parsed.credentials, undefined);
    });

    it("lets the source header satisfy a shared source", () => {
      const shared = invocation({}, {
        sourceProject,
        agentSource: runtimeSource,
      });
      assertEquals(
        safeParseRuntimeAgentRunInvocationValue(shared, ingress(null)).success,
        false,
      );
      const parsed = parseRuntimeAgentRunInvocationValue(
        shared,
        ingress(null, "source-token"),
      );
      assertEquals(parsed.credentials?.sourceAuthToken, "source-token");
    });

    it("does not change the value it was given", () => {
      const value = invocation();
      parseRuntimeAgentRunInvocationValue(
        value,
        ingress("header-token", "source-token"),
      );
      assertEquals(value.credentials, {
        authToken: "control-plane-auth-token",
      });
    });
  });

  describe("ingress sealing", () => {
    it("takes the source header off the request with the other credentials", () => {
      const sealed = sealIngressCredentials(
        new Request(RUN_URL, {
          method: "POST",
          headers: {
            [INGRESS_INFERENCE_TOKEN_HEADER]: "inference-token",
            [INGRESS_SOURCE_TOKEN_HEADER]: "source-token",
            "x-other": "kept",
          },
          body: "{}",
        }),
      );
      assertEquals(sealed.headers.get(INGRESS_SOURCE_TOKEN_HEADER), null);
      assertEquals(sealed.headers.get(INGRESS_INFERENCE_TOKEN_HEADER), null);
      assertEquals(sealed.headers.get("x-other"), "kept");
      assertEquals(
        readIngressCredential(sealed, INGRESS_SOURCE_TOKEN_HEADER),
        "source-token",
      );
      assertEquals({ ...readInvocationIngressCredentials(sealed) }, {
        inferenceAuthToken: "inference-token",
        sourceAuthToken: "source-token",
      });
    });
  });

  describe("runtime invocation route", () => {
    beforeEach(seedServedCatalogForTests);
    afterEach(__resetVeryfrontCloudCatalogForTests);
    afterEach(restoreMockFetch);

    async function invoke(input: { header?: string; body?: string }) {
      const authorizations: Array<string | null> = [];
      const encoder = new TextEncoder();
      installMockFetch(
        (async (target: URL | Request | string, init?: RequestInit) => {
          authorizations.push(
            new Request(target, init).headers.get("Authorization"),
          );
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  encoder.encode(
                    'data: {"choices":[{"finish_reason":"stop"}]}\n\n',
                  ),
                );
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                controller.close();
              },
            }),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          );
        }) as typeof fetch,
      );
      let prepared = 0;
      let detachedBody = "";
      const routeSet = createHostedAgentServiceRouteSet({
        runtimeSource,
        tracker: createDetachedRunTracker<AgUiResumeValue>(),
        authenticateRequest: async (): Promise<
          HostedServiceAuthenticatedRequest
        > => ({
          authToken: "authenticated-user-token",
          userId: "user-1",
        }),
        verifyProjectAccess: async () => ({ success: true }),
        verifyRunEventAppendToken: async () => true,
        prepareExecution: async (request) => {
          prepared++;
          const model = createHostedInferenceModelResolver(request, {
            apiBaseUrl: "https://public-api.example.test/",
          })?.("veryfront-cloud/openai/gpt-test");
          if (model) {
            const result = await model.doStream({ prompt: [] });
            const reader = result.stream.getReader();
            while (!(await reader.read()).done) {
              // drained: only the outgoing Authorization is asserted
            }
          }
          return { executionId: "exec-1" };
        },
        streamExecutionToAgUiResponse: () => new Response("streamed"),
        startDetachedExecution: async ({ rawRequest }) => {
          detachedBody = await rawRequest.text();
        },
      });
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "X-Veryfront-Run-Event-Token": "verified-event-token",
      };
      if (input.header !== undefined) {
        headers[INGRESS_INFERENCE_TOKEN_HEADER] = input.header;
      }
      const response = await routeSet
        .handleRuntimeAgentRunInvocationExecuteRequest({
          request: sealIngressCredentials(
            new Request(RUN_URL, {
              method: "POST",
              headers,
              body: JSON.stringify(
                invocation(
                  input.body === undefined ? {} : { inferenceAuthToken: input.body },
                ),
              ),
            }),
          ),
          runId: "run-1",
        });
      return { response, authorizations, prepared, detachedBody };
    }

    it("binds the body credential when no header is sent", async () => {
      const result = await invoke({ body: "body-inference-token" });
      assertEquals(result.response.status, 202);
      assertEquals(result.authorizations, ["Bearer body-inference-token"]);
      assertEquals(result.detachedBody.includes("body-inference-token"), false);
    });

    it("binds the header credential when the body leaves it out", async () => {
      const result = await invoke({ header: "header-inference-token" });
      assertEquals(result.response.status, 202);
      assertEquals(result.authorizations, ["Bearer header-inference-token"]);
      assertEquals(
        result.detachedBody.includes("header-inference-token"),
        false,
      );
    });

    it("binds the credential when header and body agree", async () => {
      const result = await invoke({
        header: "same-inference-token",
        body: "same-inference-token",
      });
      assertEquals(result.response.status, 202);
      assertEquals(result.authorizations, ["Bearer same-inference-token"]);
    });

    it("rejects a header and body that differ before execution", async () => {
      const result = await invoke({
        header: "header-inference-token",
        body: "body-token",
      });
      assertEquals(result.response.status, 400);
      const text = await result.response.text();
      assertEquals(text.includes("header-inference-token"), false);
      assertEquals(text.includes("body-token"), false);
      assertEquals(result.prepared, 0);
      assertEquals(result.authorizations, []);
    });

    it("rejects a malformed header before execution", async () => {
      const result = await invoke({ header: "contains space" });
      assertEquals(result.response.status, 400);
      assertEquals(result.prepared, 0);
    });
  });
});
