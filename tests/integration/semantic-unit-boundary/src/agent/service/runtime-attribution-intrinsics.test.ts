/** Process-global response and header mutations belong outside the hermetic unit suite. */
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { createDetachedRunTracker } from "#veryfront/agent/service/detached-run-tracker.ts";
import {
  createHostedAgentServiceRouteSet,
  type HostedAgentServiceRouteSetOptions,
} from "#veryfront/agent/service/routes.ts";
import {
  deleteEnv,
  getHostEnvExcludingEnvFile,
  setEnv,
} from "#veryfront/platform/compat/process.ts";
import {
  getServiceRuntimeIdentity,
  resolveServiceRuntimeName,
  type ServiceRuntimeIdentity,
} from "#veryfront/agent/service/runtime-identity.ts";

const runtimeSource = { type: "release", releaseId: "release-42" } as const;

type Execution = { executionId: string };

function createRouteSet(
  input: Partial<
    Pick<
      HostedAgentServiceRouteSetOptions<Execution>,
      | "verifyRunEventAppendToken"
      | "prepareExecution"
      | "startDetachedExecution"
      | "resolveRuntimeOwnerInvokeUrl"
    >
  >,
) {
  const routeSet = createHostedAgentServiceRouteSet<Execution>({
    tracker: createDetachedRunTracker(),
    runtimeSource,
    authenticateRequest: async () => ({ authToken: "service-test-token", userId: "user-1" }),
    verifyProjectAccess: async () => ({ success: true }),
    verifyRunCancellationToken: () => Promise.resolve(true),
    verifyRunEventAppendToken: input.verifyRunEventAppendToken ?? (() => Promise.resolve(true)),
    prepareExecution: input.prepareExecution ?? (async () => ({ executionId: "exec-1" })),
    streamExecutionToAgUiResponse: () => new Response("streamed"),
    startDetachedExecution: input.startDetachedExecution ?? (async () => {}),
    resolveRuntimeOwnerInvokeUrl: input.resolveRuntimeOwnerInvokeUrl ??
      (() => Promise.resolve(null)),
  });
  return { routeSet };
}

function createDevToken(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.unsigned`;
}

function createAuthenticatedRequest(
  path: string,
  body: unknown,
  method = "POST",
  headers: HeadersInit = {},
): Request {
  return new Request(`https://agent.example.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${createDevToken({ userId: "user-1" })}`,
      ...Object.fromEntries(new Headers(headers)),
    },
    body: method === "DELETE" ? undefined : JSON.stringify(body),
  });
}

function createRuntimeAgentInvocationBody(): Record<string, unknown> {
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
      },
    },
    messages: [],
    tools: [],
    context: [],
    agentSource: runtimeSource,
  };
}

function createDefaultChatStartRequest(): Request {
  return createAuthenticatedRequest(
    "/api/runs",
    {
      messages: [],
      context: {
        conversationId: "00000000-0000-4000-8000-000000000001",
        projectId: "00000000-0000-4000-8000-000000000005",
        branchId: null,
      },
      durableRootRun: {
        runId: "run-1",
        messageId: "00000000-0000-4000-8000-000000000002",
      },
    },
    "POST",
    { "X-Veryfront-Run-Event-Token": "run-event-service-token" },
  );
}

