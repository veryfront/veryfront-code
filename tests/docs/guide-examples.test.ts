/**
 * Tests that verify the code examples from docs/guides/ actually work.
 *
 * These tests exercise the public API exactly as documented — same imports,
 * same function calls, same config shapes. If a guide example is wrong,
 * this test fails.
 *
 * No API keys required. LLM calls are not made.
 */
import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

// === Guide: tools.mdx ===
import { tool } from "../../src/tool/index.ts";
import { z } from "zod";

describe("Guide: tools.mdx", () => {
  it("should create a tool with inputSchema and execute it", async () => {
    const getWeather = tool({
      description: "Get the current weather for a city",
      inputSchema: z.object({
        city: z.string().describe("City name"),
        units: z.enum(["celsius", "fahrenheit"]).default("celsius"),
      }),
      execute: async ({ city, units }) => {
        return { temperature: 22, conditions: "sunny", city, units };
      },
    });

    assertExists(getWeather.id);
    assertEquals(getWeather.description, "Get the current weather for a city");

    const result = await getWeather.execute({ city: "Tokyo", units: "celsius" });
    assertEquals(result.temperature, 22);
    assertEquals(result.city, "Tokyo");
  });

  it("should validate input against schema", async () => {
    const lookup = tool({
      description: "Look up a user by email",
      inputSchema: z.object({ email: z.string().email() }),
      execute: async ({ email }) => ({ email }),
    });

    // Valid input
    const result = await lookup.execute({ email: "test@example.com" });
    assertEquals(result.email, "test@example.com");

    // Invalid input should throw
    let threw = false;
    try {
      await lookup.execute({ email: "not-an-email" } as any);
    } catch {
      threw = true;
    }
    assert(threw, "Should throw on invalid email");
  });

  it("should support inline tool definition", () => {
    const calculate = tool({
      description: "Evaluate a math expression",
      inputSchema: z.object({ expression: z.string() }),
      execute: async ({ expression }) => ({ result: expression }),
    });

    assertExists(calculate.id);
    assertExists(calculate.execute);
  });
});

// === Guide: agents.mdx ===
import { agent } from "../../src/agent/factory.ts";

describe("Guide: agents.mdx", () => {
  it("should create an agent with basic config", () => {
    const assistant = agent({
      model: "openai/gpt-4o",
      system: "You are a helpful assistant. Answer concisely.",
    });

    assertExists(assistant);
    assertExists(assistant.config);
    assertEquals(assistant.config.model, "openai/gpt-4o");
    assertEquals(assistant.config.system, "You are a helpful assistant. Answer concisely.");
  });

  it("should create an agent with tools reference", () => {
    const assistant = agent({
      model: "openai/gpt-4o",
      system: "You are a weather assistant.",
      tools: { getWeather: true },
      maxSteps: 5,
    });

    assertEquals(assistant.config.maxSteps, 5);
    assertEquals((assistant.config.tools as Record<string, boolean>).getWeather, true);
  });

  it("should support function system prompts", () => {
    const assistant = agent({
      model: "openai/gpt-4o",
      system: () => {
        const date = new Date().toLocaleDateString();
        return `You are a helpful assistant. Today is ${date}.`;
      },
    });

    assert(typeof assistant.config.system === "function");
  });

  it("should support async system prompts", () => {
    const assistant = agent({
      model: "openai/gpt-4o",
      system: async () => {
        return `You are a helpful assistant.`;
      },
    });

    assert(typeof assistant.config.system === "function");
  });

  it("should support memory config", () => {
    const assistant = agent({
      model: "openai/gpt-4o",
      system: "You are a helpful assistant.",
      memory: { type: "buffer", maxMessages: 50 },
    });

    assertEquals(assistant.config.memory?.type, "buffer");
  });
});

// === Guide: middleware.mdx ===
import { MiddlewarePipeline } from "../../src/middleware/core/pipeline/pipeline.ts";

