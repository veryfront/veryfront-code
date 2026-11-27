import { getHostedToolApprovalCapability } from "../hosted/tool-approval-capability.ts";
import { sealIngressCredentials } from "#veryfront/security/http/ingress-credentials.ts";
import { BrokerIngressError } from "./broker-ingress.ts";
import type { ManagedAgentIngressResult } from "./managed-hosted-ingress.ts";
import { managedStart } from "../../../tests/fixtures/managed-executor-start.ts";
import {
  createRunBoundAgentManualPause,
  inheritHostedAgentPauseCapability,
} from "../hosted/manual-pause-credential.ts";
import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { bindManagedBrokerInferenceAuthority } from "./managed-broker-inference.ts";
import { registerModelRuntimeResolverRevoker } from "../runtime/model-transport.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createControlPlaneSignature } from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";
import type {
  ManagedExecutorRuntime,
  ManagedExecutorStartInput,
} from "../hosted/managed-executor-broker.ts";
import {
  createManagedAgUiBrokerHandler,
  createManagedBrokerHandler,
  createManagedDurableBrokerHandler,
} from "./managed-broker.ts";
import { ExecutorAgentError } from "../hosted/executor-agent-schema.ts";
import { computeToolExposureCheckpointSha256 } from "../hosted/chat-request-parser.ts";
import type { ToolExposureCheckpoint } from "../runtime/tool-exposure.ts";
import { resolveConversationHostedStreamErrorState } from "../conversation/hosted-terminal.ts";
import { agUiSseEventTypes, parseAgUiSseResponse } from "../ag-ui/sse-parser.ts";

const projectId = "00000000-0000-4000-8000-000000000005";
const userId = "00000000-0000-4000-8000-000000000006";
const path = "/api/control-plane/runs/run-1/stream";

describe("sealed direct broker admission", () => {
  for (const kind of ["durable", "ag-ui"] as const) {
    for (const reflected of [false, true]) {
      it(`retains ${kind} private credentials through its request copy (reflected=${reflected})`, async () => {
        let prepared = 0;
        const config = {
          owner: { scopeKind: "project" as const, projectId },
          broker: { start: () => Promise.reject(new Error("Must not allocate")) },
          ingress: {
            authenticate: () => Promise.resolve({ userId, authToken: "private-auth" }),
            verifyProjectAccess: () => Promise.resolve({ success: true as const }),
            verifyRunEventAppendToken: async (input: { token: string }) => {
              assertEquals(input.token, "private-event-token");
              return true;
            },
          },
          prepare: ({ ingress }: { ingress: ManagedAgentIngressResult }) => {
            prepared++;
            if (kind === "durable") {
              assertEquals(
                typeof ingress.broker.createInferenceModelResolver({
                  apiBaseUrl: "https://api.example.test",
                }),
                "function",
              );
              assertEquals("inferenceAuthToken" in ingress.broker.getParsedRequest(), false);
              assertEquals(
                JSON.stringify(ingress.executor).includes("private-inference-token"),
                false,
              );
            }
            return Promise.reject(new BrokerIngressError(503, "BROKER_UNAVAILABLE"));
          },
        };
        const managed = kind === "durable"
          ? createManagedDurableBrokerHandler(config)
          : createManagedAgUiBrokerHandler({ ...config, defaultAgentId: "builder" });
        const text = reflected ? "private-event-token" : "Hello";
        const body = kind === "durable"
          ? {
            messages: [{ id: "m", role: "user", parts: [{ type: "text", text }] }],
            context: {
              projectId,
              branchId: "branch-1",
              conversationId: "00000000-0000-4000-8000-000000000001",
            },
            durableRootRun: { runId: "run-1", messageId: "00000000-0000-4000-8000-000000000002" },
          }
          : {
            threadId: "00000000-0000-4000-8000-000000000001",
            runId: "run-1",
            messages: [{ id: "m", role: "user", content: text }],
            tools: [],
            context: [{ description: "veryfront.projectId", value: JSON.stringify(projectId) }],
          };
        try {
          const request = sealIngressCredentials(
            new Request(`https://broker.test/api/${kind === "durable" ? "runs" : "ag-ui"}`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-veryfront-run-event-token": "private-event-token",
                "x-veryfront-inference-token": "private-inference-token",
              },
              body: JSON.stringify(body),
            }),
          );
          const response = await managed.handle(request);
          assertEquals(response.status, reflected ? 403 : 503);
          assertEquals(prepared, reflected ? 0 : 1);
        } finally {
          await managed.close();
        }
      });
    }
  }
});