// This must precede route creation: no singleton prewarming may hide first-call poisoning.
it("first service identity resolution survives prior project intrinsic replacement", () => {
  const previousName = getHostEnvExcludingEnvFile("VERYFRONT_RUNTIME_NAME");
  setEnv("VERYFRONT_RUNTIME_NAME", "  Trusted service 🚀  ");
  const trim = String.prototype.trim;
  const slice = String.prototype.slice;
  const test = RegExp.prototype.test;
  const exec = RegExp.prototype.exec;
  const encode = globalThis.encodeURIComponent;
  const freeze = Object.freeze;
  const apply = Reflect.apply;
  let poisonedCalls = 0;
  const poison = () => {
    poisonedCalls++;
    throw new Error("project intrinsic invoked");
  };
  let identity: ServiceRuntimeIdentity | undefined;
  let hostnameName: string | undefined;
  let controlRejected = false;
  let unicodeRejected = false;
  try {
    String.prototype.trim = () => {
      poisonedCalls++;
      return "forged-runtime";
    };
    String.prototype.slice = poison;
    RegExp.prototype.test = poison;
    RegExp.prototype.exec = poison;
    globalThis.encodeURIComponent = poison;
    Object.freeze = poison;
    Reflect.apply = poison;
    identity = getServiceRuntimeIdentity();
    hostnameName = resolveServiceRuntimeName(undefined, () => "  trusted-host  ");
    try {
      resolveServiceRuntimeName("name\nforged");
    } catch {
      controlRejected = true;
    }
    try {
      resolveServiceRuntimeName("bad\ud800");
    } catch {
      unicodeRejected = true;
    }
  } finally {
    String.prototype.trim = trim;
    String.prototype.slice = slice;
    RegExp.prototype.test = test;
    RegExp.prototype.exec = exec;
    globalThis.encodeURIComponent = encode;
    Object.freeze = freeze;
    Reflect.apply = apply;
    if (previousName === undefined) deleteEnv("VERYFRONT_RUNTIME_NAME");
    else setEnv("VERYFRONT_RUNTIME_NAME", previousName);
  }
  assertEquals(poisonedCalls, 0);
  assertEquals(identity?.name, "Trusted service 🚀");
  assertEquals(identity?.mode, "service");
  assertEquals(Object.isFrozen(identity), true);
  assertEquals(getServiceRuntimeIdentity(), identity);
  assertEquals(hostnameName, "trusted-host");
  assertEquals(controlRejected, true);
  assertEquals(unicodeRejected, true);
});

it("accepted service attribution preserves response body and multi-value headers", async () => {
  const nativeJson = Response.json;
  const { routeSet } = createRouteSet({
    verifyRunEventAppendToken: () => Promise.resolve(true),
    prepareExecution: async () => {
      Response.json = (data, init) => {
        const response = nativeJson(data, init);
        response.headers.append("x-service-extra", "first");
        response.headers.append("x-service-extra", "second");
        response.headers.append("set-cookie", "first=1; Path=/");
        response.headers.append("set-cookie", "second=2; Path=/");
        return response;
      };
      return { executionId: "exec-1" };
    },
  });
  let response: Response;
  try {
    response = await routeSet.handleDurableChatRunExecuteRequest({
      request: createDefaultChatStartRequest(),
    });
  } finally {
    Response.json = nativeJson;
  }
  assertEquals(response.status, 202);
  assertEquals(response.headers.get("content-type")?.split(";")[0], "application/json");
  assertEquals(response.headers.get("x-service-extra"), "first, second");
  assertEquals(response.headers.getSetCookie(), ["first=1; Path=/", "second=2; Path=/"]);
  assertEquals(await response.json(), { accepted: true, duplicate: false });
});