describe("Guide: middleware.mdx", () => {
  it("should create and chain middleware", () => {
    const pipeline = new MiddlewarePipeline();

    const result = pipeline
      .use((_c, next) => next())
      .use((_c, next) => next());

    assert(result === pipeline, "use() should return this for chaining");
    assertEquals(pipeline.getMiddleware().length, 2);
  });

  it("should execute pipeline with mock request", async () => {
    const pipeline = new MiddlewarePipeline();
    pipeline.use(() => Response.json({ message: "Hello" }));

    const response = await pipeline.execute(new Request("http://localhost/"));

    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.message, "Hello");
  });

  it("should support custom auth middleware pattern", async () => {
    const pipeline = new MiddlewarePipeline();

    // Custom auth middleware as shown in guide
    pipeline.use(async (c, next) => {
      const token = c.request.headers.get("authorization");
      if (!token) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      return next();
    });

    pipeline.use(() => Response.json({ data: "protected" }));

    // Without auth header
    const unauthed = await pipeline.execute(new Request("http://localhost/"));
    assertEquals(unauthed.status, 401);

    // With auth header
    const authed = await pipeline.execute(
      new Request("http://localhost/", {
        headers: { authorization: "Bearer test" },
      }),
    );
    assertEquals(authed.status, 200);
  });
});

// === Guide: workflows.mdx ===
import { workflow, step, parallel, branch, when, unless } from "../../src/workflow/dsl/index.ts";

describe("Guide: workflows.mdx", () => {
  it("should create a basic workflow with steps", () => {
    const pipeline = workflow({
      id: "content-pipeline",
      steps: [
        step("research", { agent: "researcher" }),
        step("write", { agent: "writer" }),
        step("review", { agent: "editor" }),
      ],
    });

    assertExists(pipeline);
    assertEquals(pipeline.id, "content-pipeline");
  });

  it("should create a workflow with parallel steps", () => {
    const report = workflow({
      id: "report",
      steps: [
        step("gather", { agent: "researcher" }),
        parallel("analyze", [
          step("sentiment", { tool: "sentimentAnalyzer" }),
          step("entities", { tool: "entityExtractor" }),
          step("summary", { agent: "summarizer" }),
        ]),
        step("compile", { agent: "writer" }),
      ],
    });

    assertExists(report);
    assertEquals(report.id, "report");
  });

  it("should create a workflow with branch", () => {
    const support = workflow({
      id: "support",
      steps: [
        step("classify", { agent: "classifier" }),
        branch("route", {
          condition: (ctx) => (ctx.results as Record<string, Record<string, string>>)?.classify?.category === "billing",
          then: [step("billing", { agent: "billing-agent" })],
          else: [step("technical", { agent: "tech-agent" })],
        }),
      ],
    });

    assertExists(support);
  });

  it("should support when/unless shorthand", () => {
    const node1 = when("needs-approval", () => true, [
      step("review", { agent: "reviewer" }),
    ]);
    assertExists(node1);

    const node2 = unless("is-cached", () => false, [
      step("fetch", { tool: "fetcher" }),
    ]);
    assertExists(node2);
  });

  it("should support input schema validation", () => {
    const pipeline = workflow({
      id: "typed-pipeline",
      inputSchema: z.object({ topic: z.string() }),
      steps: ({ input }) => [
        step("research", {
          agent: "researcher",
          input: input.topic,
        }),
      ],
    });

    assertExists(pipeline);
    assertEquals(pipeline.id, "typed-pipeline");
  });
});

// === Guide: data-fetching.mdx ===
import { notFound, redirect } from "../../src/data/index.ts";

