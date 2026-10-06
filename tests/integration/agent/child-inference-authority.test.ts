import { getEventListeners } from "node:events";
import {
  runAgentRuntimeForkStep,
  type RunAgentRuntimeForkStepInput,
} from "#veryfront/agent/streaming/fork-runtime-stream.ts";
import { resolveVeryfrontCloudModelId } from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { runWithHostedRequestPreparationSignal } from "#veryfront/agent/service/request-preparation-context.ts";
import { createAgentRuntime } from "#veryfront/agent/hosted/cloud-agent-chat-execution.ts";
import type { NodeVeryfrontCloudAgentServiceContext } from "#veryfront/agent/hosted/cloud-agent-config.ts";
import { createDefaultHostedChatRuntime } from "#veryfront/agent/hosted/default-chat-runtime.ts";
import { createDefaultHostedInvokeAgentTool } from "#veryfront/agent/hosted/default-invoke-agent-tool.ts";
import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { useServedCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.test-helpers.ts";
import { clearModelProviders, type ModelRuntime } from "#veryfront/provider";
import { startHostedChildForkRuntimeWithHostTools } from "#veryfront/agent/hosted/child-fork-runtime-start.ts";
import {
  bindHostedChildInferenceAuthority,
  createHostedChildInferenceModelResolver,
  createHostedInferenceModelResolver,
  createHostedRuntimeWithChildInferenceAuthority,
  type HostedInferenceAuthorityOwner,
  inheritHostedChildInferenceAuthority,
  registerHostedInferenceCredential,
  scopeHostedChildInferenceAuthority,
} from "#veryfront/agent/hosted/inference-credential.ts";
import type { ParsedHostedChatRequest } from "#veryfront/agent/hosted/chat-request-parser.ts";

it("a default hosted child uses verified inference authority instead of its API execution credential", async () => {
  using _catalog = useServedCatalogForTests();
  const request = { authToken: "test-execution-authority" } as ParsedHostedChatRequest;
  registerHostedInferenceCredential(request, "test-inference-authority");
  const observed: string[] = [];
  const resolver = createHostedInferenceModelResolver(request, {
    apiBaseUrl: "https://api.veryfront.com",
  });
  assertExists(resolver);
  await withMockFetch(async (input, init) => {
    const outgoing = new Request(input, init);
    const credential = outgoing.headers.get("authorization") ?? "";
    observed.push(credential);
    if (credential !== "Bearer test-inference-authority") {
      return new Response(
        JSON.stringify({ error: { message: "Execution credentials cannot authorize inference" } }),
        { status: 403, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      'data: {"choices":[{"delta":{"content":"Child completed."},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { headers: { "content-type": "text/event-stream" } },
    );
  }, async () => {
    // The verified request can already authorize root inference.
    const rootModel = resolver("veryfront-cloud/mistral/mistral-small-2503");
    assertExists(rootModel);
    const root = await rootModel.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "Root probe" }] }],
    });
    for await (const _ of root.stream) { /* consume first-party root response */ }
    const childInput = {
      apiUrl: "https://api.veryfront.com",
      authToken: request.authToken,
      projectId: null,
      provider: "mistral",
      forkModel: "mistral/mistral-small-2503",
      hostedModel: true,
      maxSteps: 1,
      prompt: "Finish this delegated request.",
      forkTools: {},
      buildInstructions: () => "Be concise.",
    };
    const revoke = bindHostedChildInferenceAuthority(childInput, request, {
      apiBaseUrl: "https://api.veryfront.com",
    });
    const child = startHostedChildForkRuntimeWithHostTools(childInput);
    const parts = [];
    for await (const part of child.streamResult.fullStream) parts.push(part);
    const steps = await child.streamResult.steps;
    revoke();
    assertEquals(steps[0]?.text, "Child completed.");
    assertEquals(
      observed.every((credential) => credential === "Bearer test-inference-authority"),
      true,
    );
  });
  clearModelProviders();
});