for (const surface of ["legacy", "native"] as const) {
  for (const replacement of ["iterator", "set", "response"] as const) {
    it(`accepted ${surface} service identity survives project-mutated ${replacement}`, async () => {
      const iterator = Object.getOwnPropertyDescriptor(Headers.prototype, Symbol.iterator)!;
      const set = Object.getOwnPropertyDescriptor(Headers.prototype, "set")!;
      const responseFields = ["status", "statusText", "headers", "body"] as const;
      const responseDescriptors = responseFields.map((field) =>
        [field, Object.getOwnPropertyDescriptor(Response.prototype, field)!] as const
      );
      let poisonedCalls = 0;
      let starts = 0;
      const poison = () => {
        poisonedCalls++;
        throw new Error("project response intrinsic invoked");
      };
      const { routeSet } = createRouteSet({
        verifyRunEventAppendToken: () => Promise.resolve(true),
        prepareExecution: async () => {
          if (replacement === "set") {
            Object.defineProperty(Headers.prototype, "set", {
              ...set,
              value: function (this: Headers, name: string, value: string) {
                if (name.startsWith("x-veryfront-runtime-")) return poison();
                return Reflect.apply(set.value, this, [name, value]);
              },
            });
          }
          return { executionId: "exec-1" };
        },
        startDetachedExecution: async () => {
          starts++;
          if (replacement === "iterator") {
            Object.defineProperty(Headers.prototype, Symbol.iterator, {
              ...iterator,
              value: poison,
            });
          }
        },
        resolveRuntimeOwnerInvokeUrl: async () => {
          if (replacement === "response") {
            for (const [field, descriptor] of responseDescriptors) {
              // Bun's native getters are non-configurable; attempted replacement must
              // fail without preventing the resolver from returning its owner URL.
              assertEquals(
                Reflect.defineProperty(Response.prototype, field, { ...descriptor, get: poison }),
                descriptor.configurable === true,
              );
            }
          }
          return "http://10.0.0.7:3001/channels/invoke";
        },
      });
      let response: Response | undefined;
      try {
        response = surface === "legacy"
          ? await routeSet.handleDurableChatRunExecuteRequest({
            request: createDefaultChatStartRequest(),
          })
          : await routeSet.handleRuntimeAgentRunInvocationExecuteRequest({
            request: createAuthenticatedRequest(
              "/api/control-plane/runs/run-1/stream",
              createRuntimeAgentInvocationBody(),
              "POST",
              { "X-Veryfront-Run-Event-Token": "run-event-service-token" },
            ),
            runId: "run-1",
          });
      } finally {
        Object.defineProperty(Headers.prototype, Symbol.iterator, iterator);
        Object.defineProperty(Headers.prototype, "set", set);
        for (const [field, descriptor] of responseDescriptors) {
          Object.defineProperty(Response.prototype, field, descriptor);
        }
      }
      assertEquals(response?.status, 202);
      assertEquals(poisonedCalls, 0);
      assertEquals(starts, 1);
      assertEquals(response?.headers.get("x-veryfront-runtime-mode"), "service");
      assertEquals(
        response?.headers.get("x-veryfront-runtime-owner-invoke-url"),
        "http://10.0.0.7:3001/channels/invoke",
      );
      assertEquals(response?.headers.get("x-veryfront-runtime-id"), getServiceRuntimeIdentity().id);
      assertEquals(
        response?.headers.get("x-veryfront-runtime-name"),
        encodeURIComponent(getServiceRuntimeIdentity().name),
      );
      assertEquals(await response?.json(), { accepted: true, duplicate: false });
    });
  }
}

for (const surface of ["legacy", "native"] as const) {
  for (const replacement of ["throw", "forge"] as const) {
    it(`accepted ${surface} runtime name survives a ${replacement} encoder replacement`, async () => {
      const encode = globalThis.encodeURIComponent;
      const expectedName = encode(getServiceRuntimeIdentity().name);
      const request = surface === "legacy"
        ? createDefaultChatStartRequest()
        : createAuthenticatedRequest(
          "/api/control-plane/runs/run-1/stream",
          createRuntimeAgentInvocationBody(),
          "POST",
          { "X-Veryfront-Run-Event-Token": "run-event-service-token" },
        );
      let calls = 0;
      let response: Response | undefined;
      globalThis.encodeURIComponent = () => {
        calls++;
        if (replacement === "throw") throw new Error("project encoder invoked");
        return "forged-runtime";
      };
      try {
        const { routeSet } = createRouteSet({});
        response = surface === "legacy"
          ? await routeSet.handleDurableChatRunExecuteRequest({ request })
          : await routeSet.handleRuntimeAgentRunInvocationExecuteRequest({
            request,
            runId: "run-1",
          });
      } finally {
        globalThis.encodeURIComponent = encode;
      }
      assertEquals(calls, 0);
      assertEquals(response?.status, 202);
      assertEquals(response?.headers.get("x-veryfront-runtime-name"), expectedName);
    });
  }
}
