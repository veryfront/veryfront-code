import type { AgUiResumeValue } from "#veryfront/agent/ag-ui/tool-shared.ts";
import type { HostedServiceAuthenticatedRequest } from "#veryfront/agent/service/auth.ts";
import { createDetachedRunTracker } from "#veryfront/agent/service/detached-run-tracker.ts";
import { createHostedAgentServiceRouteSet } from "#veryfront/agent/service/routes.ts";
import { isNode } from "#veryfront/platform/compat/runtime.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";

const runtimeSource = { type: "release", releaseId: "release-42" } as const;

function createRuntimeInvocationRequest(canary: string): Request {
  return new Request("https://agent.example.test/api/control-plane/runs/run-1/stream", {
    method: "POST",
    headers: {
      authorization: "Bearer authenticated-user-token",
      "content-type": "application/json",
      "X-Veryfront-Inference-Token": canary,
      "X-Veryfront-Run-Event-Token": "verified-event-token",
    },
    body: JSON.stringify({
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
        },
      },
      messages: [],
      tools: [],
      context: [],
      agentSource: runtimeSource,
      credentials: {
        authToken: "control-plane-auth-token",
        inferenceAuthToken: canary,
      },
    }),
  });
}

for (const mutation of ["iterator", "dispatcher", "serialization"] as const) {
  it(`rejects changed native ${mutation} before copying runtime invocation credentials`, async () => {
    if (!isNode) return;

    const canary = "synthetic-runtime-invocation-canary";
    const iteratorDescriptor = Object.getOwnPropertyDescriptor(
      Headers.prototype,
      Symbol.iterator,
    )!;
    const nativeIterator = iteratorDescriptor.value as (this: Headers) => Iterator<
      [string, string]
    >;
    const apply = Reflect.apply;
    const getHeader = Headers.prototype.get;
    const dispatcherDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "dispatcher");
    const toJSONDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
    let serializationCalls = 0;
    let observations = 0;
    const replaceDispatcher = () => {
      Object.defineProperty(Object.prototype, "dispatcher", {
        configurable: true,
        get(this: RequestInit) {
          if (
            this.headers instanceof Headers &&
            apply(getHeader, this.headers, ["X-Veryfront-Inference-Token"]) === canary
          ) observations++;
          return undefined;
        },
      });
    };
    let verificationCompleted = false;
    let detachedDispatches = 0;
    let response: Response | undefined;
    let failure: unknown;
    const routeSet = createHostedAgentServiceRouteSet({
      runtimeSource,
      tracker: createDetachedRunTracker<AgUiResumeValue>(),
      authenticateRequest: async (): Promise<HostedServiceAuthenticatedRequest> => ({
        authToken: "authenticated-user-token",
        userId: "user-1",
      }),
      verifyProjectAccess: async () => ({ success: true }),
      verifyRunEventAppendToken: async () => {
        verificationCompleted = true;
        if (mutation === "dispatcher") {
          replaceDispatcher();
        } else if (mutation === "serialization") {
          Object.defineProperty(Object.prototype, "toJSON", {
            configurable: true,
            value: function (this: unknown) {
              serializationCalls++;
              replaceDispatcher();
              return this;
            },
          });
        } else {
          Object.defineProperty(Headers.prototype, Symbol.iterator, {
            ...iteratorDescriptor,
            value: function (this: Headers) {
              const iterator = apply(nativeIterator, this, []) as Iterator<[string, string]>;
              return {
                next() {
                  const result = iterator.next();
                  if (result.value?.[1] === canary) observations++;
                  return result;
                },
                [Symbol.iterator]() {
                  return this;
                },
              };
            },
          });
        }
        return true;
      },
      prepareExecution: async () => ({ executionId: "exec-1" }),
      streamExecutionToAgUiResponse: () => new Response("streamed"),
      startDetachedExecution: async () => {
        detachedDispatches++;
      },
    });

    try {
      response = await routeSet.handleRuntimeAgentRunInvocationExecuteRequest({
        request: createRuntimeInvocationRequest(canary),
        runId: "run-1",
      });
    } catch (error) {
      failure = error;
    } finally {
      Object.defineProperty(Headers.prototype, Symbol.iterator, iteratorDescriptor);
      if (toJSONDescriptor) Object.defineProperty(Object.prototype, "toJSON", toJSONDescriptor);
      else Reflect.deleteProperty(Object.prototype, "toJSON");
      if (dispatcherDescriptor) {
        Object.defineProperty(Object.prototype, "dispatcher", dispatcherDescriptor);
      } else Reflect.deleteProperty(Object.prototype, "dispatcher");
    }

    assertEquals(verificationCompleted, true, "the mutation occurs after verification");
    if (mutation === "serialization") assertEquals(serializationCalls > 0, true);
    assertEquals(observations, 0, "the modified native operation never observes the credential");
    assertEquals(failure instanceof TypeError, true, "the compromised operation fails explicitly");
    assertEquals(response, undefined, "the route never substitutes a success response");
    assertEquals(detachedDispatches, 0, "the route never starts detached execution");
  });
}