it("root runtime assembly carries private inference authority through the default invoke tool and retires descendants", async () => {
  using _catalog = useServedCatalogForTests();
  const request = { authToken: "test-execution-authority" } as ParsedHostedChatRequest;
  registerHostedInferenceCredential(request, "test-inference-authority");
  const options = {
    projectId: "project-1",
    authToken: request.authToken,
    instructions: "Delegate one bounded task.",
    model: "mistral/mistral-small-2503",
    allowedTools: ["invoke_agent"],
  };
  let controlPlaneCalls = 0;
  let invoke: ReturnType<typeof createDefaultHostedInvokeAgentTool> | undefined;
  let retainedContext: HostedInferenceAuthorityOwner | undefined;
  await withMockFetch(async (input, init) => {
    const outgoing = new Request(input, init);
    if (new URL(outgoing.url).pathname.endsWith("/mcp")) {
      controlPlaneCalls++;
      assertEquals(outgoing.headers.get("authorization"), "Bearer test-execution-authority");
      const rpc = await outgoing.json();
      if (rpc.id === undefined) return new Response(null, { status: 202 });
      const result = rpc.method === "initialize"
        ? {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "test-mcp", version: "1" },
        }
        : { tools: [] };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (outgoing.headers.get("authorization") !== "Bearer test-inference-authority") {
      return new Response(
        '{"error":{"message":"Execution credentials cannot authorize inference"}}',
        { status: 403, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      'data: {"choices":[{"delta":{"content":"Child completed."},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { headers: { "content-type": "text/event-stream" } },
    );
  }, async () => {
    const runtime = await createHostedRuntimeWithChildInferenceAuthority(options, request, {
      apiBaseUrl: "https://api.veryfront.com",
    }, () =>
      createDefaultHostedChatRuntime({
        sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
        options,
        config: { apiUrl: "https://api.veryfront.com", apiMcpUrl: "https://api.veryfront.com/mcp" },
        preloadLatestConversationUserText: false,
        buildLocalTools: (taskContext) => {
          invoke = createDefaultHostedInvokeAgentTool({
            context: taskContext,
            getConfig: () => ({
              apiUrl: "https://api.veryfront.com",
              apiMcpUrl: "https://api.veryfront.com/mcp",
              enableDurableInvokeAgent: false,
            }),
            hostedModel: true,
            resolveModelId: resolveVeryfrontCloudModelId,
            resolveProvider: () => "mistral",
            createBashTool: () => Promise.resolve({ tools: {} }),
            createAgentServiceSandboxTools: () =>
              Promise.resolve({
                tools: {},
                sandbox: {} as never,
                closeSandbox: () => Promise.resolve(),
              }),
            createLiveStudioTools: () =>
              Promise.resolve({ tools: {}, close: () => Promise.resolve() }),
            buildGlobalTools: (childContext) => {
              retainedContext = childContext;
              return {};
            },
            logger: { debug() {}, info() {}, warn() {}, error() {} },
            trace: (_name, operation) => operation(),
            setTraceAttributes() {},
          });
          return { invoke_agent: invoke };
        },
      }));
    assertExists(invoke);
    const result = await invoke.execute({
      agent_id: "test-child",
      prompt: "Complete the bounded request.",
      description: "Bounded child",
      context: {},
      max_steps: 1,
    }, { toolCallId: "child-call" });
    if (!("success" in result) || !result.success) {
      throw new Error("error" in result ? result.error : "Unexpected durable result");
    }
    assertEquals(result.success, true);
    assertEquals(result.summary.text, "Child completed.");
    assertEquals(controlPlaneCalls > 0, true);
    assertExists(retainedContext);
    // Immediate child retirement invalidates its nested tools while the root is still live.
    assertThrows(
      () => createHostedChildInferenceModelResolver(retainedContext!),
      TypeError,
      "Hosted child inference authority is no longer active",
    );
    await runtime.cleanup();
    assertThrows(
      () => createHostedChildInferenceModelResolver(options),
      TypeError,
      "Hosted parent inference authority is no longer active",
    );
  });
  clearModelProviders();
});

it("parent abort and cleanup revoke retained child models without exposing credentials", async () => {
  const request = { authToken: "test-execution-authority" } as ParsedHostedChatRequest;
  registerHostedInferenceCredential(request, "test-inference-authority");
  const controller = new AbortController();
  const owner = {};
  const child = {};
  const revoke = bindHostedChildInferenceAuthority(owner, request, {
    apiBaseUrl: "https://api.veryfront.com",
    signal: controller.signal,
  });
  inheritHostedChildInferenceAuthority(child, owner);
  const resolver = createHostedChildInferenceModelResolver(child);
  assertExists(resolver);
  const model = resolver("veryfront-cloud/mistral/mistral-small-2503");
  assertExists(model);
  const originalAdd = EventTarget.prototype.addEventListener;
  const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!;
  try {
    EventTarget.prototype.addEventListener = () => {};
    Object.defineProperty(AbortSignal.prototype, "aborted", {
      configurable: true,
      get: () => false,
    });
    controller.abort();
    assertThrows(
      () => createHostedChildInferenceModelResolver(child),
      TypeError,
      "Hosted parent inference authority is no longer active",
    );
    await assertRejects(
      async () => await model!.doStream({ prompt: [] }),
      TypeError,
      "Hosted parent inference authority is no longer active",
    );
  } finally {
    EventTarget.prototype.addEventListener = originalAdd;
    Object.defineProperty(AbortSignal.prototype, "aborted", aborted);
    revoke();
  }
  assertEquals(Object.keys(owner), []);
  assertEquals(Object.keys(child), []);
});

it("runtime creation rejects retire verified child authority even before a runtime exists", async () => {
  const request = { authToken: "test-execution-authority" } as ParsedHostedChatRequest;
  registerHostedInferenceCredential(request, "test-inference-authority");
  const options = {};
  let retained: ReturnType<typeof createHostedChildInferenceModelResolver>;
  let model: ModelRuntime | undefined;
  await assertRejects(
    () =>
      createHostedRuntimeWithChildInferenceAuthority(options, request, {
        apiBaseUrl: "https://api.veryfront.com",
      }, () => {
        retained = createHostedChildInferenceModelResolver(options);
        model = retained?.("veryfront-cloud/mistral/mistral-small-2503");
        throw new Error("Runtime catalog preparation failed");
      }),
    Error,
    "Runtime catalog preparation failed",
  );
  assertExists(retained!);
  assertThrows(
    () => createHostedChildInferenceModelResolver(options),
    TypeError,
    "Hosted parent inference authority is no longer active",
  );
  assertExists(model);
  await assertRejects(
    async () => await model!.doStream({ prompt: [] }),
    TypeError,
    "Hosted parent inference authority is no longer active",
  );
});

it("the cloud runtime entry binds verified authority and retires it on pre-runtime model preparation rejection", async () => {
  using _catalog = useServedCatalogForTests();
  const request = { authToken: "test-execution-authority" } as ParsedHostedChatRequest;
  registerHostedInferenceCredential(request, "test-inference-authority");
  let retainedModel: ModelRuntime | undefined;
  const options = {
    projectId: "project-1",
    authToken: request.authToken,
    instructions: "Be concise.",
    allowedTools: [],
    allowDelegation: false,
    get model(): string {
      const resolver = createHostedChildInferenceModelResolver(options);
      assertExists(resolver);
      retainedModel = resolver("veryfront-cloud/mistral/mistral-small-2503");
      throw new Error("Model preparation rejected");
    },
  };
  const context = {
    options: {},
    infrastructure: {
      getConfig: () => ({
        VERYFRONT_API_URL: "https://api.veryfront.com",
        VERYFRONT_MCP_URL: "https://api.veryfront.com/mcp",
      }),
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    },
    discoveryResult: {
      agents: new Map(),
      tools: new Map(),
      sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
    },
  } as unknown as NodeVeryfrontCloudAgentServiceContext;
  await assertRejects(
    () => createAgentRuntime(context, options, undefined, request),
    Error,
    "Model preparation rejected",
  );
  assertExists(retainedModel);
  assertThrows(
    () => createHostedChildInferenceModelResolver(options),
    TypeError,
    "Hosted parent inference authority is no longer active",
  );
  await assertRejects(
    async () => await retainedModel!.doStream({ prompt: [] }),
    TypeError,
    "Hosted parent inference authority is no longer active",
  );
});

it("actual child cancellation revokes its descendants while sibling authority remains active", async () => {
  const request = { authToken: "test-execution-authority" } as ParsedHostedChatRequest;
  registerHostedInferenceCredential(request, "test-inference-authority");
  const root = {};
  const revokeRoot = bindHostedChildInferenceAuthority(root, request, {
    apiBaseUrl: "https://api.veryfront.com",
  });
  const child = {};
  const controller = new AbortController();
  const retireChild = scopeHostedChildInferenceAuthority(child, root, controller.signal);
  const resolver = createHostedChildInferenceModelResolver(child);
  assertExists(resolver);
  const retained = resolver("veryfront-cloud/mistral/mistral-small-2503");
  assertExists(retained);
  controller.abort();
  assertThrows(
    () => createHostedChildInferenceModelResolver(child),
    TypeError,
    "Hosted child inference authority is no longer active",
  );
  await assertRejects(
    async () => await retained.doStream({ prompt: [] }),
    TypeError,
    "Hosted child inference authority is no longer active",
  );
  assertExists(createHostedChildInferenceModelResolver(root));
  retireChild();
  revokeRoot();
});

it("cloud root authority survives the ended preparation request and expires on execution cleanup", async () => {
  using _catalog = useServedCatalogForTests();
  const request = { authToken: "test-execution-authority" } as ParsedHostedChatRequest;
  registerHostedInferenceCredential(request, "test-inference-authority");
  const options = {
    projectId: null,
    authToken: request.authToken,
    instructions: "Be concise.",
    model: "mistral/mistral-small-2503",
    allowedTools: [],
    allowDelegation: false,
    agentId: "root-agent",
  };
  const inbound = new AbortController();
  const context = {
    options: { mcpServers: [] },
    defaultAgentId: "root-agent",
    infrastructure: {
      getConfig: () => ({
        VERYFRONT_API_URL: "https://api.veryfront.com",
        VERYFRONT_MCP_URL: "https://api.veryfront.com/mcp",
      }),
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      tracer: {
        trace: (_name: string, operation: () => unknown) => operation(),
        scope: () => ({ active: () => undefined }),
      },
      setActiveSpanAttributes() {},
    },
    discoveryResult: {
      agents: new Map(),
      tools: new Map(),
      sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
    },
    projectSteeringByAgentId: new Map([["root-agent", {
      createLoadSkillTool: () => ({
        description: "Load a skill",
        inputSchema: {},
        execute: () => ({}),
      }),
    }]]),
    trace: (_name: string, operation: () => unknown) => operation(),
  } as unknown as NodeVeryfrontCloudAgentServiceContext;
  const runtime = await runWithHostedRequestPreparationSignal(
    inbound.signal,
    () => createAgentRuntime(context, options, undefined, request),
  );
  inbound.abort();
  const childInput = {
    apiUrl: "https://api.veryfront.com",
    authToken: request.authToken,
    projectId: null,
    provider: "mistral",
    forkModel: "mistral/mistral-small-2503",
    hostedModel: true,
    maxSteps: 1,
    prompt: "Complete the delegated request.",
    forkTools: {},
    buildInstructions: () => "Be concise.",
  };
  inheritHostedChildInferenceAuthority(childInput, options);
  const retainedResolver = createHostedChildInferenceModelResolver(childInput);
  assertExists(retainedResolver);
  const retainedModel = retainedResolver("veryfront-cloud/mistral/mistral-small-2503");
  assertExists(retainedModel);
  await withMockFetch(async (input, init) => {
    assertEquals(
      new Request(input, init).headers.get("authorization"),
      "Bearer test-inference-authority",
    );
    return new Response(
      'data: {"choices":[{"delta":{"content":"Child completed."},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      { headers: { "content-type": "text/event-stream" } },
    );
  }, async () => {
    const child = startHostedChildForkRuntimeWithHostTools(childInput);
    for await (const _ of child.streamResult.fullStream) { /* consume actual default child */ }
    const steps = await child.streamResult.steps;
    assertEquals(steps[0]?.text, "Child completed.");
  });
  await runtime.cleanup();
  assertThrows(
    () => createHostedChildInferenceModelResolver(childInput),
    TypeError,
    "Hosted parent inference authority is no longer active",
  );
  await assertRejects(
    async () => await retainedModel.doStream({ prompt: [] }),
    TypeError,
    "Hosted parent inference authority is no longer active",
  );
  clearModelProviders();
});

it("a rejected revoked fork step leaves no abort listener on a live signal", async () => {
  const request = { authToken: "test-execution-authority" } as ParsedHostedChatRequest;
  registerHostedInferenceCredential(request, "test-inference-authority");
  const controller = new AbortController();
  const input: RunAgentRuntimeForkStepInput = {
    apiUrl: "https://api.veryfront.com",
    authToken: request.authToken,
    projectId: null,
    model: "mistral/mistral-small-2503",
    messages: [],
    system: "Be concise.",
    forkToolNames: [],
    runtimeTools: {},
    abortSignal: controller.signal,
  };
  const revoke = bindHostedChildInferenceAuthority(input, request, {
    apiBaseUrl: "https://api.veryfront.com",
  });
  revoke();
  const before = getEventListeners(controller.signal, "abort").length;
  try {
    await assertRejects(
      () => runAgentRuntimeForkStep(input),
      TypeError,
      "Hosted parent inference authority is no longer active",
    );
    assertEquals(getEventListeners(controller.signal, "abort").length, before);
  } finally {
    controller.abort();
  }
});

it("an already aborted fork preserves the cancellation reason even after authority retirement", async () => {
  const controller = new AbortController();
  const reason = new Error("Child cancelled before startup");
  controller.abort(reason);
  const input: RunAgentRuntimeForkStepInput = {
    apiUrl: "https://api.veryfront.com",
    authToken: "test-execution-authority",
    projectId: null,
    model: "mistral/mistral-small-2503",
    messages: [],
    system: "Be concise.",
    forkToolNames: [],
    runtimeTools: {},
    abortSignal: controller.signal,
  };
  const request = { authToken: input.authToken } as ParsedHostedChatRequest;
  registerHostedInferenceCredential(request, "test-inference-authority");
  bindHostedChildInferenceAuthority(input, request, { apiBaseUrl: "https://api.veryfront.com" })();
  const result = await runAgentRuntimeForkStep(input);
  const responseFailure = await assertRejects(
    async () => await result.responsePromise,
    Error,
    reason.message,
  );
  const streamFailure = await assertRejects(
    () => result.stream.getReader().read(),
    Error,
    reason.message,
  );
  assertEquals(responseFailure, reason);
  assertEquals(streamFailure, reason);
  assertEquals(getEventListeners(controller.signal, "abort").length, 0);
});

it("a fork configuration failure leaves no abort listener on its live signal", async () => {
  const controller = new AbortController();
  const input: RunAgentRuntimeForkStepInput = {
    apiUrl: "https://api.veryfront.com",
    authToken: "test-execution-authority",
    projectId: null,
    model: "mistral/mistral-small-2503",
    messages: [],
    get system(): string {
      throw new Error("Fork configuration failed");
    },
    forkToolNames: [],
    runtimeTools: {},
    abortSignal: controller.signal,
  };
  await assertRejects(() => runAgentRuntimeForkStep(input), Error, "Fork configuration failed");
  assertEquals(getEventListeners(controller.signal, "abort").length, 0);
});

it("cancellation during fork configuration preserves its reason and releases the listener", async () => {
  const controller = new AbortController();
  const reason = new Error("Child cancelled during startup");
  const input: RunAgentRuntimeForkStepInput = {
    apiUrl: "https://api.veryfront.com",
    authToken: "test-execution-authority",
    projectId: null,
    model: "mistral/mistral-small-2503",
    messages: [],
    get system(): string {
      controller.abort(reason);
      return "Be concise.";
    },
    forkToolNames: [],
    runtimeTools: {},
    abortSignal: controller.signal,
  };
  const error = await assertRejects(() => runAgentRuntimeForkStep(input), Error, reason.message);
  assertEquals(error, reason);
  assertEquals(getEventListeners(controller.signal, "abort").length, 0);
});
