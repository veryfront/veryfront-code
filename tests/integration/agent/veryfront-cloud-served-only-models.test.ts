import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import {
  clearModelProviders,
  loadVeryfrontCloudModelCatalog,
  registerModelProvider,
} from "#veryfront/provider";
import {
  getCurrentVeryfrontCloudContext,
  runWithVeryfrontCloudContext,
  type VeryfrontCloudContext,
} from "#veryfront/provider/veryfront-cloud/context.ts";
import { __resetVeryfrontCloudCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import { resolveVeryfrontCloudModelId } from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { createVeryfrontCloudInferenceModel } from "#veryfront/provider/veryfront-cloud/provider.ts";
import type { ModelRuntime } from "#veryfront/provider/types.ts";
import { resolveAgentModelTransport } from "#veryfront/agent/runtime/model-transport.ts";
import { resolveRuntimeModel } from "#veryfront/agent/runtime/model-resolution.ts";
import { createDefaultHostedChatRuntime } from "#veryfront/agent/hosted/default-chat-runtime.ts";
import type {
  RemoteMCPToolSourceConfig,
  RemoteToolSource,
  ToolExecutionContext,
} from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/define.ts";

/**
 * A process that has loaded no catalog meets a model and an alias only the
 * served catalog knows. Each case drives one entry point cold, with ambient or
 * explicit run credentials, and checks it routes through Veryfront Cloud with
 * the catalog loaded for those same credentials.
 */

const SERVED_ONLY_MODEL = "mistral/mistral-medium-2609";
const SERVED_ONLY_ALIAS = "medium";
const NEW_PROVIDER_MODEL = "acme-labs/m1";
const NEW_PROVIDER_ALIAS = "acme-m1";
const AMBIENT_TOKEN = "vf_ambient_token";
const RUN_TOKEN = "vf_run_token";

type Captured = { method: string; path: string; authorization: string | null; model?: unknown };

/** A catalog that knows the served-only model and alias, for one credential. */
function catalogFor(authorization: string | null): Response {
  const knowsModel = authorization === `Bearer ${RUN_TOKEN}` ||
    authorization === `Bearer ${AMBIENT_TOKEN}`;
  return Response.json({
    models: knowsModel
      ? [{
        id: "mistral-medium-2609",
        modelId: SERVED_ONLY_MODEL,
        provider: "mistral",
        surface: "openai",
        operations: ["chat-completions"],
        aliases: [SERVED_ONLY_ALIAS],
        capabilities: {},
      }, {
        id: "m1",
        modelId: NEW_PROVIDER_MODEL,
        provider: "acme-labs",
        surface: "openai",
        operations: ["chat-completions"],
        aliases: [NEW_PROVIDER_ALIAS],
        capabilities: {},
      }]
      : [],
  });
}

function installGateway(onlyRunCredentialKnowsModel = false): Captured[] {
  const captured: Captured[] = [];
  const encoder = new TextEncoder();
  installMockFetch(
    (async (input: URL | Request | string, init?: RequestInit) => {
      const request = new Request(input, init);
      const authorization = request.headers.get("authorization");
      const entry: Captured = {
        method: request.method,
        path: new URL(request.url).pathname,
        authorization,
      };
      captured.push(entry);
      if (entry.path === "/ai/models") {
        return catalogFor(
          onlyRunCredentialKnowsModel && authorization !== `Bearer ${RUN_TOKEN}`
            ? null
            : authorization,
        );
      }
      if (request.method === "POST") entry.model = (await request.json()).model;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'));
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    }) as typeof fetch,
  );
  return captured;
}

async function streamOnce(model: ModelRuntime): Promise<void> {
  const result = await model.doStream({ prompt: [] } as never);
  const reader = result.stream.getReader();
  while (!(await reader.read()).done) {
    // drain
  }
}

describe("served-only models from a cold process", () => {
  beforeEach(() => {
    __resetVeryfrontCloudCatalogForTests();
  });

  afterEach(() => {
    restoreMockFetch();
    __resetVeryfrontCloudCatalogForTests();
    deleteEnv("VERYFRONT_API_TOKEN");
    deleteEnv("VERYFRONT_PROJECT_SLUG");
    clearModelProviders();
  });

  describe("decided before the catalog loads", () => {
    it("routes an explicit served-only model through Veryfront Cloud with ambient credentials", async () => {
      setEnv("VERYFRONT_API_TOKEN", AMBIENT_TOKEN);
      setEnv("VERYFRONT_PROJECT_SLUG", "cold-project");
      const captured = installGateway();

      const transport = await resolveAgentModelTransport({
        agentId: "agent-1",
        config: { model: SERVED_ONLY_MODEL, system: "You are concise." },
        context: undefined,
        modelOverride: undefined,
        mode: "stream",
      });

      assertEquals(transport.resolvedModelString, `veryfront-cloud/${SERVED_ONLY_MODEL}`);
      assertEquals(captured.map(({ path }) => path), ["/ai/models"]);
    });

    it("routes a served-only short alias through Veryfront Cloud from the agent transport", async () => {
      setEnv("VERYFRONT_API_TOKEN", AMBIENT_TOKEN);
      setEnv("VERYFRONT_PROJECT_SLUG", "cold-project");
      const captured = installGateway();

      const transport = await resolveAgentModelTransport({
        agentId: "agent-1",
        config: { model: SERVED_ONLY_ALIAS, system: "You are concise." },
        context: undefined,
        modelOverride: undefined,
        mode: "stream",
      });

      assertEquals(transport.resolvedModelString, `veryfront-cloud/${SERVED_ONLY_MODEL}`);
      assertEquals(transport.requestedModel, SERVED_ONLY_MODEL);
      assertEquals(captured.map(({ path }) => path), ["/ai/models"]);
    });

    it("resolves a served-only alias in runtime model resolution only once a catalog loaded", async () => {
      setEnv("VERYFRONT_API_TOKEN", AMBIENT_TOKEN);
      setEnv("VERYFRONT_PROJECT_SLUG", "cold-project");
      installGateway();

      // Cold: nothing names the alias, so it is left as written.
      assertEquals(resolveRuntimeModel(SERVED_ONLY_ALIAS), SERVED_ONLY_ALIAS);
      await loadVeryfrontCloudModelCatalog();
      assertEquals(resolveRuntimeModel(SERVED_ONLY_ALIAS), `veryfront-cloud/${SERVED_ONLY_MODEL}`);
      // A known alias keeps its meaning.
      assertEquals(resolveRuntimeModel("sonnet"), "veryfront-cloud/anthropic/claude-sonnet-4-6");
    });

    for (const model of [NEW_PROVIDER_MODEL, NEW_PROVIDER_ALIAS]) {
      it(`routes ${model}, served for a provider this package does not name, through Veryfront Cloud`, async () => {
        setEnv("VERYFRONT_API_TOKEN", AMBIENT_TOKEN);
        setEnv("VERYFRONT_PROJECT_SLUG", "cold-project");
        installGateway();

        const transport = await resolveAgentModelTransport({
          agentId: "agent-1",
          config: { model, system: "You are concise." },
          context: undefined,
          modelOverride: undefined,
          mode: "stream",
        });

        assertEquals(transport.resolvedModelString, `veryfront-cloud/${NEW_PROVIDER_MODEL}`);
      });
    }

    it("resolves a served-only alias once the ambient catalog is loaded", async () => {
      setEnv("VERYFRONT_API_TOKEN", AMBIENT_TOKEN);
      setEnv("VERYFRONT_PROJECT_SLUG", "cold-project");
      installGateway();

      assertEquals(await loadVeryfrontCloudModelCatalog(), true);
      assertEquals(resolveVeryfrontCloudModelId(SERVED_ONLY_ALIAS), SERVED_ONLY_MODEL);
    });

    it("builds a served-only model with run credentials and serves it after its own load", async () => {
      const captured = installGateway();

      const model = createVeryfrontCloudInferenceModel(SERVED_ONLY_MODEL, RUN_TOKEN);
      await streamOnce(model);

      assertEquals(
        captured.map(({ method, path, authorization }) => `${method} ${path} ${authorization}`),
        [
          `GET /ai/models Bearer ${RUN_TOKEN}`,
          `POST /ai/v1/chat/completions Bearer ${RUN_TOKEN}`,
        ],
      );
      assertEquals(captured[1]?.model, SERVED_ONLY_MODEL);
    });

    it("refuses a Mistral model the run's own catalog does not list, on the first call", async () => {
      installGateway();

      const model = createVeryfrontCloudInferenceModel("mistral/not-served", RUN_TOKEN);
      await assertRejects(
        () => streamOnce(model),
        Error,
        'Unsupported Mistral model "mistral/not-served"',
      );
    });
  });

  describe("read in the scope the catalog was loaded for", () => {
    it("resolves a served-only alias in a credential-free hosted tool context, without the credential", async () => {
      const captured = installGateway(true);
      let resolvedInTool: string | undefined;
      let toolContext: VeryfrontCloudContext | undefined;
      let modelCalls = 0;
      registerModelProvider("test", () => ({
        provider: "test",
        modelId: "test/stripped-context",
        doGenerate: () => Promise.reject(new Error("unused")),
        doStream() {
          modelCalls++;
          return Promise.resolve({
            stream: new ReadableStream<unknown>({
              start(controller) {
                if (modelCalls === 1) {
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: "child-1",
                    toolName: "invoke_child",
                    input: {},
                  });
                  controller.enqueue({ type: "finish", finishReason: "tool-calls", usage: {} });
                } else {
                  controller.enqueue({ type: "text-delta", text: "done" });
                  controller.enqueue({ type: "finish", finishReason: "stop", usage: {} });
                }
                controller.close();
              },
            }),
          });
        },
      }));

      const runtime = await createDefaultHostedChatRuntime({
        sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
        options: {
          projectId: "project-1",
          projectSlug: "run-project",
          authToken: RUN_TOKEN,
          instructions: "Invoke the child.",
          model: "test/stripped-context",
          allowedTools: ["invoke_child"],
        },
        config: {
          apiUrl: "https://api.veryfront.com",
          apiMcpUrl: "https://api.veryfront.com/mcp",
        },
        buildLocalTools: () => ({
          invoke_child: {
            description: "Resolve a child model the way invoke_agent does",
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: () => {
              toolContext = getCurrentVeryfrontCloudContext();
              // invoke_agent resolves the child's model with this function.
              resolvedInTool = resolveVeryfrontCloudModelId(SERVED_ONLY_ALIAS);
              return { ok: true };
            },
          },
        }),
        createRemoteToolSource: emptyRemoteSource,
        preloadLatestConversationUserText: false,
      });
      try {
        const result = await runtime.agent.stream({
          messages: [],
          abortSignal: new AbortController().signal,
        });
        for await (const _chunk of result.toUIMessageStream()) {
          // Consume the tool round trip.
        }
      } finally {
        await runtime.cleanup?.();
      }

      assertEquals(resolvedInTool, SERVED_ONLY_MODEL);
      assertEquals(toolContext?.apiToken, undefined);
      assertEquals(typeof toolContext?.catalogScopeKey, "string");
      assertEquals(toolContext?.catalogScopeKey?.includes(RUN_TOKEN), false);
      assertEquals(JSON.stringify(toolContext).includes(RUN_TOKEN), false);
      assertEquals(
        captured.filter(({ path }) => path === "/ai/models").map(({ authorization }) =>
          authorization
        ),
        [`Bearer ${RUN_TOKEN}`],
      );
    });

    it("falls back to the shipped aliases in a credential-free context whose run loaded nothing", () => {
      const stripped: VeryfrontCloudContext = {
        apiBaseUrl: "https://api.veryfront.com",
        projectSlug: "run-project",
        serviceLayer: "cloud",
      };

      runWithVeryfrontCloudContext(stripped, () => {
        assertEquals(resolveVeryfrontCloudModelId("opus"), "anthropic/claude-opus-4-8");
        assertThrows(
          () => resolveVeryfrontCloudModelId(SERVED_ONLY_ALIAS),
          Error,
          "Unknown model alias",
        );
      });
    });

    it("resolves a hosted alias from the run's catalog, not the ambient one", async () => {
      setEnv("VERYFRONT_API_TOKEN", AMBIENT_TOKEN);
      setEnv("VERYFRONT_PROJECT_SLUG", "ambient-project");
      const captured = installGateway(true);

      const runtime = await createDefaultHostedChatRuntime({
        sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
        options: {
          projectId: "project-1",
          projectSlug: "run-project",
          branchId: "branch-1",
          authToken: RUN_TOKEN,
          instructions: "Base instructions",
          model: SERVED_ONLY_ALIAS,
          allowedTools: [],
          conversationId: "conversation-1",
          userId: "user-1",
        },
        config: {
          apiUrl: "https://api.veryfront.com",
          apiMcpUrl: "https://api.veryfront.com/mcp",
          studioMcpUrl: "https://studio.example.com/mcp",
        },
        buildLocalTools: () => ({ noop: localTool("No-op") }),
        createRemoteToolSource: emptyRemoteSource,
        preloadLatestConversationUserText: false,
      });

      assertEquals(runtime.modelId, SERVED_ONLY_MODEL);
      const catalogRequests = captured.filter(({ path }) => path === "/ai/models");
      assertEquals(catalogRequests.map(({ authorization }) => authorization), [
        `Bearer ${RUN_TOKEN}`,
      ]);
      await runtime.cleanup?.();
    });
  });
});

function localTool(description: string) {
  return {
    description,
    inputSchema: defineSchema((v) => v.object({}))(),
    execute: () => ({ ok: true }),
  };
}

function emptyRemoteSource(config: RemoteMCPToolSourceConfig): RemoteToolSource {
  return {
    id: config.id ?? "source",
    listTools: () => Promise.resolve([]),
    executeTool: (_toolName: string, _args: unknown, _context?: ToolExecutionContext) =>
      Promise.resolve({ ok: true }),
  };
}