describe("broker-owned inference dispatch", () => {
  for (const kind of ["durable", "ag-ui"] as const) {
    it(`binds only verified ${kind} inference authority outside executor data`, async () => {
      const fixture = runtimeFixture();
      const execution = new AbortController();
      let started: ManagedExecutorStartInput | undefined;
      let preparedResolver: ManagedExecutorStartInput["model"]["resolver"] | undefined;
      const token = "synthetic-private-inference";
      const options = {
        owner: { scopeKind: "global" as const, serviceName: "test-service" },
        broker: {
          start: (input: ManagedExecutorStartInput) => {
            started = input;
            return Promise.resolve(fixture.runtime);
          },
        },
        ingress: {
          authenticate: () => Promise.resolve({ userId, authToken: "synthetic-api-token" }),
          verifyProjectAccess: () => Promise.resolve({ success: true as const }),
          verifyRunEventAppendToken: () => Promise.resolve(true),
        },
        prepare: ({ ingress }: { ingress: { executor: unknown } }) => {
          assertEquals(JSON.stringify(ingress.executor).includes(token), false);
          const start = managedStart({ agentId: "builder" });
          preparedResolver = start.model.resolver;
          return Promise.resolve({
            start,
            messages: [],
            executionSignal: execution.signal,
            output: { write: () => Promise.resolve(), finish: () => Promise.resolve() },
          });
        },
      };
      const managed = kind === "durable"
        ? createManagedDurableBrokerHandler(options)
        : createManagedAgUiBrokerHandler({ ...options, defaultAgentId: "builder" });
      const conversationId = "00000000-0000-4000-8000-000000000001";
      const body = kind === "durable"
        ? {
          messages: [],
          context: { conversationId, projectId, branchId: "branch-1" },
          durableRootRun: { runId: "run-1", messageId: "00000000-0000-4000-8000-000000000002" },
        }
        : {
          threadId: conversationId,
          runId: "run-1",
          messages: [],
          tools: [],
          context: [{ description: "veryfront.projectId", value: JSON.stringify(projectId) }],
        };
      try {
        const response = await managed.handle(
          new Request(`https://broker.test/api/${kind === "durable" ? "runs" : "ag-ui"}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-veryfront-run-event-token": "synthetic-writer",
              "x-veryfront-inference-token": token,
            },
            body: JSON.stringify(body),
          }),
        );
        assertEquals(response.status, kind === "durable" ? 202 : 200);
        assert(started);
        if (kind === "durable") {
          assert(started.model.resolver !== preparedResolver);
          const retainedResolver = started.model.resolver;
          execution.abort();
          assertThrows(
            () => retainedResolver("veryfront-cloud/mistral/mistral-small-2503"),
            TypeError,
            "Run-scoped inference credential is no longer active",
          );
        } else {
          assertEquals(getHostedToolApprovalCapability(started, "run-1"), undefined);
          // AG-UI has no verified writer/inference binding. A presented header
          // alone must not replace the trusted adapter's model authority.
          assertStrictEquals(started.model.resolver, preparedResolver);
        }
        fixture.release();
        if (kind === "ag-ui") await parseAgUiSseResponse(response);
      } finally {
        fixture.release();
        await managed.close();
      }
    });
  }

  it("selects scoped authority without ambient fallback and preserves other model policies", async () => {
    const start = managedStart({ agentId: "builder" });
    const ambient: string[] = [];
    const scoped: string[] = [];
    start.model.resolver = (id) => {
      ambient.push(id);
      return undefined;
    };
    const bound = bindManagedBrokerInferenceAuthority({
      start,
      createResolver: () => (id) => {
        scoped.push(id);
        return undefined;
      },
      signal: new AbortController().signal,
    });
    assertEquals(bound.start.model.resolver("veryfront-cloud/openai/synthetic"), undefined);
    assertEquals(ambient, []);
    assertEquals(scoped, ["veryfront-cloud/openai/synthetic"]);
    bound.start.model.resolver("custom/model");
    assertEquals(ambient, ["custom/model"]);
    assertStrictEquals(bound.start.model.grant, start.model.grant);
    assertStrictEquals(bound.start.installation, start.installation);
    assertStrictEquals(bound.start.prepare, start.prepare);
    assertStrictEquals(bound.start.session, start.session);
    await bound.cleanup?.();
  });

  it("preserves the scoped failure identity without invoking ambient credentials", async () => {
    const failure = new Error("synthetic scoped refusal");
    const start = managedStart({ agentId: "builder" });
    let ambient = 0;
    start.model.resolver = () => {
      ambient++;
      return undefined;
    };
    const bound = bindManagedBrokerInferenceAuthority({
      start,
      createResolver: () => () => {
        throw failure;
      },
      signal: new AbortController().signal,
    });
    const actual = assertThrows(() => bound.start.model.resolver("veryfront-cloud/test"));
    assertStrictEquals(actual, failure);
    assertEquals(ambient, 0);
    await bound.cleanup?.();
  });

  for (const alreadyAborted of [false, true]) {
    it(`revokes per execution before adapter cleanup (alreadyAborted=${alreadyAborted})`, async () => {
      const controller = new AbortController();
      let active = true;
      let revocations = 0;
      let cleanups = 0;
      const authority = () => {
        if (!active) throw new TypeError("synthetic retired authority");
        return undefined;
      };
      registerModelRuntimeResolverRevoker(authority, () => {
        active = false;
        revocations++;
      });
      if (alreadyAborted) controller.abort();
      const bound = bindManagedBrokerInferenceAuthority({
        start: managedStart({ agentId: "builder" }),
        createResolver: () => authority,
        signal: controller.signal,
        cleanup: () => {
          assertEquals(active, false);
          cleanups++;
          return Promise.resolve();
        },
      });
      if (!alreadyAborted) bound.start.model.resolver("veryfront-cloud/test");
      controller.abort();
      assertThrows(() => bound.start.model.resolver("veryfront-cloud/test"), TypeError);
      await bound.cleanup?.();
      await bound.cleanup?.();
      assertEquals(revocations, 1);
      assertEquals(cleanups, 1);
    });
  }

  it("retirement preserves adapter cleanup errors and does not revoke a sibling", async () => {
    const failure = new Error("synthetic cleanup failure");
    let active = true;
    const authority = () => undefined;
    registerModelRuntimeResolverRevoker(authority, () => {
      active = false;
    });
    const sibling = () => undefined;
    let siblingActive = true;
    registerModelRuntimeResolverRevoker(sibling, () => {
      siblingActive = false;
    });
    const bound = bindManagedBrokerInferenceAuthority({
      start: managedStart({ agentId: "builder" }),
      createResolver: () => authority,
      signal: new AbortController().signal,
      cleanup: () => Promise.reject(failure),
    });
    let actual: unknown;
    try {
      await bound.cleanup?.();
    } catch (error) {
      actual = error;
    }
    assertStrictEquals(actual, failure);
    assertEquals(active, false);
    assertEquals(siblingActive, true);
  });

  it("does not manufacture run authority when ingress supplies none", () => {
    const start = managedStart({ agentId: "builder" });
    const cleanup = () => Promise.resolve();
    const bound = bindManagedBrokerInferenceAuthority({
      start,
      createResolver: () => undefined,
      signal: new AbortController().signal,
      cleanup,
    });
    assertStrictEquals(bound.start, start);
    assertStrictEquals(bound.cleanup, cleanup);
  });

  it("preserves both retirement and adapter failures", async () => {
    const retirementFailure = new Error("synthetic revocation failure");
    const cleanupFailure = new Error("synthetic adapter failure");
    const authority = () => undefined;
    registerModelRuntimeResolverRevoker(authority, () => {
      throw retirementFailure;
    });
    const bound = bindManagedBrokerInferenceAuthority({
      start: managedStart({ agentId: "builder" }),
      createResolver: () => authority,
      signal: new AbortController().signal,
      cleanup: () => Promise.reject(cleanupFailure),
    });
    let actual: unknown;
    try {
      await bound.cleanup?.();
    } catch (error) {
      actual = error;
    }
    assert(actual instanceof AggregateError);
    assertStrictEquals(actual.errors[0], retirementFailure);
    assertStrictEquals(actual.errors[1], cleanupFailure);
  });

  it("refuses malformed preparation before issuing private authority", () => {
    let issued = 0;
    assertThrows(() =>
      bindManagedBrokerInferenceAuthority({
        start: { session: {} } as ManagedExecutorStartInput,
        createResolver: () => {
          issued++;
          return () => undefined;
        },
        signal: new AbortController().signal,
      }), TypeError);
    assertEquals(issued, 0);
  });
});

describe("managed AG-UI broker handler", () => {
  for (const scopeKind of ["global", "project"] as const) {
    for (const namespace of ["veryfront", "custom"]) {
      it(`rejects project requests without a verifier (${scopeKind}, ${namespace})`, async () => {
        let preparations = 0;
        let admissions = 0;
        const managed = createManagedAgUiBrokerHandler({
          owner: scopeKind === "project"
            ? { scopeKind, projectId }
            : { scopeKind, serviceName: "test-service" },
          defaultAgentId: "builder",
          broker: {
            start: () => {
              admissions++;
              return Promise.reject(new Error("Unexpected admission"));
            },
          },
          ingress: {
            authenticate: () => Promise.resolve({ userId, authToken: "synthetic-private-token" }),
            forwardedConfigNamespace: namespace,
          },
          prepare: () => {
            preparations++;
            return Promise.reject(new Error("Unexpected preparation"));
          },
        });
        try {
          const response = await managed.handle(
            new Request("https://broker.test/api/ag-ui", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                threadId: "00000000-0000-4000-8000-000000000001",
                runId: "run-1",
                messages: [],
                tools: [],
                context: [{
                  description: `${namespace}.projectId`,
                  value: JSON.stringify(projectId),
                }],
              }),
            }),
          );
          assertEquals(response.status, 403, await response.text());
          assertEquals(preparations, 0);
          assertEquals(admissions, 0);
        } finally {
          await managed.close();
        }
      });
    }
  }

  it("streams authenticated direct AG-UI through the executor and retires it", async () => {
    const fixture = runtimeFixture();
    const managed = createManagedAgUiBrokerHandler({
      owner: { scopeKind: "global", serviceName: "test-service" },
      broker: { start: () => Promise.resolve(fixture.runtime) },
      ingress: {
        authenticate: () => Promise.resolve({ userId, authToken: "synthetic-private-token" }),
      },
      defaultAgentId: "builder",
      prepare: ({ ingress }) => {
        assertEquals(ingress.kind, "ag-ui");
        assertEquals(JSON.stringify(ingress.executor).includes("synthetic-private-token"), false);
        return Promise.resolve({
          start: managedStart({ agentId: "builder" }),
          messages: [],
          executionSignal: new AbortController().signal,
        });
      },
    });
    try {
      const response = await managed.handle(
        new Request("https://broker.test/api/ag-ui", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            threadId: "00000000-0000-4000-8000-000000000001",
            runId: "run-1",
            messages: [],
            tools: [],
            context: [],
          }),
        }),
      );
      assertEquals(
        response.status,
        200,
        response.status === 200 ? undefined : await response.text(),
      );
      fixture.release();
      const events = await parseAgUiSseResponse(response);
      assertEquals(events.eventTypes.includes(agUiSseEventTypes.runStarted), true);
      assertEquals(fixture.acceptKinds, ["request"]);
    } finally {
      fixture.release();
      await managed.close();
    }
    assertEquals(fixture.closeReasons, ["completed"]);
  });
});

for (const kind of ["durable", "ag-ui"] as const) {
  describe(`direct ${kind} broker authorization`, () => {
    for (const native of [true, false]) {
      it(`preserves authentication rejections before parsing (native=${native})`, async () => {
        const rejection = native
          ? new Response("unauthorized", { status: 401, headers: { "www-authenticate": "Bearer" } })
          : {
            status: 401,
            headers: new Headers({ "www-authenticate": "Bearer" }),
            bodyUsed: false,
            text: () => Promise.resolve("unauthorized"),
            json: () => Promise.resolve({ error: "unauthorized" }),
          } as Response;
        let preparations = 0;
        let admissions = 0;
        const options = {
          owner: { scopeKind: "global" as const, serviceName: "test-service" },
          broker: {
            start: () => {
              admissions++;
              return Promise.reject(new Error("Unexpected admission"));
            },
          },
          ingress: {
            authenticate: () => Promise.resolve(rejection),
            verifyRunEventAppendToken: () => Promise.resolve(true),
          },
          prepare: () => {
            preparations++;
            return Promise.reject(new Error("Unexpected preparation"));
          },
        };
        const managed = kind === "durable"
          ? createManagedDurableBrokerHandler(options)
          : createManagedAgUiBrokerHandler({ ...options, defaultAgentId: "builder" });
        try {
          const response = await managed.handle(
            new Request(`https://broker.test/api/${kind === "durable" ? "runs" : "ag-ui"}`, {
              method: "POST",
              body: "invalid json",
              headers: { "x-veryfront-run-event-token": "synthetic-event-token" },
            }),
          );
          assertEquals(response.status, 401);
          assertStrictEquals(response, rejection);
          assertEquals(response.headers.get("www-authenticate"), "Bearer");
          assertEquals(preparations, 0);
          assertEquals(admissions, 0);
        } finally {
          await managed.close();
        }
      });
    }
    for (const shutdown of ["service", "handler"] as const) {
      it(`stops an incomplete body when ${shutdown} shuts down`, async () => {
        const service = new AbortController();
        const started = Promise.withResolvers<void>();
        let bodyController: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            bodyController = controller;
            controller.enqueue(new TextEncoder().encode("{"));
          },
          pull() {
            started.resolve();
          },
        });
        const options = {
          owner: { scopeKind: "global" as const, serviceName: "test-service" },
          signal: service.signal,
          broker: { start: () => Promise.reject(new Error("Unexpected allocation")) },
          ingress: {
            authenticate: () => Promise.resolve({ userId, authToken: "synthetic-private-token" }),
            verifyRunEventAppendToken: () => Promise.resolve(true),
          },
          prepare: () => Promise.reject(new Error("Unexpected preparation")),
        };
        const managed = kind === "durable"
          ? createManagedDurableBrokerHandler(options)
          : createManagedAgUiBrokerHandler({ ...options, defaultAgentId: "builder" });
        const pending = managed.handle(
          new Request(
            `https://broker.test/api/${kind === "durable" ? "runs" : "ag-ui"}`,
            {
              method: "POST",
              body,
              duplex: "half",
              headers: { "x-veryfront-run-event-token": "synthetic-event-token" },
            } as RequestInit,
          ),
        );
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await started.promise;
          if (shutdown === "service") service.abort();
          else await managed.close();
          const response = await Promise.race([
            pending,
            new Promise<undefined>((resolve) => {
              timer = setTimeout(() => resolve(undefined), 100);
            }),
          ]);
          assertEquals(response?.status, 503);
        } finally {
          clearTimeout(timer);
          try {
            bodyController!.close();
          } catch { /* Body may already be canceled. */ }
          await pending;
          await managed.close();
        }
      });
    }
    for (const rejection of ["method", "path", "authentication", "project", "owner"] as const) {
      it(`rejects ${rejection} before preparation or allocation`, async () => {
        let preparations = 0;
        let allocations = 0;
        const options = {
          owner: { scopeKind: "project" as const, projectId },
          broker: {
            start: () => {
              allocations++;
              return Promise.reject(new Error("Unexpected allocation"));
            },
          },
          ingress: {
            authenticate: () =>
              Promise.resolve(
                rejection === "authentication"
                  ? new Response(null, { status: 401 })
                  : { userId, authToken: "synthetic-private-token" },
              ),
            verifyProjectAccess: () =>
              Promise.resolve(
                rejection === "project"
                  ? {
                    success: false as const,
                    error: {
                      errorCode: "FORBIDDEN",
                      message: "Project access denied",
                      statusCode: 403,
                    },
                  }
                  : { success: true as const },
              ),
            verifyRunEventAppendToken: () => Promise.resolve(true),
          },
          prepare: () => {
            preparations++;
            return Promise.reject(new Error("Unexpected preparation"));
          },
        };
        const managed = kind === "durable"
          ? createManagedDurableBrokerHandler(options)
          : createManagedAgUiBrokerHandler({ ...options, defaultAgentId: "builder" });
        const requestedProject = rejection === "owner"
          ? "00000000-0000-4000-8000-000000000009"
          : projectId;
        const context = {
          projectId: requestedProject,
          branchId: "branch-1",
          conversationId: "00000000-0000-4000-8000-000000000001",
        };
        const body = kind === "durable"
          ? {
            messages: [],
            context,
            durableRootRun: { runId: "run-1", messageId: "00000000-0000-4000-8000-000000000002" },
          }
          : {
            threadId: context.conversationId,
            runId: "run-1",
            messages: [],
            tools: [],
            context: [{
              description: "veryfront.projectId",
              value: JSON.stringify(requestedProject),
            }],
          };
        try {
          const response = await managed.handle(
            new Request(
              `https://broker.test${
                rejection === "path" ? "/wrong" : kind === "durable" ? "/api/runs" : "/api/ag-ui"
              }`,
              {
                method: rejection === "method" ? "PUT" : "POST",
                headers: {
                  "content-type": "application/json",
                  "x-veryfront-run-event-token": "synthetic-event-token",
                },
                body: JSON.stringify(body),
              },
            ),
          );
          assertEquals(
            response.status,
            rejection === "method" || rejection === "path"
              ? 400
              : rejection === "authentication"
              ? 401
              : 403,
            await response.text(),
          );
          assertEquals(preparations, 0);
          assertEquals(allocations, 0);
        } finally {
          await managed.close();
        }
      });
    }
  });
}

