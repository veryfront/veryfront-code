import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { clearModelProviders, type ModelRuntime, registerModelProvider } from "#veryfront/provider";
import {
  __resetVeryfrontCloudCatalogForTests,
  __setVeryfrontCloudCatalogForTests,
} from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import {
  getCurrentVeryfrontCloudContext,
  runWithVeryfrontCloudContext,
  type VeryfrontCloudContext,
} from "#veryfront/provider/veryfront-cloud/context.ts";
import { resolveRuntimeModel } from "../runtime/model-resolution.ts";
import { resolveAgentModelTransport } from "../runtime/model-transport.ts";
import {
  createDefaultHostedChatRuntime,
  createPreparedHostedRuntimeAgent,
  type DefaultHostedChatRuntimeTaskContext,
} from "./default-chat-runtime.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { sealIngressCredentials } from "#veryfront/security/http/ingress-credentials.ts";
import { parseHostedChatRequestFromRequest } from "./chat-request-parser.ts";
import { prepareHostedChatRuntimeCreationOptions } from "./chat-preparation.ts";
import { createHostedInferenceModelResolver } from "./inference-credential.ts";

const policy = { schemaVersion: 1, mode: "allowlist", integrations: {} } as const;
const cloud = {
  apiBaseUrl: "https://api.fixture.invalid",
  apiToken: "synthetic-invocation-token",
  projectSlug: "synthetic-project",
  serviceLayer: "cloud" as const,
};

function model(id: string): ModelRuntime {
  return {
    provider: "fixture",
    modelId: id,
    doGenerate: () => Promise.reject(new Error("No generation in route fixture")),
    doStream: () => Promise.reject(new Error("No streaming in route fixture")),
  };
}

function prepared(canonical: string, route: string) {
  return createPreparedHostedRuntimeAgent({
    options: {
      projectId: "synthetic-project",
      projectSlug: "synthetic-project",
      instructions: "Source-only route fixture",
      model: canonical,
      allowedTools: [],
    },
    taskContext: {
      projectId: "synthetic-project",
      branchId: null,
    },
    toolAssembly: {
      sourceIntegrationPolicy: policy,
      runtimeTools: {},
      remoteToolSources: [],
      localToolNames: [],
      remoteToolNames: [],
      providerToolNames: [],
      availableToolNames: [],
      toolLoadingMode: "eager",
      compatibleRemoteToolNames: [],
      systemInstructions: "Source-only route fixture",
    },
    modelId: canonical,
    runtimeModelId: route,
    sourceIntegrationPolicy: policy,
  }, {});
}

for (const canonical of ["qwen/qwen3-1.7b", "openai/gpt-fixture"]) {
  Deno.test(`prepared hosted route keeps ${canonical} on its private resolver without ambient credentials`, async () => {
    clearModelProviders();
    __setVeryfrontCloudCatalogForTests({
      models: [{
        id: canonical === "qwen/qwen3-1.7b" ? "qwen3-1.7b-local" : "gpt-fixture",
        modelId: canonical,
        provider: canonical.split("/")[0],
        surface: "openai",
        operations: ["chat-completions"],
        aliases: [],
      }],
      defaultModelId: canonical,
    });
    try {
      const route = runWithVeryfrontCloudContext(cloud, () => resolveRuntimeModel(canonical));
      assertEquals(route, `veryfront-cloud/${canonical}`);
      const agent = prepared(canonical, route);
      assertEquals(agent.config.model, route);
      assertEquals(getCurrentVeryfrontCloudContext()?.apiToken, undefined);
      const privateModel = model(canonical);
      const calls: string[] = [];
      const transport = await resolveAgentModelTransport({
        agentId: agent.id,
        config: agent.config,
        context: undefined,
        mode: "stream",
        modelOverride: undefined,
        resolveModelRuntime: (id) => {
          calls.push(id);
          if (id !== route) throw new Error("Private model is not granted");
          assertEquals(getCurrentVeryfrontCloudContext()?.apiToken, undefined);
          return privateModel;
        },
      });
      assertEquals(calls, [route]);
      assertStrictEquals(transport.languageModel, privateModel);
      await assertRejects(
        () =>
          resolveAgentModelTransport({
            agentId: agent.id,
            config: agent.config,
            context: undefined,
            mode: "stream",
            modelOverride: undefined,
            resolveModelRuntime: () => {
              throw new Error("Private model is not granted");
            },
          }),
        Error,
        "Private model is not granted",
      );
    } finally {
      clearModelProviders();
      __resetVeryfrontCloudCatalogForTests();
    }
  });
}

Deno.test("trusted hosted route preserves an application-owned direct provider", async () => {
  clearModelProviders();
  const direct = model("application/model");
  registerModelProvider("application", () => {
    assertEquals(getCurrentVeryfrontCloudContext()?.apiToken, undefined);
    return direct;
  });
  try {
    const route = runWithVeryfrontCloudContext(
      cloud,
      () => resolveRuntimeModel("application/model"),
    );
    assertEquals(route, "application/model");
    const agent = prepared("application/model", route);
    const transport = await resolveAgentModelTransport({
      agentId: agent.id,
      config: agent.config,
      context: undefined,
      mode: "stream",
      modelOverride: undefined,
      resolveModelRuntime: () => {
        throw new Error("Direct provider reached private gateway resolver");
      },
    });
    assertStrictEquals(transport.languageModel, direct);
  } finally {
    clearModelProviders();
  }
});

