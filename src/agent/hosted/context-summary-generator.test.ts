import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import type { ModelRuntime } from "#veryfront/provider";
import { getCurrentVeryfrontCloudContext } from "#veryfront/provider/veryfront-cloud/context.ts";
import { createVeryfrontCloudInferenceModelResolver } from "./inference-credential.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeGenerateTextResult } from "../runtime/runtime-tool-types.ts";
import {
  createRunScopedVeryfrontCloudContextSummaryGenerator,
  createVeryfrontCloudContextSummaryGenerator,
} from "./context-summary-generator.ts";
import { registerModelRuntimeResolverRevoker } from "#veryfront/agent/runtime/model-transport.ts";

function createModel(): ModelRuntime {
  return {
    provider: "test",
    modelId: "test-model",
    doGenerate: () => Promise.resolve({ content: [] }),
    doStream: () => Promise.resolve({ stream: new ReadableStream<unknown>() }),
  };
}

const summaryInput = {
  messagesToSummarize: [{
    id: "message-1",
    role: "user" as const,
    timestamp: 1,
    parts: [{ type: "text" as const, text: "Summarize this context." }],
  }],
  retainedMessages: [],
};

describe("createVeryfrontCloudContextSummaryGenerator", () => {
  it("rolls oversized history through bounded summaries", async () => {
    const prompts: string[] = [];
    const projectSlugs: Array<string | undefined> = [];
    const visibleTokens: Array<string | undefined> = [];
    const generator = createVeryfrontCloudContextSummaryGenerator({
      apiUrl: "https://api.example.com",
      projectSlug: "demo-project",
      model: "openai/gpt-5.2",
      maxOutputTokens: 500,
      maxInputTokens: 40,
      resolveModel: (modelId) => {
        assertEquals(modelId, "veryfront-cloud/openai/gpt-5.2");
        return createModel();
      },
      generateText: (options): PromiseLike<RuntimeGenerateTextResult> => {
        projectSlugs.push(getCurrentVeryfrontCloudContext()?.projectSlug);
        visibleTokens.push(getCurrentVeryfrontCloudContext()?.apiToken);
        const message = options.messages.find((candidate) => candidate.role === "user");
        prompts.push(typeof message?.content === "string" ? message.content : "");
        return Promise.resolve({
          text: `summary-${prompts.length}`,
          usage: { inputTokens: 1, outputTokens: 1 },
          finishReason: "stop",
        });
      },
    });

    const result = await generator({
      messagesToSummarize: [
        {
          id: "message-1",
          role: "user",
          timestamp: 1,
          parts: [{ type: "text", text: "First older request ".repeat(20) }],
        },
        {
          id: "message-2",
          role: "assistant",
          timestamp: 2,
          parts: [{ type: "text", text: "First older response ".repeat(20) }],
        },
        {
          id: "message-3",
          role: "user",
          timestamp: 3,
          parts: [{ type: "text", text: "Second older request ".repeat(20) }],
        },
      ],
      retainedMessages: [
        {
          id: "message-4",
          role: "user",
          timestamp: 4,
          parts: [{ type: "text", text: "Latest request" }],
        },
      ],
      customInstructions: "Keep project constraints.",
    });

    assertEquals(result, { text: "summary-3" });
    assertEquals(prompts.length, 3);
    assertEquals(prompts[1]?.includes("Existing summary to update:\nsummary-1"), true);
    assertEquals(prompts[2]?.includes("Existing summary to update:\nsummary-2"), true);
    assertEquals(prompts[0]?.includes("Keep project constraints."), true);
    assertEquals(projectSlugs, ["demo-project", "demo-project", "demo-project"]);
    assertEquals(visibleTokens, [undefined, undefined, undefined]);
  });

  it("uses the private inference resolver", async () => {
    const visibleTokens: Array<string | undefined> = [];
    const privateModelResolver = createVeryfrontCloudInferenceModelResolver(
      "run-scoped-inference-token",
    );
    const generator = createVeryfrontCloudContextSummaryGenerator({
      apiUrl: "https://api.veryfront.com",
      projectSlug: "demo-project",
      model: "openai/gpt-test",
      maxOutputTokens: 500,
      maxInputTokens: 1_000,
      resolveModel: (modelId) => {
        const model = privateModelResolver(modelId);
        if (!model) throw new TypeError("Expected private Veryfront Cloud model");
        return model;
      },
      generateText: (): PromiseLike<RuntimeGenerateTextResult> => {
        visibleTokens.push(getCurrentVeryfrontCloudContext()?.apiToken);
        return Promise.resolve({
          text: "summary",
          usage: { inputTokens: 1, outputTokens: 1 },
          finishReason: "stop",
        });
      },
    });
    const result = await generator({
      messagesToSummarize: [{
        id: "message-1",
        role: "user",
        timestamp: 1,
        parts: [{ type: "text", text: "Summarize this context." }],
      }],
      retainedMessages: [],
    });

    assertEquals(result, { text: "summary" });
    assertEquals(visibleTokens, [undefined]);
  });

  it("redacts sensitive tool data before summarization", async () => {
    let prompt = "";
    const generator = createVeryfrontCloudContextSummaryGenerator({
      apiUrl: "https://api.example.com",
      authToken: "token-1",
      model: "openai/gpt-5.2",
      maxOutputTokens: 500,
      maxInputTokens: 1_000,
      resolveModel: () => createModel(),
      generateText: (options): PromiseLike<RuntimeGenerateTextResult> => {
        const message = options.messages.find((candidate) => candidate.role === "user");
        prompt = typeof message?.content === "string" ? message.content : "";
        return Promise.resolve({
          text: "safe summary",
          usage: { inputTokens: 1, outputTokens: 1 },
          finishReason: "stop",
        });
      },
    });

    await generator({
      messagesToSummarize: [
        {
          id: "message-1",
          role: "assistant",
          timestamp: 1,
          parts: [
            {
              type: "tool-call",
              toolName: "call_api",
              toolCallId: "tool-1",
              args: {
                authorization: "Bearer secret-token",
                query: "status",
                url: "https://api.example.test/path?access_token=query-secret",
              },
            },
            {
              type: "tool-result",
              toolName: "call_api",
              toolCallId: "tool-1",
              result: {
                ok: true,
                access_token: "secret-access-token",
                output: "Fetched postgres://user:password@db.example.test:5432/app",
              },
            },
          ],
        },
      ],
      retainedMessages: [],
    });

    assertEquals(prompt.includes("secret-token"), false);
    assertEquals(prompt.includes("secret-access-token"), false);
    assertEquals(prompt.includes("query-secret"), false);
    assertEquals(prompt.includes("password"), false);
    assertEquals(prompt.includes("[REDACTED]"), true);
    assertEquals(prompt.includes("access_token=[REDACTED]"), true);
    assertEquals(prompt.includes("postgres://user:[REDACTED]@db.example.test:5432/app"), true);
    assertEquals(prompt.includes('"query":"status"'), true);
  });

  it("bounds oversized parts and tolerates unserializable results", async () => {
    const prompts: string[] = [];
    const generator = createVeryfrontCloudContextSummaryGenerator({
      apiUrl: "https://api.example.com",
      authToken: "token-1",
      model: "openai/gpt-5.2",
      maxOutputTokens: 500,
      maxInputTokens: 100_000,
      resolveModel: () => createModel(),
      generateText: (options): PromiseLike<RuntimeGenerateTextResult> => {
        const message = options.messages.find((candidate) => candidate.role === "user");
        prompts.push(typeof message?.content === "string" ? message.content : "");
        return Promise.resolve({
          text: "bounded summary",
          usage: { inputTokens: 1, outputTokens: 1 },
          finishReason: "stop",
        });
      },
    });

    await generator({
      messagesToSummarize: [
        {
          id: "message-1",
          role: "tool",
          timestamp: 1,
          parts: [{
            type: "tool-result",
            toolName: "read_file",
            toolCallId: "tool-1",
            result: "x".repeat(25_000),
          }],
        },
      ],
      retainedMessages: [],
    });

    assertEquals(prompts.length, 1, "a single bounded message must produce one summary prompt");
    assertStringIncludes(
      prompts[0] ?? "",
      "[truncated 5002 characters]",
      "a part over 20,000 characters must carry the truncation marker",
    );
    assertEquals(
      prompts[0]?.includes("x".repeat(20_001)),
      false,
      "the serialized part must be capped at the 20,000 character limit",
    );

    await generator({
      messagesToSummarize: [
        {
          id: "message-2",
          role: "tool",
          timestamp: 2,
          parts: [{
            type: "tool-result",
            toolName: "read_file",
            toolCallId: "tool-2",
            result: { count: 1n },
          }],
        },
      ],
      retainedMessages: [],
    });

    assertStringIncludes(
      prompts[1] ?? "",
      "[unserializable]",
      "tool results that cannot be JSON serialized must use the unserializable placeholder",
    );
  });
});

