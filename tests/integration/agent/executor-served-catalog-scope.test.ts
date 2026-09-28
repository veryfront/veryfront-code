import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { loadVeryfrontCloudModelCatalog } from "#veryfront/provider";
import { runWithVeryfrontCloudContext } from "#veryfront/provider/veryfront-cloud/context.ts";
import { __resetVeryfrontCloudCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import { resolveVeryfrontCloudModelThinking } from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { createVeryfrontCloudInferenceModel } from "#veryfront/provider/veryfront-cloud/provider.ts";
import {
  createExecutorChannel,
  type ExecutorOperation,
} from "#veryfront/agent/executor/channel.ts";
import { createExecutorModelBroker } from "#veryfront/agent/hosted/executor-model-bridge.ts";
import { createExecutorRuntimeFacades } from "#veryfront/agent/hosted/executor-runtime-facades.ts";
import type { ExecutorRuntimeInstall } from "#veryfront/agent/hosted/executor-runtime-install-schema.ts";
import { createRunScopedVeryfrontCloudContextSummaryGenerator } from "#veryfront/agent/hosted/context-summary-generator.ts";
import { createVeryfrontCloudInferenceModelResolver } from "#veryfront/agent/hosted/inference-credential.ts";
import {
  registerModelRuntimeResolverRevoker,
  revokeModelRuntimeResolver,
} from "#veryfront/agent/runtime/model-transport.ts";

const summaryInput = {
  messagesToSummarize: [{
    id: "message-1",
    role: "user" as const,
    timestamp: 1,
    parts: [{ type: "text" as const, text: "Summarize this context." }],
  }],
  retainedMessages: [],
};

/**
 * The trusted in-broker runtime runs in a process that may hold a host
 * credential. The catalog the broker hands over for a run must still win over
 * the catalog loaded for that ambient host credential.
 */

const HOST_TOKEN = "vf_host_token";
const RUN_TOKEN = "vf_run_scoped_token";
const MODEL_ID = "veryfront-cloud/anthropic/claude-sonnet-4-6";
const binding = {
  allocationId: "scope-allocation",
  invocationId: "scope-invocation",
  generation: 1,
};

/** Each credential's catalog carries its own thinking budget for the same model. */
function installCatalogs(): string[] {
  const authorizations: string[] = [];
  installMockFetch(
    ((input: URL | Request | string, init?: RequestInit) => {
      const request = new Request(input, init);
      const authorization = request.headers.get("authorization") ?? "";
      authorizations.push(authorization);
      if (new URL(request.url).pathname !== "/ai/models") {
        return Promise.resolve(new Response("unexpected", { status: 500 }));
      }
      const budget = authorization === `Bearer ${RUN_TOKEN}`
        ? 1024
        : authorization === `Bearer ${HOST_TOKEN}`
        ? 4096
        : undefined;
      return Promise.resolve(Response.json({
        models: budget === undefined ? [] : [{
          id: "claude-sonnet-4-6",
          modelId: "anthropic/claude-sonnet-4-6",
          provider: "anthropic",
          surface: "anthropic",
          operations: ["messages"],
          aliases: [],
          capabilities: {
            thinking: true,
            reasoning_mode: "budget",
            reasoning_budget_tokens: budget,
          },
        }],
      }));
    }) as typeof fetch,
  );
  return authorizations;
}

function installation(): ExecutorRuntimeInstall {
  return {
    version: 1,
    binding,
    root: "project",
    owner: { scopeKind: "global", serviceName: "veryfront-agent" },
    source: { type: "release", releaseId: "release-1" },
    grant: {
      agentId: "coder",
      defaultModelId: MODEL_ID,
      maxSteps: 3,
      models: [{ id: MODEL_ID, maxOutputTokens: 8192, providerToolNames: [] }],
      allowedToolNames: [],
      hostToolFacadeIds: [],
      remoteToolSourceIds: [],
      execution: { kind: "ephemeral", projectId: null },
    },
    capabilities: { persistence: {} },
  };
}

describe("executor served catalog scope in a process holding a host credential", () => {
  beforeEach(() => __resetVeryfrontCloudCatalogForTests());
  afterEach(() => {
    restoreMockFetch();
    __resetVeryfrontCloudCatalogForTests();
    deleteEnv("VERYFRONT_API_TOKEN");
    deleteEnv("VERYFRONT_PROJECT_SLUG");
  });

  it("reads the run's handed-over catalog, not the host credential's catalog", async () => {
    const authorizations = installCatalogs();
    setEnv("VERYFRONT_API_TOKEN", HOST_TOKEN);
    setEnv("VERYFRONT_PROJECT_SLUG", "host-project");
    // The host credential's catalog is loaded and answers ambient reads.
    await loadVeryfrontCloudModelCatalog();
    assertEquals(resolveVeryfrontCloudModelThinking(MODEL_ID), {
      enabled: true,
      budgetTokens: 4096,
    });

    const toBroker = new TransformStream<Uint8Array, Uint8Array>();
    const toExecutor = new TransformStream<Uint8Array, Uint8Array>();
    const operations = new Map<string, ExecutorOperation>([
      ...createExecutorModelBroker({
        allowedModelIds: new Set([MODEL_ID]),
        resolveModelRuntime: (id) =>
          id === MODEL_ID
            ? createVeryfrontCloudInferenceModel("anthropic/claude-sonnet-4-6", RUN_TOKEN)
            : undefined,
      }),
      ["persistence.initial-checkpoints", {
        mode: "stream",
        async *handle() {
          yield { type: "complete" };
        },
      }],
    ]);
    const broker = createExecutorChannel({
      binding,
      operations,
      transport: { readable: toBroker.readable, writable: toExecutor.writable },
    });
    const executor = createExecutorChannel({
      binding,
      transport: { readable: toExecutor.readable, writable: toBroker.writable },
    });
    try {
      const facades = await createExecutorRuntimeFacades({
        input: installation(),
        channel: executor,
        signal: executor.signal,
      });
      const key = await facades.loadModelCatalog!(new AbortController().signal);
      assert(typeof key === "string");
      assertEquals(key.includes(RUN_TOKEN) || key.includes(HOST_TOKEN), false);
      assert(authorizations.includes(`Bearer ${RUN_TOKEN}`));

      assertEquals(
        runWithVeryfrontCloudContext(
          { catalogScopeKey: key },
          () => resolveVeryfrontCloudModelThinking(MODEL_ID),
        ),
        { enabled: true, budgetTokens: 1024 },
      );
      // Ambient reads outside the run keep the host credential's catalog.
      assertEquals(resolveVeryfrontCloudModelThinking(MODEL_ID), {
        enabled: true,
        budgetTokens: 4096,
      });
      await facades.cleanup();
    } finally {
      broker.close();
      executor.close();
      await Promise.all([broker.settled, executor.settled]);
    }
  });
});

describe("run-scoped context summary catalog", () => {
  beforeEach(() => __resetVeryfrontCloudCatalogForTests());
  afterEach(() => {
    restoreMockFetch();
    __resetVeryfrontCloudCatalogForTests();
  });

  it("resolves a served-only alias when the run's fresh catalog does not list the built-in default", async () => {
    installMockFetch(
      ((input: URL | Request | string, init?: RequestInit) => {
        const request = new Request(input, init);
        if (new URL(request.url).pathname !== "/ai/models") {
          return Promise.resolve(new Response("unexpected", { status: 500 }));
        }
        // No Mistral model: the built-in default is unlisted for this credential.
        return Promise.resolve(Response.json({
          models: [{
            id: "served-only-summary",
            modelId: "anthropic/served-only-summary",
            provider: "anthropic",
            surface: "anthropic",
            operations: ["messages"],
            aliases: ["summary-alias"],
            capabilities: {},
          }],
        }));
      }) as typeof fetch,
    );
    const summarize = async () => {
      const resolved: string[] = [];
      const inner = createVeryfrontCloudInferenceModelResolver(RUN_TOKEN, {
        apiBaseUrl: "https://api.example.test",
      });
      const resolver = (id: string) => {
        resolved.push(id);
        return inner(id);
      };
      registerModelRuntimeResolverRevoker(resolver, () => revokeModelRuntimeResolver(inner));
      const generator = createRunScopedVeryfrontCloudContextSummaryGenerator({
        apiUrl: "https://api.example.test",
        model: "summary-alias",
        maxOutputTokens: 500,
        maxInputTokens: 1_000,
        generateText: () =>
          Promise.resolve({
            text: "summary",
            usage: { inputTokens: 1, outputTokens: 1 },
            finishReason: "stop",
          }),
      }, () => resolver);
      assertEquals(await generator(summaryInput), { text: "summary" });
      return resolved;
    };
    // The first summary loads the catalog; the second meets it fresh.
    for (let run = 0; run < 2; run++) {
      const resolved = await summarize();
      assertEquals(resolved.at(-1), "veryfront-cloud/anthropic/served-only-summary");
    }
  });
});