describe("managed durable broker handler", () => {
  it("binds a verified resume call into managed runtime preparation", async () => {
    const fixture = runtimeFixture();
    const execution = new AbortController();
    const resumeToolCall = {
      id: "call-inbox:resume-1",
      name: "outlook__list_threads",
      input: { folder: "inbox", options: { limit: 2 } },
    };
    let started: ManagedExecutorStartInput | undefined;
    const managed = createManagedDurableBrokerHandler({
      owner: { scopeKind: "global", serviceName: "test-service" },
      broker: {
        start: (input) => {
          started = input;
          return Promise.resolve(fixture.runtime);
        },
      },
      ingress: {
        authenticate: () => Promise.resolve({ userId, authToken: "synthetic-private-token" }),
        verifyProjectAccess: () => Promise.resolve({ success: true }),
        verifyRunEventAppendToken: () =>
          Promise.resolve({
            verified: true,
            resumeToolCallSha256:
              "964c9f4d464ae2f7c3d782e8c5ca0549737e7c50eb6c41a11bcd6dd7082753c1",
          }),
      },
      prepare: ({ ingress }) => {
        const projected = ingress.executor.serverResolvedResumeToolCall;
        if (!projected) throw new Error("Expected verified resume call projection");
        Reflect.set(projected, "id", "mutated:resume-1");
        Reflect.set(projected, "name", "mutated_tool");
        const nested = projected.input.options;
        if (nested !== null && typeof nested === "object" && !Array.isArray(nested)) {
          Reflect.set(nested, "limit", 99);
        }
        return Promise.resolve({
          start: managedStart({ agentId: "builder" }),
          messages: [],
          executionSignal: execution.signal,
          output: {
            write: () => Promise.resolve(),
            finish: () => Promise.resolve(),
          },
        });
      },
    });
    try {
      const response = await managed.handle(
        new Request("https://broker.test/api/runs", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-veryfront-run-event-token": "synthetic-event-token",
          },
          body: JSON.stringify({
            messages: [],
            context: {
              projectId,
              branchId: "branch-1",
              conversationId: "00000000-0000-4000-8000-000000000001",
            },
            durableRootRun: {
              runId: "run-1",
              messageId: "00000000-0000-4000-8000-000000000002",
            },
            resumeToolCall,
          }),
        }),
      );
      assertEquals(response.status, 202, await response.clone().text());
      assertEquals(started?.prepare.serverResolvedResumeToolCall, resumeToolCall);
      execution.abort();
    } finally {
      fixture.release();
      await managed.close();
    }
  });

  it("restores a signed tool exposure checkpoint only when the start grants checkpoint persistence", async () => {
    const checkpoint: ToolExposureCheckpoint = { version: 2, loadedToolNames: ["create_file"] };
    for (const granted of [true, false]) {
      const fixture = runtimeFixture();
      const execution = new AbortController();
      let started: ManagedExecutorStartInput | undefined;
      const managed = createManagedDurableBrokerHandler({
        owner: { scopeKind: "global", serviceName: "test-service" },
        broker: {
          start: (input) => {
            started = input;
            return Promise.resolve(fixture.runtime);
          },
        },
        ingress: {
          authenticate: () => Promise.resolve({ userId, authToken: "synthetic-private-token" }),
          verifyProjectAccess: () => Promise.resolve({ success: true }),
          verifyRunEventAppendToken: async () => ({
            verified: true,
            toolExposureCheckpointSha256: await computeToolExposureCheckpointSha256(checkpoint),
          }),
        },
        prepare: () => {
          const start = managedStart({ agentId: "builder" });
          return Promise.resolve({
            start: granted
              ? { ...start, persistence: { persistToolExposureCheckpoint: () => {} } }
              : start,
            messages: [],
            executionSignal: execution.signal,
            output: {
              write: () => Promise.resolve(),
              finish: () => Promise.resolve(),
            },
          });
        },
      });
      try {
        const response = await managed.handle(
          new Request("https://broker.test/api/runs", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-veryfront-run-event-token": "synthetic-event-token",
            },
            body: JSON.stringify({
              messages: [],
              context: {
                projectId,
                branchId: "branch-1",
                conversationId: "00000000-0000-4000-8000-000000000001",
              },
              durableRootRun: {
                runId: "run-1",
                messageId: "00000000-0000-4000-8000-000000000002",
              },
              forwardedProps: { serverResolvedToolExposureCheckpoint: checkpoint },
            }),
          }),
        );
        assertEquals(response.status, 202, await response.clone().text());
        assertEquals(
          started?.persistence.initialToolExposureCheckpoint,
          granted ? checkpoint : undefined,
        );
        execution.abort();
      } finally {
        fixture.release();
        await managed.close();
      }
    }
  });

  it("strips replay authority supplied only by the preparation adapter", async () => {
    const fixture = runtimeFixture();
    const execution = new AbortController();
    let started: ManagedExecutorStartInput | undefined;
    const managed = createManagedDurableBrokerHandler({
      owner: { scopeKind: "global", serviceName: "test-service" },
      broker: {
        start: (input) => {
          started = input;
          return Promise.resolve(fixture.runtime);
        },
      },
      ingress: {
        authenticate: () => Promise.resolve({ userId, authToken: "synthetic-private-token" }),
        verifyProjectAccess: () => Promise.resolve({ success: true }),
        verifyRunEventAppendToken: () => Promise.resolve(true),
      },
      prepare: () =>
        Promise.resolve({
          start: managedStart({
            agentId: "builder",
            serverResolvedResumeToolCall: {
              id: "counterfeit:resume-1",
              name: "outlook__list_threads",
              input: { folder: "inbox" },
            },
          }),
          messages: [],
          executionSignal: execution.signal,
          output: {
            write: () => Promise.resolve(),
            finish: () => Promise.resolve(),
          },
        }),
    });
    try {
      const response = await managed.handle(
        new Request("https://broker.test/api/runs", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-veryfront-run-event-token": "synthetic-event-token",
          },
          body: JSON.stringify({
            messages: [],
            context: {
              projectId,
              branchId: "branch-1",
              conversationId: "00000000-0000-4000-8000-000000000001",
            },
            durableRootRun: {
              runId: "run-1",
              messageId: "00000000-0000-4000-8000-000000000002",
            },
          }),
        }),
      );
      assertEquals(response.status, 202, await response.clone().text());
      assertEquals(started?.prepare.serverResolvedResumeToolCall, undefined);
      execution.abort();
    } finally {
      fixture.release();
      await managed.close();
    }
  });

  for (const privateMapping of [false, true]) {
    it(`uses only a private legacy approval run mapping (bound: ${privateMapping})`, async () => {
      const canonicalRunId = "11111111-1111-4111-8111-111111111111";
      const token = privateMapping
        ? `header.${
          btoa(
            JSON.stringify({
              runId: "run-1",
              canonicalRunId,
              tokenUse: "run_event_writer",
              writerPurpose: "current_run_terminal",
              dispatchNonce: "test-generation",
            }),
          )
        }.signature`
        : "synthetic-unbound-writer";
      const fixture = runtimeFixture();
      const execution = new AbortController();
      let started: ManagedExecutorStartInput | undefined;
      const paths: string[] = [];
      const managed = createManagedDurableBrokerHandler({
        owner: { scopeKind: "global", serviceName: "test-service" },
        approvalApiBaseUrl: "https://approval.example.test",
        approvalFetch: ((url, init) => {
          paths.push(String(url));
          assertEquals(
            new Headers(init?.headers).get("authorization"),
            "Bearer synthetic-private-token",
          );
          return Promise.reject(new Error("synthetic approval transport"));
        }) as typeof fetch,
        broker: {
          start(input) {
            started = input;
            return Promise.resolve(fixture.runtime);
          },
        },
        ingress: {
          authenticate: () => Promise.resolve({ userId, authToken: "synthetic-private-token" }),
          verifyProjectAccess: () => Promise.resolve({ success: true }),
          verifyRunEventAppendToken: () => Promise.resolve(true),
        },
        prepare: () =>
          Promise.resolve({
            start: managedStart({ agentId: "builder" }),
            messages: [],
            executionSignal: execution.signal,
            output: { write: () => Promise.resolve(), finish: () => Promise.resolve() },
          }),
      });
      try {
        const response = await managed.handle(
          new Request("https://broker.test/api/runs", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-veryfront-run-event-token": "synthetic-event-token",
              "x-veryfront-run-terminal-token": token,
            },
            body: JSON.stringify({
              messages: [],
              context: {
                projectId,
                branchId: "branch-1",
                conversationId: "00000000-0000-4000-8000-000000000001",
              },
              durableRootRun: { runId: "run-1", messageId: "00000000-0000-4000-8000-000000000002" },
            }),
          }),
        );
        assertEquals(response.status, 202, await response.clone().text());
        assert(started);
        const gate = getHostedToolApprovalCapability(started, "run-1");
        assertEquals(typeof gate, privateMapping ? "function" : "undefined");
        assertEquals(
          getHostedToolApprovalCapability({
            projectId,
            runId: "run-1",
            approvalRunId: canonicalRunId,
          }, "run-1"),
          undefined,
        );
        if (gate) {
          await assertRejects(() =>
            gate({ toolName: "transfer", toolCallId: "call-1", input: {}, policy: {} })
          );
          assertEquals(paths.length, 1);
          assert(paths[0]!.includes(`/runs/${canonicalRunId}/`));
          assertEquals(paths[0]!.includes("/runs/run-1/"), false);
          assertEquals(getHostedToolApprovalCapability(started, canonicalRunId), undefined);
        }
        assertEquals(JSON.stringify(started).includes("synthetic-private-token"), false);
      } finally {
        fixture.release();
        await managed.close();
      }
    });
  }

  it("requires a run-event capability before allocating a canonical executor", async () => {
    let starts = 0;
    const managed = createManagedDurableBrokerHandler({
      owner: { scopeKind: "global", serviceName: "test-service" },
      broker: {
        start: () => {
          starts++;
          return Promise.reject(new Error("Unexpected admission"));
        },
      },
      ingress: {
        authenticate: () => Promise.resolve({ userId, authToken: "synthetic-private-token" }),
        verifyProjectAccess: () => Promise.resolve({ success: true }),
        verifyRunEventAppendToken: () => Promise.resolve(true),
      },
      prepare: () => Promise.reject(new Error("Unexpected preparation")),
    });
    try {
      const response = await managed.handle(
        new Request("https://broker.test/api/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [],
            context: {
              projectId,
              branchId: "branch-1",
              conversationId: "00000000-0000-4000-8000-000000000001",
            },
            durableRootRun: { runId: "run-1", messageId: "00000000-0000-4000-8000-000000000002" },
          }),
        }),
      );
      assertEquals(response.status, 401);
      assertEquals(starts, 0);
    } finally {
      await managed.close();
    }
  });

  for (const allowed of [true, false]) {
    it(`authenticates direct durable ingress before executor admission (allowed=${allowed})`, async () => {
      const fixture = runtimeFixture();
      let starts = 0;
      let finishes = 0;
      const controller = new AbortController();
      const managed = createManagedDurableBrokerHandler({
        owner: { scopeKind: "global", serviceName: "test-service" },
        broker: {
          start: () => {
            starts++;
            return Promise.resolve(fixture.runtime);
          },
        },
        ingress: {
          authenticate: () =>
            Promise.resolve(
              allowed
                ? { userId, authToken: "synthetic-private-token" }
                : new Response(null, { status: 401 }),
            ),
          verifyProjectAccess: () => Promise.resolve({ success: true }),
          verifyRunEventAppendToken: () => Promise.resolve(true),
        },
        prepare: ({ ingress }) => {
          assertEquals(ingress.broker.getParsedRequest().authToken, "synthetic-private-token");
          assertEquals(JSON.stringify(ingress.executor).includes("synthetic-private-token"), false);
          return Promise.resolve({
            start: managedStart({ agentId: "builder" }),
            messages: [],
            executionSignal: controller.signal,
            output: {
              write: () => Promise.resolve(),
              finish: () => {
                finishes++;
                return Promise.resolve();
              },
            },
          });
        },
      });
      const makeRequest = () =>
        new Request("https://broker.test/api/runs", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-veryfront-run-event-token": "synthetic-event-token",
          },
          body: JSON.stringify({
            messages: [],
            context: {
              projectId,
              branchId: "branch-1",
              conversationId: "00000000-0000-4000-8000-000000000001",
            },
            durableRootRun: { runId: "run-1", messageId: "00000000-0000-4000-8000-000000000002" },
          }),
          signal: controller.signal,
        });
      try {
        const response = await managed.handle(makeRequest());
        assertEquals(response.status, allowed ? 202 : 401, await response.clone().text());
        if (allowed) {
          const duplicate = await managed.handle(makeRequest());
          assertEquals(await duplicate.json(), { accepted: true, duplicate: true });
          controller.abort();
        }
        assertEquals(starts, allowed ? 1 : 0);
      } finally {
        fixture.release();
        await managed.close();
      }
      assertEquals(finishes, allowed ? 1 : 0);
    });
  }
});