describe("Guide: data-fetching.mdx", () => {
  it("should return notFound result", () => {
    const result = notFound();
    assertExists(result);
    assertEquals(result.notFound, true);
  });

  it("should return redirect result", () => {
    const result = redirect("/new-url");
    assertExists(result);
    assertEquals(result.redirect?.destination, "/new-url");
  });

  it("should return permanent redirect", () => {
    const result = redirect("/new-url", true);
    assertExists(result);
    assertEquals(result.redirect?.permanent, true);
  });
});

// === Guide: multi-agent.mdx ===
import { agentAsTool, getAgentsAsTools, registerAgent, getAllAgentIds } from "../../src/agent/index.ts";

describe("Guide: multi-agent.mdx", () => {
  it("should register and retrieve agent IDs", () => {
    const testAgent = agent({
      id: "test-guide-agent",
      model: "openai/gpt-4o",
      system: "Test agent",
    });

    registerAgent("test-guide-agent", testAgent);
    const ids = getAllAgentIds();
    assert(ids.includes("test-guide-agent"));
  });

  it("should convert agent to tool", () => {
    const testAgent = agent({
      id: "test-as-tool",
      model: "openai/gpt-4o",
      system: "Test",
    });

    const asTool = agentAsTool(testAgent, "A test agent tool");
    assertExists(asTool);
    assertExists(asTool.execute);
    assertEquals(asTool.description, "A test agent tool");
  });

  it("should get multiple agents as tools", () => {
    registerAgent("researcher-test", agent({
      id: "researcher-test",
      model: "openai/gpt-4o",
      system: "Research",
    }));

    registerAgent("writer-test", agent({
      id: "writer-test",
      model: "openai/gpt-4o",
      system: "Write",
    }));

    const tools = getAgentsAsTools({
      "researcher-test": "Research a topic",
      "writer-test": "Write an article",
    });

    assertExists(tools["researcher-test"]);
    assertExists(tools["writer-test"]);
  });
});

// === Guide: configuration.mdx ===
import { defineConfig } from "../../src/config/define-config.ts";

describe("Guide: configuration.mdx", () => {
  it("should create config with defineConfig", () => {
    const config = defineConfig({
      title: "My App",
      description: "A Veryfront application",
    });

    assertEquals(config.title, "My App");
    assertEquals(config.description, "A Veryfront application");
  });

  it("should support build config", () => {
    const config = defineConfig({
      build: {
        outDir: "dist",
        trailingSlash: false,
      },
    });

    assertEquals(config.build?.outDir, "dist");
    assertEquals(config.build?.trailingSlash, false);
  });

  it("should support directories override", () => {
    const config = defineConfig({
      directories: {
        app: "src/app",
      },
    });

    assertEquals(config.directories?.app, "src/app");
  });
});

// === Guide: memory-and-streaming.mdx ===
import { createMemory, BufferMemory, ConversationMemory } from "../../src/agent/index.ts";