Deno.test("sealed managed ingress preserves private inference authority and canonical default identity", async () => {
  const canonical = "qwen/qwen3-1.7b";
  clearModelProviders();
  __setVeryfrontCloudCatalogForTests({
    models: [{
      id: "qwen3-1.7b-local",
      modelId: canonical,
      provider: "qwen",
      surface: "openai",
      operations: ["chat-completions"],
    }],
    defaultModelId: canonical,
  });
  let task: DefaultHostedChatRuntimeTaskContext | undefined;
  try {
    const callback = "synthetic-callback-token";
    const inference = "synthetic-inference-token";
    const projectId = "10000000-1000-4000-8000-100000000005";
    const request = sealIngressCredentials(
      new Request("https://agent.fixture.invalid/api/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${callback}`,
          "X-Veryfront-Run-Event-Token": "synthetic-event-token",
          "X-Veryfront-Inference-Token": inference,
        },
        body: JSON.stringify({
          model: canonical,
          messages: [{
            id: "message-fixture",
            role: "user",
            parts: [{ type: "text", text: "Source-only fixture" }],
          }],
          context: {
            projectId,
            conversationId: "10000000-1000-4000-8000-100000000001",
            branchId: null,
          },
          durableRootRun: {
            runId: "run_fixture",
            messageId: "10000000-1000-4000-8000-100000000002",
          },
        }),
      }),
    );
    const parsed = await parseHostedChatRequestFromRequest(request, {
      authenticate: () =>
        Promise.resolve({ userId: "10000000-1000-4000-8000-100000000003", authToken: callback }),
      verifyProjectAccess: () => Promise.resolve({ success: true as const }),
      verifyRunEventAppendToken: () => Promise.resolve(true),
    });
    if (parsed instanceof Response) throw new Error("Synthetic managed ingress refused");
    assertEquals(parsed.authToken, callback);
    assertEquals(JSON.stringify(parsed).includes(inference), false);
    assertEquals(request.headers.get("X-Veryfront-Inference-Token"), null);
    const privateResolver = createHostedInferenceModelResolver(parsed, {
      apiBaseUrl: cloud.apiBaseUrl,
    });
    assertEquals(typeof privateResolver, "function");
    const preparation = await prepareHostedChatRuntimeCreationOptions({
      request: parsed,
      agentConfig: {
        id: "fixture-agent",
        name: "Fixture",
        description: "Synthetic source fixture",
        instructions: "Source-only fixture",
        model: canonical,
        tools: [],
      },
      projectId,
      authToken: parsed.authToken,
      branchId: null,
      fetchSteering: () => Promise.resolve({ instructions: "Source-only fixture", skills: [] }),
      buildInstructions: () => "Source-only fixture",
      resolveModelId: (id) =>
        runWithVeryfrontCloudContext(
          { ...cloud, apiToken: callback },
          () => resolveRuntimeModel(id),
        ),
    });
    assertEquals(preparation.creationOptions.authToken, callback);
    let preparationContext: VeryfrontCloudContext | undefined;
    const options = { ...preparation.creationOptions, model: canonical, allowedTools: [] };
    Object.defineProperty(options, "model", {
      enumerable: true,
      get() {
        // Observe the real trusted preparation scope, then model a later boundary
        // that removes only its ambient callback credential. No real token exists.
        preparationContext ??= getCurrentVeryfrontCloudContext();
        return canonical;
      },
    });
    const runtime = await withMockFetch(
      () => Promise.reject(new Error("Unexpected fixture request")),
      () =>
        createDefaultHostedChatRuntime({
          sourceIntegrationPolicy: policy,
          options,
          config: { apiUrl: cloud.apiBaseUrl, apiMcpUrl: cloud.apiBaseUrl + "/mcp" },
          buildLocalTools: (context) => {
            task = context;
            return {};
          },
          createRemoteToolSource: () => ({
            id: "synthetic-source",
            listTools: () => Promise.resolve([]),
            executeTool: () => Promise.reject(new Error("Unexpected fixture tool execution")),
          }),
          preloadLatestConversationUserText: false,
        }, { resolveModelRuntime: privateResolver }),
    );
    assertEquals(runtime.modelId, canonical);
    assertEquals(task?.model, canonical);
    assertEquals(JSON.stringify(preparation.creationOptions).includes(inference), false);
    if (!preparationContext) throw new Error("Trusted default preparation was not observed");
    preparationContext.apiToken = undefined;
    let inferenceHeader: string | null = null;
    let inferenceCalls = 0;
    await withMockFetch(
      (_url, init) => {
        inferenceCalls++;
        inferenceHeader = new Headers(init?.headers).get("Authorization");
        const chunks = [
          {
            id: "source-fixture",
            object: "chat.completion.chunk",
            model: canonical,
            choices: [{
              index: 0,
              delta: { role: "assistant", content: "Source-only fixture" },
              finish_reason: null,
            }],
          },
          {
            id: "source-fixture",
            object: "chat.completion.chunk",
            model: canonical,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          },
        ];
        return Promise.resolve(
          new Response(
            chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
              "data: [DONE]\n\n",
            {
              headers: { "content-type": "text/event-stream" },
            },
          ),
        );
      },
      async () => {
        const result = await runtime.agent.stream({
          messages: [],
          abortSignal: new AbortController().signal,
        });
        for await (const chunk of result.toUIMessageStream()) {
          assertEquals(chunk.type === "error", false);
        }
      },
    );
    assertEquals(inferenceCalls, 1);
    assertEquals(inferenceHeader, `Bearer ${inference}`);
    assertEquals(inferenceHeader === `Bearer ${callback}`, false);
    await runtime.cleanup?.();
  } finally {
    clearModelProviders();
    __resetVeryfrontCloudCatalogForTests();
  }
});