async function request(
  signal?: AbortSignal,
  requestPath = path,
  runId = "run-1",
  sourceAuthToken?: string,
) {
  const body = JSON.stringify({
    run: {
      agentServiceId: "service-1",
      agentId: "builder",
      conversationId: "00000000-0000-4000-8000-000000000001",
      runId,
      messageId: "00000000-0000-4000-8000-000000000002",
      inputAnchorMessageId: "00000000-0000-4000-8000-000000000003",
      requestedByUserId: userId,
      project: { projectId, projectSlug: "demo-project", runtimeTargetKind: "main_branch" },
    },
    messages: [],
    tools: [],
    context: [],
    agentSource: { type: "release", releaseId: "release-1" },
    credentials: {
      authToken: "api-token",
      inferenceAuthToken: "inference-token",
      ...(sourceAuthToken ? { sourceAuthToken } : {}),
    },
  });
  const signed = await createControlPlaneSignature(body, {
    audience: "demo-project",
    projectId,
    requestId: runId,
    requestPath,
  });
  return {
    publicKeyPem: signed.publicKeyPem,
    request: new Request(`https://broker.test${requestPath}`, {
      method: "POST",
      headers: {
        authorization: "Bearer broker-token",
        "x-veryfront-control-plane-jws": signed.jws,
        "x-veryfront-run-event-token": "event-token",
      },
      body,
      signal,
    }),
  };
}

function runtimeFixture(
  streamFailure = false,
  terminalChunk?:
    | "error"
    | "coded-error"
    | "empty-response-error"
    | "finish-error"
    | "partial-finish-error"
    | "error-then-throw"
    | "legacy-coded-error",
  finishWithUsage?: true,
  streamOpenFailure = false,
  streamOpenQuota = false,
) {
  const release = Promise.withResolvers<void>();
  const settled = Promise.withResolvers<void>();
  const acceptKinds: string[] = [];
  const closeReasons: string[] = [];
  let streamCalls = 0;
  const runtime: ManagedExecutorRuntime = {
    definition: { id: "builder", name: "Builder", description: "Builds", instructions: "Work" },
    modelId: "veryfront-cloud/openai/synthetic",
    runtimeKind: "framework",
    signal: new AbortController().signal,
    accepted: false,
    settled: settled.promise,
    runOwned: (operation) => operation(),
    accept(ownership) {
      acceptKinds.push(ownership.kind);
      Object.defineProperty(runtime, "accepted", { value: true });
    },
    close(reason = "canceled") {
      closeReasons.push(reason);
      settled.resolve();
      return Promise.resolve({ reason, release: "released" });
    },
    agent: {
      async stream() {
        streamCalls++;
        if (streamOpenQuota) throw new ExecutorAgentError("INSUFFICIENT_CREDITS");
        if (streamOpenFailure) throw new Error("synthetic stream setup failed");
        return {
          steps: Promise.resolve([]),
          toUIMessageStream(streamOptions = {}) {
            return (async function* () {
              await release.promise;
              if (streamFailure) throw new Error("synthetic stream failure");
              if (terminalChunk === "error") {
                yield { type: "error", errorText: "ordinary stream error" } as const;
                return;
              }
              if (terminalChunk === "legacy-coded-error") {
                yield { type: "error", errorText: "INSUFFICIENT_CREDITS" } as const;
                return;
              }
              if (terminalChunk === "coded-error") {
                yield {
                  type: "error",
                  errorText: "INSUFFICIENT_CREDITS",
                  code: "INSUFFICIENT_CREDITS",
                } as const;
                return;
              }
              if (terminalChunk === "error-then-throw") {
                yield {
                  type: "error",
                  errorText: "private callback detail",
                  code: "EMPTY_RESPONSE",
                } as const;
                throw new Error("private stream cleanup detail");
              }
              if (terminalChunk === "empty-response-error") {
                yield {
                  type: "error",
                  errorText: "private executor empty-response detail",
                  code: "EMPTY_RESPONSE",
                } as const;
                return;
              }
              if (terminalChunk === "finish-error" || terminalChunk === "partial-finish-error") {
                if (terminalChunk === "partial-finish-error") {
                  yield { type: "text-delta", id: "text-1", delta: "partial response" } as const;
                }
                yield { type: "finish", finishReason: "error" } as const;
                return;
              }
              if (finishWithUsage) {
                const part = {
                  type: "finish" as const,
                  finishReason: "stop" as const,
                  totalUsage: {
                    inputTokens: 12,
                    outputTokens: 7,
                    usageCaptureStatus: "complete" as const,
                  },
                };
                yield { type: "text-delta", id: "assistant-message", delta: "done" } as const;
                yield {
                  type: "finish",
                  finishReason: "stop",
                  messageMetadata: streamOptions.messageMetadata?.({ part }),
                } as const;
                return;
              }
              yield { type: "start", messageId: "assistant-message" } as const;
            })();
          },
        };
      },
    },
  };
  return {
    runtime,
    release: release.resolve,
    acceptKinds,
    closeReasons,
    get streamCalls() {
      return streamCalls;
    },
  };
}