describe("Guide: memory-and-streaming.mdx", () => {
  it("should create buffer memory via agent config", () => {
    const assistant = agent({
      model: "openai/gpt-4o",
      system: "You are a helpful assistant.",
      memory: { type: "buffer", maxMessages: 50 },
    });

    assertEquals(assistant.config.memory?.type, "buffer");
    assertEquals(assistant.config.memory?.maxMessages, 50);
  });

  it("should create conversation memory via agent config", () => {
    const assistant = agent({
      model: "openai/gpt-4o",
      system: "You are a helpful assistant.",
      memory: { type: "conversation", maxTokens: 4000 },
    });

    assertEquals(assistant.config.memory?.type, "conversation");
  });

  it("should create summary memory via agent config", () => {
    const assistant = agent({
      model: "openai/gpt-4o",
      system: "You are a research assistant.",
      memory: { type: "summary" },
    });

    assertEquals(assistant.config.memory?.type, "summary");
  });

  it("should create memory with createMemory factory", () => {
    const memory = createMemory({ type: "buffer", maxMessages: 10 });
    assertExists(memory);
  });

  it("should add and retrieve messages from buffer memory", async () => {
    const memory = new BufferMemory({ type: "buffer", maxMessages: 5 });

    await memory.add({ id: "1", role: "user", parts: [{ type: "text" }] });
    await memory.add({ id: "2", role: "assistant", parts: [{ type: "text" }] });

    const messages = await memory.getMessages();
    assertEquals(messages.length, 2);
    assertEquals(messages[0].role, "user");
    assertEquals(messages[1].role, "assistant");
  });

  it("should enforce buffer size limit", async () => {
    const memory = new BufferMemory({ type: "buffer", maxMessages: 2 });

    await memory.add({ id: "1", role: "user", parts: [{ type: "text" }] });
    await memory.add({ id: "2", role: "assistant", parts: [{ type: "text" }] });
    await memory.add({ id: "3", role: "user", parts: [{ type: "text" }] });

    const messages = await memory.getMessages();
    assertEquals(messages.length, 2);
    assertEquals(messages[0].id, "2"); // oldest dropped
  });

  it("should clear memory", async () => {
    const memory = new ConversationMemory({ type: "conversation" });

    await memory.add({ id: "1", role: "user", parts: [{ type: "text" }] });
    await memory.clear();

    const messages = await memory.getMessages();
    assertEquals(messages.length, 0);
  });

  it("should return memory stats", async () => {
    const memory = new BufferMemory({ type: "buffer", maxMessages: 50 });

    await memory.add({ id: "1", role: "user", parts: [{ type: "text" }] });
    await memory.add({ id: "2", role: "assistant", parts: [{ type: "text" }] });

    const stats = await memory.getStats();
    assertEquals(stats.totalMessages, 2);
    assertEquals(stats.type, "buffer");
    assert(typeof stats.estimatedTokens === "number");
  });
});

// === Guide: oauth.mdx ===
import {
  githubConfig,
  createOAuthInitHandler,
  createOAuthCallbackHandler,
  createOAuthStatusHandler,
  createOAuthDisconnectHandler,
  MemoryTokenStore,
} from "../../src/oauth/index.ts";

describe("Guide: oauth.mdx", () => {
  it("should have githubConfig with correct shape", () => {
    assertExists(githubConfig);
    assertEquals(githubConfig.providerId, "github");
    assertEquals(githubConfig.serviceId, "github");
    assertExists(githubConfig.authorizationUrl);
    assertExists(githubConfig.tokenUrl);
    assertExists(githubConfig.clientIdEnvVar);
    assertExists(githubConfig.clientSecretEnvVar);
    assert(Array.isArray(githubConfig.defaultScopes));
    assertExists(githubConfig.apiBaseUrl);
  });

  it("should create OAuth handlers from config", () => {
    const initHandler = createOAuthInitHandler(githubConfig);
    const callbackHandler = createOAuthCallbackHandler(githubConfig);
    const statusHandler = createOAuthStatusHandler(githubConfig);
    const disconnectHandler = createOAuthDisconnectHandler(githubConfig);

    assert(typeof initHandler === "function");
    assert(typeof callbackHandler === "function");
    assert(typeof statusHandler === "function");
    assert(typeof disconnectHandler === "function");
  });

  it("should support MemoryTokenStore for token persistence", async () => {
    const store = new MemoryTokenStore();

    // No tokens initially
    const initial = await store.getTokens("github");
    assertEquals(initial, null);

    // Store tokens
    await store.setTokens("github", { accessToken: "test-token" });
    const tokens = await store.getTokens("github");
    assertEquals(tokens?.accessToken, "test-token");

    // Clear tokens
    await store.clearTokens("github");
    const after = await store.getTokens("github");
    assertEquals(after, null);
  });

  it("should support custom provider config shape", () => {
    const myProvider = {
      providerId: "my-provider",
      serviceId: "my-provider",
      displayName: "My Provider",
      authorizationUrl: "https://provider.com/oauth/authorize",
      tokenUrl: "https://provider.com/oauth/token",
      clientIdEnvVar: "MY_PROVIDER_CLIENT_ID",
      clientSecretEnvVar: "MY_PROVIDER_CLIENT_SECRET",
      defaultScopes: ["read", "write"],
      apiBaseUrl: "https://api.provider.com",
    };

    const handler = createOAuthInitHandler(myProvider);
    assert(typeof handler === "function");
  });
});

