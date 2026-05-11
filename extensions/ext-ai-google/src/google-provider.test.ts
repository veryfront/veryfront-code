import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import { ProviderOverloadedError, ProviderQuotaError } from "veryfront/provider/shared";

import { createGoogleEmbeddingRuntime, createGoogleModelRuntime } from "./google-provider.ts";

async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

function readRequestBody(init: RequestInit | undefined): string | null {
  if (!init || !("body" in init) || typeof init.body !== "string") {
    return null;
  }
  return init.body;
}

function readRequestHeader(init: RequestInit | undefined, name: string): string | null {
  if (!init || !("headers" in init)) {
    return null;
  }
  return new Headers(init.headers).get(name);
}

describe("ext-ai-google/google-provider", () => {
  it("creates a Google-compatible language runtime without SDK helpers for generate", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;

    const runtime = createGoogleModelRuntime({
      apiKey: "test-google-key",
      baseURL: "https://example.google.test/v1beta",
      fetch: (input, init) => {
        requestedUrl = String(input);
        requestedInit = init;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              candidates: [{
                content: {
                  role: "model",
                  parts: [{
                    functionCall: {
                      id: "tool_weather",
                      name: "weather",
                      args: { city: "Tokyo" },
                    },
                  }],
                },
                finishReason: "STOP",
              }],
              usageMetadata: {
                promptTokenCount: 8,
                candidatesTokenCount: 2,
                totalTokenCount: 10,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    }, "gemini-2.0-flash");

    const result = await runtime.doGenerate({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Check weather" }],
      }],
      tools: [{
        type: "function",
        name: "weather",
        description: "Get weather",
        inputSchema: {
          type: "object",
          properties: {
            city: { type: "string" },
          },
          required: ["city"],
          additionalProperties: false,
        },
      }],
      toolChoice: "auto",
      maxOutputTokens: 64,
      temperature: 0.1,
      stopSequences: ["END"],
      headers: { "x-extra-header": "kept" },
    });

    assertEquals(
      requestedUrl,
      "https://example.google.test/v1beta/models/gemini-2.0-flash:generateContent",
    );
    assertEquals(requestedInit?.method, "POST");
    assertEquals(new Headers(requestedInit?.headers).get("x-goog-api-key"), "test-google-key");
    assertEquals(new Headers(requestedInit?.headers).get("x-extra-header"), "kept");
    const requestBody = typeof requestedInit?.body === "string"
      ? JSON.parse(requestedInit.body)
      : undefined;
    assertEquals(requestBody, {
      contents: [{
        role: "user",
        parts: [{ text: "Check weather" }],
      }],
      tools: [{
        functionDeclarations: [{
          name: "weather",
          description: "Get weather",
          parameters: {
            type: "object",
            properties: {
              city: { type: "string" },
            },
            required: ["city"],
            additionalProperties: false,
          },
        }],
      }],
      toolConfig: {
        functionCallingConfig: {
          mode: "AUTO",
        },
      },
      generationConfig: {
        maxOutputTokens: 64,
        temperature: 0.1,
        stopSequences: ["END"],
      },
    });
    assertEquals(result, {
      content: [{
        type: "tool-call",
        toolCallId: "tool_weather",
        toolName: "weather",
        input: '{"city":"Tokyo"}',
      }],
      finishReason: { unified: "stop", raw: "STOP" },
      usage: {
        inputTokens: 8,
        outputTokens: 2,
        totalTokens: 10,
      },
    });
  });

  it("sends image URL user parts as Google fileData content", async () => {
    let requestedInit: RequestInit | undefined;

    const runtime = createGoogleModelRuntime({
      apiKey: "test-google-key",
      baseURL: "https://example.google.test/v1beta",
      fetch: (_input, init) => {
        requestedInit = init;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              candidates: [{
                content: { role: "model", parts: [{ text: "web app screenshot" }] },
                finishReason: "STOP",
              }],
              usageMetadata: {
                promptTokenCount: 8,
                candidatesTokenCount: 2,
                totalTokenCount: 10,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      },
    }, "gemini-2.0-flash");

    await runtime.doGenerate({
      prompt: [{
        role: "user",
        content: [
          { type: "text", text: "What is this?" },
          {
            type: "image",
            mediaType: "image/jpeg",
            url: "https://signed.example.com/web-app-screenshot.jpg",
          },
        ],
      }],
    });

    const requestBody = JSON.parse(readRequestBody(requestedInit) ?? "{}");
    assertEquals(requestBody.contents[0].parts, [
      { text: "What is this?" },
      {
        fileData: {
          mimeType: "image/jpeg",
          fileUri: "https://signed.example.com/web-app-screenshot.jpg",
        },
      },
    ]);
  });

  it("creates a Google-compatible language runtime without SDK helpers for stream", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const encoder = new TextEncoder();

    const runtime = createGoogleModelRuntime({
      apiKey: "test-google-key",
      baseURL: "https://example.google.test/v1beta",
      fetch: (input, init) => {
        requestedUrl = String(input);
        requestedInit = init;
        return Promise.resolve(
          new Response(
            ReadableStream.from([
              encoder.encode(
                'data: {"candidates":[{"content":{"role":"model","parts":[{"functionCall":{"id":"tool_weather","name":"weather","args":{"city":"Tokyo"}}}]}}]}\n\n',
              ),
              encoder.encode(
                'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":2,"totalTokenCount":10}}\n\n',
              ),
              encoder.encode("data: [DONE]\n\n"),
            ]),
            {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            },
          ),
        );
      },
    }, "gemini-2.0-flash");

    const result = await runtime.doStream({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Check weather" }],
      }],
      tools: [{
        type: "function",
        name: "weather",
        inputSchema: {
          type: "object",
          properties: {
            city: { type: "string" },
          },
        },
      }],
      maxOutputTokens: 64,
    });

    assertEquals(
      requestedUrl,
      "https://example.google.test/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse",
    );
    assertEquals(requestedInit?.method, "POST");
    const requestBody = typeof requestedInit?.body === "string"
      ? JSON.parse(requestedInit.body)
      : undefined;
    assertEquals(requestBody, {
      contents: [{
        role: "user",
        parts: [{ text: "Check weather" }],
      }],
      tools: [{
        functionDeclarations: [{
          name: "weather",
          parameters: {
            type: "object",
            properties: {
              city: { type: "string" },
            },
          },
        }],
      }],
      generationConfig: {
        maxOutputTokens: 64,
      },
    });

    const parts = await collectAsync(result.stream);
    assertEquals(parts, [
      {
        type: "tool-input-start",
        id: "tool_weather",
        toolName: "weather",
      },
      {
        type: "data-tool-call-status",
        data: {
          toolCallId: "tool_weather",
          status: "streaming_input",
        },
      },
      {
        type: "tool-input-delta",
        id: "tool_weather",
        delta: '{"city":"Tokyo"}',
      },
      {
        type: "tool-call",
        toolCallId: "tool_weather",
        toolName: "weather",
        input: '{"city":"Tokyo"}',
      },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "STOP" },
        usage: {
          inputTokens: 8,
          outputTokens: 2,
          totalTokens: 10,
        },
      },
    ]);
  });

  it("parses Google thought parts into reasoning events", async () => {
    const encoder = new TextEncoder();

    const runtime = createGoogleModelRuntime({
      apiKey: "test-google-key",
      baseURL: "https://example.google.test/v1beta",
      fetch: () =>
        Promise.resolve(
          new Response(
            ReadableStream.from([
              encoder.encode(
                'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Let me think.","thought":true}]}}]}\n\n',
              ),
              encoder.encode(
                'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Done."}]}}]}\n\n',
              ),
              encoder.encode(
                'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":2,"totalTokenCount":10}}\n\n',
              ),
              encoder.encode("data: [DONE]\n\n"),
            ]),
            {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            },
          ),
        ),
    }, "gemini-2.0-flash");

    const result = await runtime.doStream({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Think before answering" }],
      }],
    });

    const parts = await collectAsync(result.stream);
    assertEquals(parts, [
      {
        type: "reasoning-start",
        id: "reasoning-0",
      },
      {
        type: "reasoning-delta",
        id: "reasoning-0",
        delta: "Let me think.",
      },
      {
        type: "reasoning-end",
        id: "reasoning-0",
      },
      {
        type: "text-delta",
        delta: "Done.",
      },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "STOP" },
        usage: {
          inputTokens: 8,
          outputTokens: 2,
          totalTokens: 10,
        },
      },
    ]);
  });

  it("creates a Google embedding runtime without SDK helpers", async () => {
    const requests: Array<{ url: string; body: string | null; apiKey: string | null }> = [];

    const runtime = createGoogleEmbeddingRuntime({
      apiKey: "test-google-key",
      baseURL: "https://example.google.test/v1beta",
      fetch: (input, init) => {
        requests.push({
          url: String(input),
          body: readRequestBody(init),
          apiKey: readRequestHeader(init, "x-goog-api-key"),
        });

        const body = requests.length === 1
          ? {
            embeddings: [{ values: [10, 20] }],
            usageMetadata: { promptTokenCount: 3 },
          }
          : {
            embeddings: [{ values: [30, 40] }],
            usageMetadata: { promptTokenCount: 5 },
          };

        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      },
    }, "text-embedding-004");

    const result = await runtime.doEmbed({ values: ["alpha", "beta"] });

    assertEquals(requests, [
      {
        url: "https://example.google.test/v1beta/models/text-embedding-004:embedContent",
        body: JSON.stringify({
          content: { parts: [{ text: "alpha" }] },
        }),
        apiKey: "test-google-key",
      },
      {
        url: "https://example.google.test/v1beta/models/text-embedding-004:embedContent",
        body: JSON.stringify({
          content: { parts: [{ text: "beta" }] },
        }),
        apiKey: "test-google-key",
      },
    ]);
    assertEquals(result.embeddings, [[10, 20], [30, 40]]);
    assertEquals(result.usage, { tokens: 8 });
  });

  describe("reasoning / thinking request options", () => {
    const userPrompt = {
      role: "user",
      content: [{ type: "text", text: "Solve this" }],
    } as const;

    function createGoogleCaptureRuntime(modelId = "gemini-2.5-pro") {
      let capturedBody: Record<string, unknown> | null = null;
      const runtime = createGoogleModelRuntime({
        apiKey: "test-google-key",
        baseURL: "https://example.google.test/v1beta",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          capturedBody = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
                  finishReason: "STOP",
                }],
                usageMetadata: {
                  promptTokenCount: 1,
                  candidatesTokenCount: 1,
                  totalTokenCount: 2,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, modelId);
      return { runtime, getBody: () => capturedBody };
    }

    it("emits Google thinkingConfig when reasoning is enabled", async () => {
      const { runtime, getBody } = createGoogleCaptureRuntime();
      await runtime.doGenerate({
        prompt: [userPrompt],
        reasoning: { enabled: true, effort: "high" },
      });
      const body = getBody() as {
        generationConfig: { thinkingConfig: { includeThoughts: boolean; thinkingBudget: number } };
      };
      assertEquals(body.generationConfig.thinkingConfig, {
        includeThoughts: true,
        thinkingBudget: 8192,
      });
    });

    it("maps Google effort 'max' to thinkingBudget: -1 (dynamic)", async () => {
      const { runtime, getBody } = createGoogleCaptureRuntime();
      await runtime.doGenerate({
        prompt: [userPrompt],
        reasoning: { enabled: true, effort: "max" },
      });
      const body = getBody() as {
        generationConfig: { thinkingConfig: { thinkingBudget: number } };
      };
      assertEquals(body.generationConfig.thinkingConfig.thinkingBudget, -1);
    });

    it("honours Google explicit budgetTokens over effort", async () => {
      const { runtime, getBody } = createGoogleCaptureRuntime();
      await runtime.doGenerate({
        prompt: [userPrompt],
        reasoning: { enabled: true, effort: "low", budgetTokens: 4096 },
      });
      const body = getBody() as {
        generationConfig: { thinkingConfig: { thinkingBudget: number } };
      };
      assertEquals(body.generationConfig.thinkingConfig.thinkingBudget, 4096);
    });

    it("omits Google thinkingConfig when reasoning is disabled", async () => {
      const { runtime, getBody } = createGoogleCaptureRuntime();
      await runtime.doGenerate({ prompt: [userPrompt] });
      const body = getBody() as {
        generationConfig?: { thinkingConfig?: unknown };
      };
      assertEquals(body.generationConfig?.thinkingConfig, undefined);
    });
  });

  describe("cache usage reporting (cache_creation / cache_read / cached_tokens)", () => {
    const userPrompt = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
    } as const;

    it("surfaces Google cachedContentTokenCount as cacheReadInputTokens", async () => {
      const runtime = createGoogleModelRuntime({
        apiKey: "test-google-key",
        baseURL: "https://example.google.test/v1beta",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
                  finishReason: "STOP",
                }],
                usageMetadata: {
                  promptTokenCount: 123,
                  candidatesTokenCount: 45,
                  totalTokenCount: 168,
                  cachedContentTokenCount: 100,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "gemini-1.5-pro");

      const result = await runtime.doGenerate({ prompt: [userPrompt] });
      assertEquals(result.usage, {
        inputTokens: 123,
        outputTokens: 45,
        totalTokens: 168,
        cacheReadInputTokens: 100,
      });
    });

    it("leaves Google cache field undefined when cachedContentTokenCount is absent", async () => {
      const runtime = createGoogleModelRuntime({
        apiKey: "test-google-key",
        baseURL: "https://example.google.test/v1beta",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
                  finishReason: "STOP",
                }],
                usageMetadata: {
                  promptTokenCount: 8,
                  candidatesTokenCount: 2,
                  totalTokenCount: 10,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "gemini-1.5-pro");

      const result = await runtime.doGenerate({ prompt: [userPrompt] });
      assertEquals(result.usage, {
        inputTokens: 8,
        outputTokens: 2,
        totalTokens: 10,
      });
    });
  });

  describe("transient error classification (529 / 503 / 429 / Retry-After)", () => {
    const userPrompt = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
    } as const;

    function errorResponse(status: number, body: unknown, headers?: Record<string, string>) {
      return new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
      });
    }

    async function expectError<E extends Error>(
      promise: PromiseLike<unknown>,
      errorClass: new (...args: never[]) => E,
    ): Promise<E> {
      try {
        await promise;
        throw new Error("Expected promise to reject, but it resolved");
      } catch (err) {
        if (!(err instanceof errorClass)) {
          throw new Error(
            `Expected ${errorClass.name}, got ${err instanceof Error ? err.name : typeof err}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        return err;
      }
    }

    it("classifies Google 503 as ProviderOverloadedError (retryable)", async () => {
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: () =>
          Promise.resolve(errorResponse(503, { error: { code: 503, message: "Unavailable" } })),
      }, "gemini-1.5-pro");
      const err = await expectError(
        runtime.doGenerate({ prompt: [userPrompt] }),
        ProviderOverloadedError,
      );
      assertEquals(err.provider, "google");
      assertEquals(err.retryable, true);
    });

    it("classifies Google 429 RESOURCE_EXHAUSTED as ProviderQuotaError (non-retryable)", async () => {
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: () =>
          Promise.resolve(
            errorResponse(429, {
              error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Daily quota" },
            }),
          ),
      }, "gemini-1.5-pro");
      const err = await expectError(
        runtime.doGenerate({ prompt: [userPrompt] }),
        ProviderQuotaError,
      );
      assertEquals(err.retryable, false);
    });
  });

  describe("provider warnings (unsupported-setting drops)", () => {
    const userPrompt = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
    } as const;

    function okGoogleResponse() {
      return new Response(
        JSON.stringify({
          candidates: [{
            content: { role: "model", parts: [{ text: "ok" }] },
            finishReason: "STOP",
          }],
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 1,
            totalTokenCount: 2,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    function settings(result: { warnings?: unknown[] }): string[] {
      return (result.warnings ?? []).flatMap((w) => {
        const r = w as { setting?: string };
        return r.setting ? [r.setting] : [];
      });
    }

    it("warns on Google presencePenalty / frequencyPenalty drops", async () => {
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: () => Promise.resolve(okGoogleResponse()),
      }, "gemini-1.5-pro");
      const result = await runtime.doGenerate({
        prompt: [userPrompt],
        presencePenalty: 0.1,
        frequencyPenalty: 0.2,
      });
      const dropped = settings(result).sort();
      assertEquals(dropped, ["frequencyPenalty", "presencePenalty"]);
    });

    it("emits Google labels.user_id from userId when requestLabels is unset", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(okGoogleResponse());
        },
      }, "gemini-1.5-pro");
      await runtime.doGenerate({
        prompt: [userPrompt],
        userId: "user_42",
      });
      const body = captured as { labels: Record<string, string> } | null;
      assertEquals(body?.labels, { user_id: "user_42" });
    });

    it("Google requestLabels wins over userId-derived labels", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(okGoogleResponse());
        },
      }, "gemini-1.5-pro");
      await runtime.doGenerate({
        prompt: [userPrompt],
        userId: "user_42",
        requestLabels: { tenant: "acme", env: "prod" },
      });
      const body = captured as { labels: Record<string, string> } | null;
      assertEquals(body?.labels, { tenant: "acme", env: "prod" });
    });
  });

  describe("Anthropic thinking signature multi-turn replay", () => {
    it("normalizes Google toolChoice 'tools' multi-name allowlist", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
                  finishReason: "STOP",
                }],
                usageMetadata: {
                  promptTokenCount: 1,
                  candidatesTokenCount: 1,
                  totalTokenCount: 2,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, "gemini-1.5-pro");
      await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        toolChoice: { type: "tools", names: ["weather", "clock"] },
      });
      const body = captured as
        | { toolConfig: { functionCallingConfig: Record<string, unknown> } }
        | null;
      assertEquals(body!.toolConfig.functionCallingConfig, {
        mode: "ANY",
        allowedFunctionNames: ["weather", "clock"],
      });
    });

    it("normalizes Google toolChoice 'auto' / 'any' / 'none' explicit modes", async () => {
      async function modeFor(toolChoice: { type: string }) {
        let captured: Record<string, unknown> | null = null;
        const runtime = createGoogleModelRuntime({
          apiKey: "k",
          baseURL: "https://example.google.test/v1beta",
          fetch: (_input, init) => {
            const raw = readRequestBody(init);
            captured = raw ? JSON.parse(raw) : null;
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  candidates: [{
                    content: { role: "model", parts: [{ text: "ok" }] },
                    finishReason: "STOP",
                  }],
                  usageMetadata: {
                    promptTokenCount: 1,
                    candidatesTokenCount: 1,
                    totalTokenCount: 2,
                  },
                }),
                { status: 200, headers: { "content-type": "application/json" } },
              ),
            );
          },
        }, "gemini-1.5-pro");
        await runtime.doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
          toolChoice,
        });
        const body = captured as
          | { toolConfig: { functionCallingConfig: { mode: string } } }
          | null;
        return body!.toolConfig.functionCallingConfig.mode;
      }
      assertEquals(await modeFor({ type: "auto" }), "AUTO");
      assertEquals(await modeFor({ type: "any" }), "ANY");
      assertEquals(await modeFor({ type: "none" }), "NONE");
    });

    it("surfaces Google groundingMetadata on the generate result when present", async () => {
      const groundingMetadata = {
        webSearchQueries: ["latest news"],
        groundingChunks: [
          {
            web: {
              uri: "https://example.com/article",
              title: "Article title",
            },
          },
        ],
        groundingSupports: [{
          segment: { startIndex: 0, endIndex: 10, text: "ok" },
          groundingChunkIndices: [0],
          confidenceScores: [0.95],
        }],
      };
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
                  finishReason: "STOP",
                  groundingMetadata,
                }],
                usageMetadata: {
                  promptTokenCount: 1,
                  candidatesTokenCount: 1,
                  totalTokenCount: 2,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "gemini-2.5-pro");
      const result = await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      }) as { groundingMetadata?: Record<string, unknown> };
      assertEquals(result.groundingMetadata, groundingMetadata);
    });

    it("omits groundingMetadata when the candidate doesn't have any", async () => {
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
                  finishReason: "STOP",
                }],
                usageMetadata: {
                  promptTokenCount: 1,
                  candidatesTokenCount: 1,
                  totalTokenCount: 2,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "gemini-2.5-pro");
      const result = await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      }) as { groundingMetadata?: unknown };
      assertEquals("groundingMetadata" in result, false);
    });

    it("emits Google code_execution provider tool", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
                  finishReason: "STOP",
                }],
                usageMetadata: {
                  promptTokenCount: 1,
                  candidatesTokenCount: 1,
                  totalTokenCount: 2,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, "gemini-2.5-pro");
      await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Compute" }] }],
        tools: [{
          type: "provider",
          name: "code_execution",
          id: "google.code_execution",
          args: {},
        }],
      });
      const body = captured as { tools: Array<Record<string, unknown>> } | null;
      assertEquals(body!.tools, [{ codeExecution: {} }]);
    });

    it("emits Google google_search provider tool alongside function declarations", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
                  finishReason: "STOP",
                }],
                usageMetadata: {
                  promptTokenCount: 1,
                  candidatesTokenCount: 1,
                  totalTokenCount: 2,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, "gemini-2.5-pro");
      await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Search" }] }],
        tools: [
          {
            type: "function",
            name: "weather",
            inputSchema: { type: "object", properties: {} },
          },
          {
            type: "provider",
            name: "google_search",
            id: "google.google_search",
            args: {},
          },
        ],
      });
      const body = captured as { tools: Array<Record<string, unknown>> } | null;
      assertEquals(body!.tools.length, 2);
      assertEquals("functionDeclarations" in (body!.tools[0] as Record<string, unknown>), true);
      assertEquals(body!.tools[1], { googleSearch: {} });
    });

    it("emits Google safetySettings when googleSafetySettings is set", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
                  finishReason: "STOP",
                }],
                usageMetadata: {
                  promptTokenCount: 1,
                  candidatesTokenCount: 1,
                  totalTokenCount: 2,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, "gemini-1.5-pro");
      await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        googleSafetySettings: [
          { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
          { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
        ],
      });
      const body = captured as { safetySettings: unknown } | null;
      assertEquals(body!.safetySettings, [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      ]);
    });

    it("omits safetySettings when googleSafetySettings is unset or empty", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
                  finishReason: "STOP",
                }],
                usageMetadata: {
                  promptTokenCount: 1,
                  candidatesTokenCount: 1,
                  totalTokenCount: 2,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, "gemini-1.5-pro");
      await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        googleSafetySettings: [],
      });
      assertEquals("safetySettings" in (captured ?? {}), false);
    });

    it("emits Google cachedContent when googleCachedContent is set", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
                  finishReason: "STOP",
                }],
                usageMetadata: {
                  promptTokenCount: 1,
                  candidatesTokenCount: 1,
                  totalTokenCount: 2,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, "gemini-1.5-pro");
      await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        googleCachedContent: "cachedContents/abc123",
      });
      const body = captured as { cachedContent: string } | null;
      assertEquals(body!.cachedContent, "cachedContents/abc123");
    });

    it("omits cachedContent when googleCachedContent is unset", async () => {
      let captured: Record<string, unknown> | null = null;
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: (_input, init) => {
          const raw = readRequestBody(init);
          captured = raw ? JSON.parse(raw) : null;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                candidates: [{
                  content: { role: "model", parts: [{ text: "ok" }] },
                  finishReason: "STOP",
                }],
                usageMetadata: {
                  promptTokenCount: 1,
                  candidatesTokenCount: 1,
                  totalTokenCount: 2,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        },
      }, "gemini-1.5-pro");
      await runtime.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      });
      assertEquals("cachedContent" in (captured ?? {}), false);
    });
  });
});