async function handler(
  mode: "detached" | "sse",
  options: {
    signal?: AbortSignal;
    serviceSignal?: AbortSignal;
    maxActiveRuns?: number;
    requestPath?: string;
    failStart?: boolean;
    admitBeforeFailure?: boolean;
    waitForPrepare?: boolean;
    abortPrepare?: boolean;
    waitForAuthorization?: boolean;
    throwingObserver?: boolean;
    streamFailure?: boolean;
    streamOpenFailure?: boolean;
    streamOpenQuota?: boolean;
    terminalChunk?:
      | "error"
      | "coded-error"
      | "empty-response-error"
      | "finish-error"
      | "partial-finish-error"
      | "error-then-throw"
      | "legacy-coded-error";
    finishWithUsage?: true;
    missingOutput?: boolean;
    negotiatedWriter?: boolean;
    waitForOutput?: boolean;
    outputFailure?: boolean;
    writeFailure?: boolean;
    cleanupFailure?: boolean;
    startError?: Error;
  } = {},
) {
  const first = await request(options.signal, options.requestPath);
  const fixture = runtimeFixture(
    options.streamFailure,
    options.terminalChunk,
    options.finishWithUsage,
    options.streamOpenFailure,
    options.streamOpenQuota,
  );
  let prepareCalls = 0;
  let brokerStarts = 0;
  let cleanupCalls = 0;
  const outputChunks: string[] = [];
  const outputErrorTexts: string[] = [];
  const outputFinishes: boolean[] = [];
  const outputPauses: (true | undefined)[] = [];
  const outputFinishErrors: unknown[] = [];
  const outputFinishMetadata: unknown[] = [];
  const executionErrors: unknown[] = [];
  const outputRelease = Promise.withResolvers<void>();
  const outputEntered = Promise.withResolvers<void>();
  let prepareSignal: AbortSignal | undefined;
  const prepareEntered = Promise.withResolvers<void>();
  const prepareRelease = Promise.withResolvers<void>();
  const authorizationEntered = Promise.withResolvers<void>();
  const authorizationRelease = Promise.withResolvers<void>();
  const admitted = Promise.withResolvers<void>();
  const executionController = new AbortController();
  const additionalKeys = new Map<string, string>();
  const managed = createManagedBrokerHandler({
    responseMode: mode,
    maxActiveRuns: options.maxActiveRuns,
    signal: options.serviceSignal,
    broker: {
      start: (start, lifecycle) => {
        brokerStarts++;
        prepareSignal = start.session.preparationSignal;
        if (options.admitBeforeFailure) lifecycle?.onAdmitted?.(admitted.promise);
        return options.failStart
          ? Promise.reject(options.startError ?? new Error("synthetic start failure"))
          : Promise.resolve(fixture.runtime);
      },
    },
    resolveIngressOptions: ({ runId }) => ({
      publicKeyPem: additionalKeys.get(runId) ?? first.publicKeyPem,
      audience: "demo-project",
      projectId,
      expectedSurface: "studio",
      boundSource: { type: "release", releaseId: "release-1" },
      expectedOwner: { scopeKind: "project", projectId },
      authorizeScope: async () => {
        authorizationEntered.resolve();
        if (options.waitForAuthorization) await authorizationRelease.promise;
        options.serviceSignal?.throwIfAborted();
        return { userId };
      },
    }),
    prepare: async ({ signal }) => {
      prepareCalls++;
      prepareSignal = signal;
      prepareEntered.resolve();
      if (options.waitForPrepare) await prepareRelease.promise;
      if (options.abortPrepare) {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
      return {
        start: managedStart({ agentId: "builder" }),
        messages: [],
        executionSignal: executionController.signal,
        cancelExecution: () => executionController.abort(),
        ...(options.negotiatedWriter ? { eventPersistence: "runtime-owned-v1" as const } : {}),
        output: options.missingOutput ? undefined : {
          async write(chunk: { type: string; errorText?: string }) {
            outputChunks.push(chunk.type);
            if (typeof chunk.errorText === "string") outputErrorTexts.push(chunk.errorText);
            if (options.writeFailure) throw new Error("SSE output write failed");
          },
          async finish(
            outcome: { completed: boolean; paused?: true; error?: unknown; metadata?: unknown },
          ) {
            outputFinishes.push(outcome.completed);
            outputPauses.push(outcome.paused);
            outputFinishErrors.push(outcome.error);
            outputFinishMetadata.push(outcome.metadata);
            outputEntered.resolve();
            if (options.outputFailure) throw new Error("Output flush failed");
            if (options.waitForOutput) await outputRelease.promise;
          },
        },
        cleanup: async () => {
          cleanupCalls++;
          if (options.cleanupFailure) throw new Error("Prepared cleanup failed");
        },
      };
    },
    onExecutionError: (error) => {
      executionErrors.push(error);
      if (options.throwingObserver) throw new Error("observer");
    },
  });
  return {
    first,
    fixture,
    managed,
    admitted: admitted.resolve,
    prepareEntered: prepareEntered.promise,
    releasePrepare: prepareRelease.resolve,
    authorizationEntered: authorizationEntered.promise,
    releaseAuthorization: authorizationRelease.resolve,
    outputChunks,
    outputErrorTexts,
    outputFinishes,
    outputPauses,
    outputFinishErrors,
    outputFinishMetadata,
    executionErrors,
    releaseOutput: outputRelease.resolve,
    outputEntered: outputEntered.promise,
    abortExecution: () => executionController.abort(),
    async nextRequest(runId: string) {
      const next = await request(undefined, `/api/control-plane/runs/${runId}/stream`, runId);
      additionalKeys.set(runId, next.publicKeyPem);
      return next.request;
    },
    get prepareCalls() {
      return prepareCalls;
    },
    get brokerStarts() {
      return brokerStarts;
    },
    get cleanupCalls() {
      return cleanupCalls;
    },
    get prepareSignal() {
      return prepareSignal;
    },
  };
}

describe("managed broker handler", () => {
  it("retains late execution pause finalization throughout the original drain deadline", async () => {
    const f = await handler("detached", { waitForPrepare: true });
    const settlementEntered = Promise.withResolvers<void>();
    const settlementRelease = Promise.withResolvers<void>();
    const capability = createRunBoundAgentManualPause({
      apiUrl: "https://api.example.test",
      runId: "run-1",
      token: "synthetic-pause-token",
      signal: new AbortController().signal,
      fetch: async (_url, init) => {
        if (JSON.parse(String(init?.body)).settled) {
          settlementEntered.resolve();
          await settlementRelease.promise;
        }
        return Response.json({ stop: true });
      },
    });
    await capability.acknowledge({
      version: 1,
      nextStep: 1,
      messages: [],
      toolCalls: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      latestAssistantText: "",
      completed: false,
      recoveredEmptyResponse: false,
      recoveredInterruptedLocalToolBatch: false,
    });
    capability.persisted?.(true);
    inheritHostedAgentPauseCapability(f.fixture.runtime, capability);
    const handling = f.managed.handle(f.first.request);
    try {
      await f.prepareEntered;
      const draining = f.managed.drain({ timeoutMs: 10 });
      f.releasePrepare();
      assertEquals((await handling).status, 202);
      f.fixture.release();
      await settlementEntered.promise;
      assertEquals(f.managed.active, 0);
      assertEquals(f.cleanupCalls, 1);
      // The reservation has retired, but the later-created execution still owns
      // the durable pause receipt. The same finite drain must wait or time out.
      assertEquals(await draining, false);
      const completed = f.managed.drain({ timeoutMs: 1000 });
      settlementRelease.resolve();
      assertEquals(await completed, true);
    } finally {
      f.releasePrepare();
      f.fixture.release();
      settlementRelease.resolve();
      await handling;
      await f.managed.close();
    }
  });

  it("cleans prepared ownership when negotiated output is unavailable", async () => {
    const f = await handler("sse", { missingOutput: true, negotiatedWriter: true });
    try {
      assertEquals((await f.managed.handle(f.first.request)).status, 500);
      assertEquals(f.brokerStarts, 0);
      assertEquals(f.cleanupCalls, 1);
    } finally {
      await f.managed.close();
    }
  });

  it("preserves a safe execution error code for the API-owned terminal decision", async () => {
    const f = await handler("sse", { streamOpenQuota: true });
    try {
      const parsed = await parseAgUiSseResponse(await f.managed.handle(f.first.request));
      const error = parsed.events.find((event) => event.type === agUiSseEventTypes.runError);
      assertEquals((error as { code?: string })?.code, "INSUFFICIENT_CREDITS");
      assert(f.outputFinishErrors[0] instanceof ExecutorAgentError);
    } finally {
      await f.managed.close();
    }
  });

  for (
    const [option, diagnostic] of [
      ["writeFailure", "SSE output write failed"],
      ["outputFailure", "Output flush failed"],
      ["streamOpenFailure", "synthetic stream setup failed"],
      ["streamFailure", "synthetic stream failure"],
    ] as const
  ) {
    it(`redacts ${option} from public SSE while preserving broker diagnostics`, async () => {
      const f = await handler("sse", { [option]: true });
      try {
        const response = await f.managed.handle(f.first.request);
        f.fixture.release();
        const wire = await response.text();
        assert(wire.includes("event: RunError"));
        assert(!wire.includes(diagnostic));
        assert(wire.includes("EXECUTOR_AGENT_STREAM_FAILED"));
        assert(
          f.executionErrors.some((error) => error instanceof Error && error.message === diagnostic),
        );
        if (option !== "outputFailure") {
          assert(
            f.outputFinishErrors.some((error) =>
              error instanceof Error && error.message === diagnostic
            ),
          );
        }
      } finally {
        f.fixture.release();
        await f.managed.close();
      }
    });
  }

  for (
    const terminalChunk of [
      "error",
      "coded-error",
      "finish-error",
      "partial-finish-error",
      "error-then-throw",
    ] as const
  ) {
    it(`emits one failed SSE terminal without success for ${terminalChunk}`, async () => {
      const f = await handler("sse", { terminalChunk });
      try {
        const response = await f.managed.handle(f.first.request);
        f.fixture.release();
        const parsed = await parseAgUiSseResponse(response);
        assertEquals(
          parsed.events.filter((event) => event.type === agUiSseEventTypes.runError).length,
          1,
        );
        assertEquals(
          parsed.events.filter((event) => event.type === agUiSseEventTypes.runFinished).length,
          0,
        );
        if (terminalChunk === "partial-finish-error") {
          assert(
            parsed.events.some((event) =>
              event.type === agUiSseEventTypes.textMessageContent &&
              (event as { delta?: string }).delta === "partial response"
            ),
          );
        }
        assertEquals(f.outputFinishes, [false]);
        assert(f.outputFinishErrors[0] instanceof Error);
        assertEquals(f.fixture.closeReasons, ["canceled"]);
      } finally {
        f.fixture.release();
        await f.managed.close();
      }
    });
  }

  it("retains exact known codes from older errorText-only producers", async () => {
    const f = await handler("sse", { terminalChunk: "legacy-coded-error" });
    try {
      const response = await f.managed.handle(f.first.request);
      f.fixture.release();
      const parsed = await parseAgUiSseResponse(response);
      const error = parsed.events.find((event) => event.type === agUiSseEventTypes.runError);
      assertEquals((error as { code?: string })?.code, "INSUFFICIENT_CREDITS");
      assertEquals(f.outputErrorTexts, ["INSUFFICIENT_CREDITS"]);
      assertEquals((f.outputFinishErrors[0] as ExecutorAgentError).code, "INSUFFICIENT_CREDITS");
    } finally {
      f.fixture.release();
      await f.managed.close();
    }
  });

  it("redacts explicit error chunks while retaining their private diagnostic and public code", async () => {
    const f = await handler("sse", { terminalChunk: "empty-response-error" });
    try {
      const response = await f.managed.handle(f.first.request);
      f.fixture.release();
      const wire = await response.text();
      assert(!wire.includes("private executor empty-response detail"));
      assert(wire.includes("EMPTY_RESPONSE"));
      assertEquals(f.outputErrorTexts, ["EMPTY_RESPONSE"]);
      assertEquals((f.outputFinishErrors[0] as Error).cause instanceof Error, true);
      assertEquals(
        ((f.outputFinishErrors[0] as Error).cause as Error).message,
        "private executor empty-response detail",
      );
      assert(
        f.executionErrors.some((error) =>
          error instanceof Error && error.message === "private executor empty-response detail"
        ),
      );
    } finally {
      f.fixture.release();
      await f.managed.close();
    }
  });

  it("retains the first failed terminal when output finalization also fails", async () => {
    const f = await handler("sse", { terminalChunk: "empty-response-error", outputFailure: true });
    try {
      const response = await f.managed.handle(f.first.request);
      f.fixture.release();
      const wire = await response.text();
      assertEquals(wire.match(/event: RunError/g)?.length, 1);
      assert(!wire.includes("event: RunFinished"));
      assert(wire.includes("EMPTY_RESPONSE"));
      assert(!wire.includes("Output flush failed"));
      assert(!wire.includes("private executor empty-response detail"));
      assert(
        f.executionErrors.some((error) =>
          error instanceof Error && error.message === "Output flush failed"
        ),
      );
    } finally {
      f.fixture.release();
      await f.managed.close();
    }
  });

  it("persists SSE output and usage before acknowledging canonical completion", async () => {
    const f = await handler("sse", { finishWithUsage: true });
    try {
      const response = await f.managed.handle(f.first.request);
      f.fixture.release();
      const parsed = await parseAgUiSseResponse(response);
      assert(parsed.events.some((event) => event.type === agUiSseEventTypes.runFinished));
      assertEquals(f.outputChunks, ["text-delta", "finish"]);
      assertEquals(f.outputFinishes, [true]);
      assertEquals(f.outputFinishMetadata, [{
        modelId: f.fixture.runtime.modelId,
        usage: { inputTokens: 12, outputTokens: 7 },
        usageCaptureStatus: "complete",
      }]);
    } finally {
      f.fixture.release();
      await f.managed.close();
    }
  });

  it("holds capacity for canceled executions until their output and cleanup settle", async () => {
    const f = await handler("sse", { maxActiveRuns: 1, waitForOutput: true });
    let reading: Promise<string> | undefined;
    let next: Response | undefined;
    try {
      const response = await f.managed.handle(f.first.request);
      reading = response.text();
      f.fixture.release();
      await f.outputEntered;
      f.abortExecution();
      next = await f.managed.handle(await f.nextRequest("run-2"));
      assertEquals(next.status, 503);
      assertEquals(f.prepareCalls, 1);
      assertEquals(f.brokerStarts, 1);
      assertEquals(f.managed.active, 1);
      f.releaseOutput();
      await reading;
      assertEquals(f.managed.active, 0);
    } finally {
      f.releaseOutput();
      f.fixture.release();
      await next?.body?.cancel();
      await f.managed.close();
      await reading;
    }
  });

  it("retains SSE admission until canonical finalization acknowledges its write", async () => {
    const f = await handler("sse", { waitForOutput: true });
    try {
      const response = await f.managed.handle(f.first.request);
      let finished = false;
      const body = response.text().then((value) => {
        finished = true;
        return value;
      });
      f.fixture.release();
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          f.outputEntered,
          new Promise((_, reject) => {
            deadline = setTimeout(() => reject(new Error("SSE did not finalize output")), 1000);
          }),
        ]);
      } finally {
        clearTimeout(deadline);
      }
      assertEquals(finished, false);
      assertEquals(f.managed.active, 1);
      f.releaseOutput();
      await body;
    } finally {
      f.releaseOutput();
      f.fixture.release();
      await f.managed.close();
    }
  });

  for (const abortSource of ["session", "request"] as const) {
    it(`refuses SSE success when ${abortSource} cancellation arrives during final persistence`, async () => {
      const controller = new AbortController();
      const f = await handler("sse", {
        waitForOutput: true,
        ...(abortSource === "request" ? { signal: controller.signal } : {}),
      });
      if (abortSource === "session") {
        Object.defineProperty(f.fixture.runtime, "signal", { value: controller.signal });
      }
      try {
        const response = await f.managed.handle(f.first.request);
        const body = response.text();
        f.fixture.release();
        await f.outputEntered;
        controller.abort(new Error("synthetic late cancellation"));
        f.releaseOutput();
        const wire = await body;
        assertEquals(wire.includes("event: RunFinished"), false);
        assertEquals(f.fixture.closeReasons, ["canceled"]);
      } finally {
        f.releaseOutput();
        f.fixture.release();
        await f.managed.close();
      }
    });
  }

  it("finalizes SSE executor errors as failures instead of completed runs", async () => {
    const f = await handler("sse", { terminalChunk: "coded-error" });
    try {
      const response = await f.managed.handle(f.first.request);
      f.fixture.release();
      await response.text();
      assertEquals(f.outputFinishes, [false]);
      assert(f.outputFinishErrors[0] instanceof ExecutorAgentError);
      assertEquals(f.outputFinishErrors[0].code, "INSUFFICIENT_CREDITS");
    } finally {
      f.fixture.release();
      await f.managed.close();
    }
  });

  for (const failure of ["writeFailure", "outputFailure"] as const) {
    it(`does not acknowledge SSE completion after ${failure} and retires the executor`, async () => {
      const f = await handler("sse", { [failure]: true });
      try {
        const response = await f.managed.handle(f.first.request);
        f.fixture.release();
        const parsed = await parseAgUiSseResponse(response);
        assertEquals(
          parsed.events.some((event) => event.type === agUiSseEventTypes.runFinished),
          false,
        );
        assert(parsed.events.some((event) => event.type === agUiSseEventTypes.runError));
        assertEquals(f.outputFinishes.length, 1);
      } finally {
        f.fixture.release();
        await f.managed.close();
      }
      assertEquals(f.fixture.closeReasons, ["canceled"]);
      assertEquals(f.cleanupCalls, 1);
    });
  }

  it("finalizes an SSE stream setup failure before retiring its canonical output", async () => {
    const f = await handler("sse", { streamOpenFailure: true });
    try {
      const response = await f.managed.handle(f.first.request);
      const parsed = await parseAgUiSseResponse(response);
      assert(parsed.events.some((event) => event.type === agUiSseEventTypes.runError));
      assertEquals(
        parsed.events.some((event) => event.type === agUiSseEventTypes.runFinished),
        false,
      );
      assertEquals(f.outputFinishes, [false]);
      assert(f.outputFinishErrors[0] instanceof Error);
    } finally {
      await f.managed.close();
    }
    assertEquals(f.cleanupCalls, 1);
  });

  it("privately binds approval to execution authority, run and cancellation", async () => {
    const first = await request(undefined, path, "run-1", "source-only-token");
    const fixture = runtimeFixture();
    const execution = new AbortController();
    let started: ManagedExecutorStartInput | undefined;
    const auth: string[] = [];
    const managed = createManagedBrokerHandler({
      responseMode: "detached",
      approvalApiBaseUrl: "https://approval.example.test",
      approvalFetch: ((_url, init) => {
        auth.push(new Headers(init?.headers).get("authorization") ?? "");
        return Promise.reject(new Error("synthetic approval transport"));
      }) as typeof fetch,
      broker: {
        start(input) {
          started = input;
          return Promise.resolve(fixture.runtime);
        },
      },
      resolveIngressOptions: () => ({
        publicKeyPem: first.publicKeyPem,
        audience: "demo-project",
        projectId,
        expectedSurface: "studio",
        boundSource: { type: "release", releaseId: "release-1" },
        expectedOwner: { scopeKind: "project", projectId },
        authorizeScope: () => ({ userId }),
      }),
      prepare: () =>
        Promise.resolve({
          start: managedStart({ agentId: "builder" }),
          messages: [],
          executionSignal: execution.signal,
          output: { write: () => Promise.resolve(), finish: () => Promise.resolve() },
        }),
    });
    try {
      const response = await managed.handle(first.request);
      assertEquals(response.status, 202, await response.clone().text());
      assert(started);
      const gate = getHostedToolApprovalCapability(started, "run-1");
      assert(gate);
      assertEquals(getHostedToolApprovalCapability(started, "other-run"), undefined);
      assertEquals(getHostedToolApprovalCapability({ runId: "run-1" }, "run-1"), undefined);
      assertEquals(JSON.stringify(started).includes("api-token"), false);
      assertEquals(JSON.stringify(started).includes("source-only-token"), false);
      const call = { toolName: "transfer", toolCallId: "call-1", input: {}, policy: {} };
      await assertRejects(() => gate(call));
      assertEquals(auth, ["Bearer api-token"]);
      const stream = new AbortController();
      stream.abort();
      assertThrows(() => gate(call, stream.signal));
      assertEquals(auth.length, 1);
      execution.abort();
      assertThrows(() => gate(call));
      assertEquals(auth.length, 1);
    } finally {
      fixture.release();
      await managed.close();
    }
  });

  it("binds signed broker authority to trusted managed hosted knowledge", async () => {
    const first = await request();
    const fixture = runtimeFixture();
    const execution = new AbortController();
    let started: ManagedExecutorStartInput | undefined;
    let preparedResolver: ManagedExecutorStartInput["model"]["resolver"] | undefined;
    const managed = createManagedBrokerHandler({
      responseMode: "detached",
      broker: {
        start: (input) => {
          started = input;
          return Promise.resolve(fixture.runtime);
        },
      },
      resolveIngressOptions: () => ({
        publicKeyPem: first.publicKeyPem,
        audience: "demo-project",
        projectId,
        expectedSurface: "studio",
        boundSource: { type: "release", releaseId: "release-1" },
        expectedOwner: { scopeKind: "project", projectId },
        authorizeScope: ({ apiAuthToken }) => {
          assertEquals(apiAuthToken, "api-token");
          return { userId };
        },
      }),
      prepare: ({ ingress }) => {
        assertEquals(JSON.stringify(ingress.executor).includes("api-token"), false);
        assertEquals(JSON.stringify(ingress.executor).includes("broker-token"), false);
        const start = managedStart({ agentId: "builder" });
        preparedResolver = start.model.resolver;
        start.trustedRuntime = {
          projectToolNames: [],
          sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
          hostedKnowledgeAuthToken: "prepared-foreign-token",
          hostedKnowledgeApiUrl: "https://attacker.example.test",
        };
        return Promise.resolve({
          start,
          messages: [],
          executionSignal: execution.signal,
          output: {
            write: () => Promise.resolve(),
            finish: () => Promise.resolve(),
          },
        });
      },
    });
    try {
      const response = await managed.handle(first.request);
      assertEquals(response.status, 202, await response.clone().text());
      assert(started);
      assert(started.model.resolver !== preparedResolver);
      assertEquals(started?.trustedRuntime?.hostedKnowledgeAuthToken, "api-token");
      assertEquals(
        started?.trustedRuntime?.hostedKnowledgeApiUrl,
        "https://api.veryfront.com",
      );
      assertEquals(
        JSON.stringify({
          installation: started?.installation,
          prepare: started?.prepare,
          session: started?.session,
        }).includes("api-token"),
        false,
      );
      const retainedResolver = started.model.resolver;
      execution.abort();
      assertThrows(
        () => retainedResolver("veryfront-cloud/mistral/mistral-small-2503"),
        TypeError,
        "Run-scoped inference credential is no longer active",
      );
    } finally {
      fixture.release();
      await managed.close();
    }
  });

  it("accepts encoded run IDs while verifying the original signed path", async () => {
    const encodedPath = "/api/control-plane/runs/%72un%2D1/stream";
    const f = await handler("detached", { requestPath: encodedPath });
    try {
      const response = await f.managed.handle(f.first.request);
      assertEquals(response.status, 202);
      assertEquals(f.brokerStarts, 1);
    } finally {
      f.fixture.release();
      await f.managed.close();
    }
    const canonical = await handler("detached");
    try {
      const original = canonical.first.request;
      const changedPath = new Request(`https://broker.test${encodedPath}`, {
        method: original.method,
        headers: original.headers,
        body: await original.text(),
      });
      const response = await canonical.managed.handle(changedPath);
      assertEquals(response.status, 401);
      assertEquals(await response.json(), { errorCode: "BROKER_INGRESS_AUTH_INVALID" });
      assertEquals(canonical.brokerStarts, 0);
    } finally {
      canonical.fixture.release();
      await canonical.managed.close();
    }
  });
  it("preserves typed executor failure statuses on both response modes", async () => {
    for (const mode of ["detached", "sse"] as const) {
      const f = await handler(mode, {
        failStart: true,
        startError: new ExecutorAgentError("INSUFFICIENT_CREDITS"),
      });
      const response = await f.managed.handle(f.first.request);
      assertEquals(response.status, 402);
      assertEquals(await response.json(), { errorCode: "INSUFFICIENT_CREDITS" });
      await f.managed.close();
    }
  });
  it("requires a durable output writer before allocating a detached run", async () => {
    const f = await handler("detached", { missingOutput: true });
    try {
      const response = await f.managed.handle(f.first.request);
      assertEquals(response.status, 500);
      assertEquals(f.brokerStarts, 0);
    } finally {
      f.fixture.release();
      await f.managed.close();
    }
  });

  it("persists detached output and retains retirement until the final write settles", async () => {
    const f = await handler("detached", { waitForOutput: true });
    try {
      assertEquals((await f.managed.handle(f.first.request)).status, 202);
      f.fixture.release();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      assertEquals(f.outputChunks, ["start"]);
      assertEquals(f.outputFinishes, [true]);
      assertEquals(f.fixture.closeReasons, []);
      assertEquals(f.managed.active, 1);
    } finally {
      f.releaseOutput();
      f.fixture.release();
      await f.managed.close();
    }
    assertEquals(f.cleanupCalls, 1);
  });
  it("preserves detached finish usage metadata for durable finalization", async () => {
    const f = await handler("detached", { finishWithUsage: true });
    assertEquals((await f.managed.handle(f.first.request)).status, 202);
    f.fixture.release();
    await f.managed.close();
    assertEquals(f.outputFinishMetadata, [{
      modelId: "veryfront-cloud/openai/synthetic",
      usage: { inputTokens: 12, outputTokens: 7 },
      usageCaptureStatus: "complete",
    }]);
  });
  it("transfers detached ownership before 202 and prevents duplicate allocation", async () => {
    const f = await handler("detached");
    const duplicateRequest = f.first.request.clone();
    const response = await f.managed.handle(f.first.request);
    assertEquals(response.status, 202);
    assertEquals(await response.json(), { accepted: true, duplicate: false });
    assertEquals(f.fixture.acceptKinds, ["execution"]);
    const duplicate = await f.managed.handle(duplicateRequest);
    assertEquals(await duplicate.json(), { accepted: true, duplicate: true });
    assertEquals(f.prepareCalls, 1);
    f.fixture.release();
    await f.managed.close();
    assertEquals(f.fixture.closeReasons, ["completed"]);
  });

  it("does not acknowledge a duplicate while the original run is still pending admission", async () => {
    const f = await handler("detached", { waitForPrepare: true, failStart: true });
    const duplicateRequest = f.first.request.clone();
    const original = f.managed.handle(f.first.request);
    await f.prepareEntered;

    const duplicate = await f.managed.handle(duplicateRequest);
    assertEquals(duplicate.status, 409);
    assertEquals(await duplicate.json(), { errorCode: "BROKER_RUN_PENDING" });
    assertEquals(f.prepareCalls, 1);

    f.releasePrepare();
    assertEquals((await original).status, 500);
    assertEquals(f.managed.active, 0);
    await f.managed.close();
  });

  it("marks ordinary error chunks and error finish reasons as failed durable output", async () => {
    for (const terminalChunk of ["error", "finish-error"] as const) {
      const f = await handler("detached", { terminalChunk });
      assertEquals((await f.managed.handle(f.first.request)).status, 202);
      f.fixture.release();
      await f.managed.close();

      assertEquals(f.outputFinishes, [false], terminalChunk);
      assertEquals(f.outputFinishErrors[0] instanceof Error, true, terminalChunk);
      assertEquals(f.outputChunks, [terminalChunk === "error" ? "error" : "finish"]);
      assertEquals(f.fixture.closeReasons, ["canceled"], terminalChunk);
    }
  });

  it("preserves a validated executor error chunk through durable terminal classification", async () => {
    const f = await handler("detached", { terminalChunk: "coded-error" });
    assertEquals((await f.managed.handle(f.first.request)).status, 202);
    f.fixture.release();
    await f.managed.close();

    assertEquals(resolveConversationHostedStreamErrorState(f.outputFinishErrors[0]), {
      status: "failed",
      terminalErrorCode: "INSUFFICIENT_CREDITS",
      terminalErrorMessage: "Insufficient AI credits",
    });
  });

  it("preserves EMPTY_RESPONSE through managed broker durable terminal classification", async () => {
    const f = await handler("detached", { terminalChunk: "empty-response-error" });
    assertEquals((await f.managed.handle(f.first.request)).status, 202);
    f.fixture.release();
    await f.managed.close();

    assertEquals(resolveConversationHostedStreamErrorState(f.outputFinishErrors[0]), {
      status: "failed",
      terminalErrorCode: "EMPTY_RESPONSE",
      terminalErrorMessage: "Assistant completed without producing a response",
    });
  });

  for (const mode of ["detached", "sse"] as const) {
    for (
      const failure of [
        "none",
        "native-pending",
        "stream",
        "flush",
        "cleanup",
        "reaper",
        "cancel",
        "terminal-error",
        "terminal-finish-error",
      ] as const
    ) {
      if (mode === "sse" && failure === "flush") continue;
      it(`settles managed ${mode} pause after retirement only with successful producer work (${failure})`, async () => {
        const f = await handler(mode, {
          streamFailure: failure === "stream",
          outputFailure: failure === "flush",
          cleanupFailure: failure === "cleanup",
          terminalChunk: failure === "terminal-error"
            ? "error"
            : failure === "terminal-finish-error"
            ? "finish-error"
            : undefined,
        });
        const controller = new AbortController();
        const sessionController = new AbortController();
        const originalClose = f.fixture.runtime.close.bind(f.fixture.runtime);
        f.fixture.runtime.close = (reason) => {
          sessionController.abort();
          return originalClose(reason);
        };
        let receipts = 0;
        const capability = createRunBoundAgentManualPause({
          apiUrl: "https://api.example.test",
          runId: "run-1",
          token: "synthetic-pause-token",
          signal: sessionController.signal,
          settlementSignal: controller.signal,
          fetch: (_url, init) => {
            assert(init && "body" in init, "fetch must receive request options");
            if (JSON.parse(String(init?.body)).settled) {
              receipts++;
              assertEquals(sessionController.signal.aborted, true);
              assertEquals(controller.signal.aborted, false);
              assertEquals(f.managed.active, 0);
              assertEquals(f.cleanupCalls, 1);
              assertEquals(f.fixture.closeReasons, ["completed"]);
            }
            return Promise.resolve(Response.json({ stop: true }));
          },
        });
        await capability.acknowledge({
          version: 1,
          nextStep: 1,
          messages: [],
          toolCalls: [],
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          latestAssistantText: "",
          completed: false,
          recoveredEmptyResponse: false,
          recoveredInterruptedLocalToolBatch: false,
        });
        if (failure !== "native-pending") capability.persisted?.(true);
        inheritHostedAgentPauseCapability(f.fixture.runtime, capability);
        if (failure === "reaper") {
          const close = f.fixture.runtime.close.bind(f.fixture.runtime);
          f.fixture.runtime.close = async (reason) => ({
            ...await close(reason),
            release: "reaper-required",
          });
        }
        const response = await f.managed.handle(f.first.request);
        assertEquals(response.status, mode === "sse" ? 200 : 202);
        if (failure === "cancel") {
          controller.abort();
          f.abortExecution();
        }
        f.fixture.release();
        if (mode === "sse") {
          await response.text().catch(() => {
            assertEquals(failure, "cleanup");
          });
        }
        await f.managed.close();
        assertEquals(receipts, failure === "none" ? 1 : 0);
      });
    }
  }
  for (const cancellationKind of ["body", "request"] as const) {
    it(`invalidates an SSE pause when ${cancellationKind} cancellation races completed cleanup`, async () => {
      const requestAbort = new AbortController();
      const f = await handler("sse", { signal: requestAbort.signal });
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const close = f.fixture.runtime.close.bind(f.fixture.runtime);
      f.fixture.runtime.close = async (reason) => {
        entered.resolve();
        await release.promise;
        return close(reason);
      };
      let receipts = 0;
      const capability = createRunBoundAgentManualPause({
        apiUrl: "https://api.example.test",
        runId: "run-1",
        token: "synthetic-pause-token",
        signal: new AbortController().signal,
        fetch: (_url, init) => {
          assert(init && "body" in init, "fetch must receive request options");
          if (JSON.parse(String(init?.body)).settled) receipts++;
          return Promise.resolve(Response.json({ stop: true }));
        },
      });
      await capability.acknowledge({
        version: 1,
        nextStep: 1,
        messages: [],
        toolCalls: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        latestAssistantText: "",
        completed: false,
        recoveredEmptyResponse: false,
        recoveredInterruptedLocalToolBatch: false,
      });
      capability.persisted?.(true);
      inheritHostedAgentPauseCapability(f.fixture.runtime, capability);
      const response = await f.managed.handle(f.first.request);
      const reader = response.body!.getReader();
      const reading = (async () => {
        while (!(await reader.read()).done) { /* Drain to the held cleanup. */ }
      })();
      f.fixture.release();
      await entered.promise;
      const cancellation = cancellationKind === "body"
        ? reader.cancel("client stopped reading")
        : Promise.resolve(requestAbort.abort());
      release.resolve();
      await Promise.all([reading, cancellation]);
      await f.managed.close();
      assertEquals(f.fixture.closeReasons, ["completed"]);
      assertEquals(f.cleanupCalls, 1);
      assertEquals(receipts, 0);
    });
  }
  for (const mode of ["detached", "sse"] as const) {
    it(`keeps ${mode} shutdown waiting for a post-retirement settlement receipt`, async () => {
      const f = await handler(mode);
      const entered = Promise.withResolvers<void>();
      const reply = Promise.withResolvers<Response>();
      const capability = createRunBoundAgentManualPause({
        apiUrl: "https://api.example.test",
        runId: "run-1",
        token: "synthetic-pause-token",
        signal: new AbortController().signal,
        fetch: (_url, init) => {
          assert(init && "body" in init, "fetch must receive request options");
          if (!JSON.parse(String(init?.body)).settled) {
            return Promise.resolve(Response.json({ stop: true }));
          }
          assertEquals(f.managed.active, 0);
          assertEquals(f.cleanupCalls, 1);
          entered.resolve();
          return reply.promise;
        },
      });
      await capability.acknowledge({
        version: 1,
        nextStep: 1,
        messages: [],
        toolCalls: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        latestAssistantText: "",
        completed: false,
        recoveredEmptyResponse: false,
        recoveredInterruptedLocalToolBatch: false,
      });
      capability.persisted?.(true);
      inheritHostedAgentPauseCapability(f.fixture.runtime, capability);
      const response = await f.managed.handle(f.first.request);
      assertEquals(response.status, mode === "sse" ? 200 : 202);
      const reading = mode === "sse" ? response.text() : Promise.resolve();
      f.fixture.release();
      let closed = false;
      const closing = f.managed.close().then(() => {
        closed = true;
      });
      await entered.promise;
      assertEquals(closed, false);
      reply.resolve(Response.json({ stop: true }));
      await Promise.all([closing, reading]);
      assertEquals(closed, true);
    });
  }
  it("keeps a committed pause nonterminal when stream cleanup fails", async () => {
    const f = await handler("detached", { streamFailure: true });
    const capability = createRunBoundAgentManualPause({
      apiUrl: "https://api.example.test",
      runId: "run-1",
      token: "synthetic-pause-token",
      signal: new AbortController().signal,
      fetch: () => Promise.resolve(Response.json({ stop: true })),
    });
    await capability.acknowledge({
      version: 1,
      nextStep: 1,
      messages: [],
      toolCalls: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      latestAssistantText: "",
      completed: false,
      recoveredEmptyResponse: false,
      recoveredInterruptedLocalToolBatch: false,
    });
    inheritHostedAgentPauseCapability(f.fixture.runtime, capability);
    try {
      const response = await f.managed.handle(f.first.request);
      assertEquals(response.status, 202);
      f.fixture.release();
      await f.managed.close();
      assertEquals(f.outputFinishes, [false]);
      assertEquals(f.outputPauses, [true]);
      assertEquals(f.outputFinishErrors, [undefined]);
      assertEquals(f.cleanupCalls, 1);
    } finally {
      f.fixture.release();
      await f.managed.close();
    }
  });

  it("finalizes an aborted detached execution as cancelled instead of failed", async () => {
    const f = await handler("detached");
    assertEquals((await f.managed.handle(f.first.request)).status, 202);
    f.abortExecution();
    f.fixture.release();
    await f.managed.close();

    assertEquals(f.outputFinishes, [false]);
    assertEquals(f.outputFinishErrors, [undefined]);
    assertEquals(f.fixture.closeReasons, ["canceled"]);
  });

  it("preserves request-owned SSE and releases only after response completion", async () => {
    const f = await handler("sse");
    const duplicateRequest = f.first.request.clone();
    const response = await f.managed.handle(f.first.request);
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assertEquals(f.fixture.acceptKinds, ["request"]);
    assertEquals(f.managed.active, 1);
    const duplicate = await f.managed.handle(duplicateRequest);
    assertEquals(duplicate.status, 409);
    assertEquals(f.prepareCalls, 1);
    f.fixture.release();
    await response.text();
    await f.managed.close();
    assertEquals(f.fixture.closeReasons, ["completed"]);
    assertEquals(f.managed.active, 0);
  });

  it("preserves finish usage metadata in the SSE RunFinished event", async () => {
    const f = await handler("sse", { finishWithUsage: true });
    const response = await f.managed.handle(f.first.request);
    f.fixture.release();
    const parsed = await parseAgUiSseResponse(response);
    await f.managed.close();
    const finished = parsed.events.find((event) => event.type === agUiSseEventTypes.runFinished);
    const metadata = finished?.metadata as Record<string, unknown> | undefined;

    assertEquals({
      inputTokens: metadata?.inputTokens,
      outputTokens: metadata?.outputTokens,
      totalTokens: metadata?.totalTokens,
      usageCaptureStatus: metadata?.usageCaptureStatus,
      finishReason: metadata?.finishReason,
    }, {
      inputTokens: 12,
      outputTokens: 7,
      totalTokens: 19,
      usageCaptureStatus: "complete",
      finishReason: "stop",
    });
  });

  it("releases failed setup reservations and maps the error without diagnostics", async () => {
    const f = await handler("detached", { failStart: true });
    const response = await f.managed.handle(f.first.request);
    assertEquals(response.status, 500);
    assertEquals(await response.json(), { errorCode: "BROKER_EXECUTION_SETUP_FAILED" });
    assertEquals(f.managed.active, 0);
    assertEquals(f.cleanupCalls, 1);
  });

  it("retains admitted setup failure and cleanup until actual session settlement", async () => {
    const f = await handler("detached", { failStart: true, admitBeforeFailure: true });
    const response = await f.managed.handle(f.first.request);
    assertEquals(response.status, 500);
    assertEquals(f.managed.active, 1);
    assertEquals(f.cleanupCalls, 0);
    f.admitted();
    await f.managed.close();
    assertEquals(f.cleanupCalls, 1);
    assertEquals(f.managed.active, 0);
  });

  it("does not admit a prepared run after handler closure during preparation", async () => {
    const f = await handler("detached", { waitForPrepare: true });
    const response = f.managed.handle(f.first.request);
    await f.prepareEntered;
    const closing = f.managed.close();
    assertEquals(f.prepareSignal?.aborted, true);
    f.releasePrepare();
    assertEquals((await response).status, 503);
    await closing;
    assertEquals(f.brokerStarts, 0);
    assertEquals(f.cleanupCalls, 1);
  });

  for (const mode of ["detached", "sse"] as const) {
    for (const source of ["shutdown", "service", "request"] as const) {
      it(`maps ${source} during abortable ${mode} preparation without a setup failure`, async () => {
        const controller = new AbortController();
        const f = await handler(mode, {
          signal: source === "request" ? controller.signal : undefined,
          serviceSignal: source === "service" ? controller.signal : undefined,
          abortPrepare: true,
        });
        const response = f.managed.handle(f.first.request);
        await f.prepareEntered;
        if (source === "shutdown") void f.managed.close();
        else controller.abort();
        try {
          const result = await response;
          assertEquals(result.status, source === "request" ? 499 : 503);
          assertEquals(await result.json(), {
            errorCode: source === "request" ? "BROKER_INGRESS_ABORTED" : "BROKER_UNAVAILABLE",
          });
          assertEquals(f.brokerStarts, 0);
          assertEquals(f.managed.active, 0);
        } finally {
          await f.managed.close();
        }
      });
    }
  }

  for (const mode of ["detached", "sse"] as const) {
    it(`maps service shutdown during ${mode} authorization to unavailable`, async () => {
      const controller = new AbortController();
      const f = await handler(mode, {
        serviceSignal: controller.signal,
        waitForAuthorization: true,
      });
      const response = f.managed.handle(f.first.request);
      await f.authorizationEntered;
      controller.abort();
      f.releaseAuthorization();
      try {
        const result = await response;
        assertEquals(result.status, 503);
        assertEquals(await result.json(), { errorCode: "BROKER_UNAVAILABLE" });
        assertEquals(f.prepareCalls, 0);
      } finally {
        await f.managed.close();
      }
    });

    it(`maps service shutdown during ${mode} body reading to unavailable`, async () => {
      const controller = new AbortController();
      const f = await handler(mode, { serviceSignal: controller.signal });
      const blockedBody = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(new TextEncoder().encode("{"));
        },
      });
      const pending = f.managed.handle(
        new Request(f.first.request.url, {
          method: "POST",
          headers: f.first.request.headers,
          body: blockedBody,
          duplex: "half",
        } as RequestInit),
      );
      controller.abort();
      try {
        const result = await pending;
        assertEquals(result.status, 503);
        assertEquals(await result.json(), { errorCode: "BROKER_UNAVAILABLE" });
        assertEquals(f.prepareCalls, 0);
      } finally {
        await f.managed.close();
      }
    });
  }

  it("accounts for stalled authentication during drain and refuses its late admission", async () => {
    const f = await handler("detached", { waitForAuthorization: true });
    const pending = f.managed.handle(f.first.request);
    await f.authorizationEntered;
    try {
      assertEquals(await f.managed.drain({ timeoutMs: 0 }), false);
      assertEquals(f.brokerStarts, 0);
      f.releaseAuthorization();
      assertEquals((await pending).status, 503);
      assertEquals(await f.managed.drain({ timeoutMs: 1000 }), true);
      assertEquals(f.prepareCalls, 0);
      assertEquals(f.brokerStarts, 0);
    } finally {
      f.releaseAuthorization();
      await pending;
      await f.managed.close();
    }
  });

  it("does not admit a late authorization result after handler closure", async () => {
    const f = await handler("detached", { waitForAuthorization: true });
    const response = f.managed.handle(f.first.request);
    await f.authorizationEntered;
    await f.managed.close();
    f.releaseAuthorization();
    assertEquals((await response).status, 503);
    assertEquals(f.prepareCalls, 0);
    assertEquals(f.brokerStarts, 0);
  });

  it("closes request-owned SSE as cancelled after request abort", async () => {
    const controller = new AbortController();
    const f = await handler("sse", { signal: controller.signal });
    const response = await f.managed.handle(f.first.request);
    controller.abort();
    f.fixture.release();
    await response.text();
    await f.managed.close();
    assertEquals(f.fixture.closeReasons, ["canceled"]);
  });

  it("cancels and retires request-owned SSE when the response body is canceled", async () => {
    const f = await handler("sse");
    const response = await f.managed.handle(f.first.request);
    let closing: Promise<void> | undefined;
    try {
      await response.body?.cancel("client stopped reading");
      closing = f.managed.close();
      const timeout = Promise.withResolvers<false>();
      const timeoutId = setTimeout(() => timeout.resolve(false), 25);
      const retired = await Promise.race([closing.then(() => true), timeout.promise]);
      clearTimeout(timeoutId);
      assertEquals(retired, true);
      assertEquals(f.fixture.closeReasons, ["canceled"]);
      assertEquals(f.managed.active, 0);
      assertEquals(f.cleanupCalls, 1);
      assertEquals(f.outputFinishes, [false]);
    } finally {
      f.fixture.release();
      await closing;
    }
  });

  it("shields throwing detached execution observers", async () => {
    const f = await handler("detached", { streamFailure: true, throwingObserver: true });
    const response = await f.managed.handle(f.first.request);
    assertEquals(response.status, 202);
    f.fixture.release();
    await f.managed.close();
    assertEquals(f.fixture.closeReasons, ["canceled"]);
  });
});