// === Guide: mcp-server.mdx ===
import {
  createMCPServer,
  registerTool,
  getMCPStats,
  clearMCPRegistry,
} from "../../src/mcp/index.ts";

describe("Guide: mcp-server.mdx", () => {
  it("should create an MCP server", () => {
    const server = createMCPServer({ enabled: true });
    assertExists(server);
    assertExists(server.handleRequest);
  });

  it("should register tools and track stats", () => {
    clearMCPRegistry();

    const customTool = tool({
      description: "A custom tool",
      inputSchema: z.object({ input: z.string() }),
      execute: async ({ input }) => ({ result: input.toUpperCase() }),
    });

    registerTool("custom-tool", customTool);

    const stats = getMCPStats();
    assert(stats.tools >= 1);
    assert(stats.total >= 1);

    clearMCPRegistry();
  });
});

// === Guide: api-routes.mdx ===
describe("Guide: api-routes.mdx", () => {
  it("should support basic GET route pattern", () => {
    function GET() {
      return Response.json({ message: "Hello, world!" });
    }

    const response = GET();
    assertExists(response);
    assertEquals(response.status, 200);
  });

  it("should support POST with JSON body", async () => {
    async function POST(request: Request) {
      const { name } = await request.json();
      return Response.json({ name, created: true }, { status: 201 });
    }

    const response = await POST(
      new Request("http://localhost/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Alice" }),
      }),
    );

    assertEquals(response.status, 201);
    const body = await response.json();
    assertEquals(body.name, "Alice");
    assertEquals(body.created, true);
  });

  it("should support DELETE with 204 response", async () => {
    async function DELETE(_request: Request) {
      return new Response(null, { status: 204 });
    }

    const response = await DELETE(new Request("http://localhost/api/users/1", { method: "DELETE" }));
    assertEquals(response.status, 204);
  });

  it("should support query parameter parsing", () => {
    function GET(request: Request) {
      const url = new URL(request.url);
      const page = url.searchParams.get("page") ?? "1";
      return Response.json({ page });
    }

    const response = GET(new Request("http://localhost/api/users?page=3"));
    assertEquals(response.status, 200);
  });

  it("should support streaming response pattern", async () => {
    function GET() {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("data: 0\n\n"));
          controller.enqueue(encoder.encode("data: 1\n\n"));
          controller.close();
        },
      });

      return new Response(stream, {
        headers: { "content-type": "text/event-stream" },
      });
    }

    const response = GET();
    assertEquals(response.headers.get("content-type"), "text/event-stream");

    const text = await response.text();
    assert(text.includes("data: 0"));
    assert(text.includes("data: 1"));
  });
});

// === Guide: providers.mdx ===
describe("Guide: providers.mdx", () => {
  it("should support model string format", () => {
    // Model strings follow "provider/model" pattern
    const modelString = "openai/gpt-4o";
    const [provider, model] = modelString.split("/");
    assertEquals(provider, "openai");
    assertEquals(model, "gpt-4o");
  });

  it("should create agents with different model strings", () => {
    const openaiAgent = agent({
      model: "openai/gpt-4o",
      system: "You are a helpful assistant.",
    });
    assertEquals(openaiAgent.config.model, "openai/gpt-4o");

    const anthropicAgent = agent({
      model: "anthropic/claude-sonnet-4-5-20250929",
      system: "You are a helpful assistant.",
    });
    assertEquals(anthropicAgent.config.model, "anthropic/claude-sonnet-4-5-20250929");
  });
});