describe("createRunScopedVeryfrontCloudContextSummaryGenerator", () => {
  it("uses and revokes one private resolver, then rejects replay", async () => {
    let resolverCreations = 0;
    let revocations = 0;
    const resolvedModelIds: string[] = [];
    const resolver = (modelId: string) => {
      resolvedModelIds.push(modelId);
      return createModel();
    };
    registerModelRuntimeResolverRevoker(resolver, () => {
      revocations += 1;
    });
    const generator = createRunScopedVeryfrontCloudContextSummaryGenerator(
      {
        apiUrl: "https://api.example.com",
        authToken: "must-not-be-used-with-a-private-resolver",
        model: "openai/gpt-test",
        maxOutputTokens: 500,
        maxInputTokens: 1_000,
        generateText: () =>
          Promise.resolve({
            text: "private summary",
            usage: { inputTokens: 1, outputTokens: 1 },
            finishReason: "stop",
          }),
      },
      () => {
        resolverCreations += 1;
        return resolver;
      },
    );

    assertEquals(await generator(summaryInput), { text: "private summary" });
    assertEquals(resolvedModelIds, ["veryfront-cloud/openai/gpt-test"]);
    assertEquals(revocations, 1);

    await assertRejects(
      async () => await generator(summaryInput),
      TypeError,
      "Context compaction inference authority has already been used",
    );
    assertEquals(resolverCreations, 1);
    assertEquals(revocations, 1);
  });

  it("rejects a non-cloud model from the private resolver and still revokes it", async () => {
    let revocations = 0;
    const resolver = () => undefined;
    registerModelRuntimeResolverRevoker(resolver, () => {
      revocations += 1;
    });
    const generator = createRunScopedVeryfrontCloudContextSummaryGenerator(
      {
        apiUrl: "https://api.example.com",
        model: "openai/gpt-test",
        maxOutputTokens: 500,
        maxInputTokens: 1_000,
        generateText: () => {
          throw new Error("generateText must not run without a private cloud model");
        },
      },
      () => resolver,
    );

    await assertRejects(
      async () => await generator(summaryInput),
      TypeError,
      'Context compaction requires a Veryfront Cloud model, received "veryfront-cloud/openai/gpt-test"',
    );
    assertEquals(revocations, 1);
  });

  it("revokes private authority before forwarding compaction aborts", async () => {
    const modelStarted = Promise.withResolvers<void>();
    let replayedDuringAbort: unknown;
    let resolverActive = true;
    const model = createModel();
    const resolver = () => resolverActive ? model : undefined;
    registerModelRuntimeResolverRevoker(resolver, () => {
      resolverActive = false;
    });
    const abortController = new AbortController();
    const generator = createRunScopedVeryfrontCloudContextSummaryGenerator(
      {
        apiUrl: "https://api.example.com",
        model: "openai/gpt-test",
        maxOutputTokens: 500,
        maxInputTokens: 1_000,
        abortSignal: abortController.signal,
        generateText: (options) =>
          new Promise((_, reject) => {
            options.abortSignal?.addEventListener("abort", () => {
              replayedDuringAbort = resolver();
              reject(options.abortSignal?.reason);
            }, { once: true });
            modelStarted.resolve();
          }),
      },
      () => resolver,
    );
    const aborted = assertRejects(
      async () => await generator(summaryInput),
      DOMException,
      "caller aborted",
    );

    await modelStarted.promise;
    abortController.abort(new DOMException("caller aborted", "AbortError"));

    await aborted;
    assertEquals(replayedDuringAbort, undefined);
    assertEquals(resolverActive, false);
  });

  it("falls back to the supplied token when no private resolver exists", async () => {
    const visibleTokens: Array<string | undefined> = [];
    const generator = createRunScopedVeryfrontCloudContextSummaryGenerator(
      {
        apiUrl: "https://api.example.com",
        authToken: "fallback-token",
        model: "openai/gpt-test",
        maxOutputTokens: 500,
        maxInputTokens: 1_000,
        generateText: () => {
          visibleTokens.push(getCurrentVeryfrontCloudContext()?.apiToken);
          return Promise.resolve({
            text: "fallback summary",
            usage: { inputTokens: 1, outputTokens: 1 },
            finishReason: "stop",
          });
        },
      },
      () => undefined,
    );

    assertEquals(await generator(summaryInput), { text: "fallback summary" });
    assertEquals(visibleTokens, ["fallback-token"]);
  });
});
