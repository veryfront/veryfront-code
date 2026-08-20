import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects } from "@std/assert";

import {
  ProviderOverloadedError,
  ProviderQuotaError,
  ProviderRateLimitError,
  ProviderRequestError,
} from "veryfront/provider/shared";

import { createGoogleEmbeddingRuntime, createGoogleModelRuntime } from "./google-provider.ts";
import { buildGoogleGenerateContentRequest } from "./google-request-builder.ts";
import { MAX_GOOGLE_PROVIDER_METADATA_BYTES } from "./google-thought-signatures.ts";

async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

async function waitWithin<T>(promise: Promise<T>, timeoutMs = 500): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
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

function readRequestSignal(init: RequestInit | undefined): AbortSignal | undefined {
  if (!init || !("signal" in init) || !(init.signal instanceof AbortSignal)) {
    return undefined;
  }
  return init.signal;
}

function googleJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function expectInvalidSuccessfulResponse(
  promise: PromiseLike<unknown>,
  providerLabel: string,
  issue: string,
  forbiddenText?: string,
): Promise<ProviderRequestError> {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof ProviderRequestError)) {
      throw new Error(
        `Expected ProviderRequestError, got ${
          error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        }`,
      );
    }
    assertEquals(error.provider, "google");
    assertEquals(error.status, 200);
    assertEquals(error.retryable, false);
    assertEquals(
      error.message,
      `${providerLabel} request failed: invalid successful response (${issue})`,
    );
    assertEquals(error.responseBody, undefined);
    if (forbiddenText !== undefined) {
      assertEquals(error.message.includes(forbiddenText), false);
    }
    return error;
  }
  throw new Error("Expected ProviderRequestError, but the request resolved");
}

describe("ext-llm-google/google-provider", () => {
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

  it("emits Gemini responseMimeType and responseSchema when responseFormat is structured", async () => {
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
                content: { role: "model", parts: [{ text: "{}" }] },
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
    }, "gemini-2.0-flash");

    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    };
    await runtime.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      responseFormat: { type: "json_schema", name: "Person", schema, strict: true },
    });

    const requestBody = JSON.parse(readRequestBody(requestedInit) ?? "{}");
    assertEquals(requestBody.generationConfig.responseMimeType, "application/json");
    assertEquals(requestBody.generationConfig.responseSchema, schema);
  });

  it("advertises structured output support", () => {
    const runtime = createGoogleModelRuntime({
      apiKey: "test-google-key",
      baseURL: "https://example.google.test/v1beta",
      fetch: () => Promise.reject(new Error("not called")),
    }, "gemini-2.0-flash");
    assertEquals(runtime.runtimeCapabilities?.structuredOutput, true);
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

  it("aborts the request and cancels a pending upstream body when the consumer cancels", async () => {
    const consumerReason = new DOMException("Consumer stopped Google stream", "AbortError");
    let requestSignal: AbortSignal | undefined;
    let upstreamCancelReason: unknown;
    let notifyUpstreamPull!: () => void;
    const upstreamPullStarted = new Promise<void>((resolve) => {
      notifyUpstreamPull = resolve;
    });
    let notifyUpstreamCanceled!: () => void;
    const upstreamCanceled = new Promise<void>((resolve) => {
      notifyUpstreamCanceled = resolve;
    });
    let pullNotified = false;
    const body = new ReadableStream<Uint8Array>({
      pull() {
        if (!pullNotified) {
          pullNotified = true;
          notifyUpstreamPull();
        }
        return new Promise<void>(() => {});
      },
      cancel(reason) {
        upstreamCancelReason = reason;
        notifyUpstreamCanceled();
      },
    });

    const runtime = createGoogleModelRuntime({
      apiKey: "test-google-key",
      baseURL: "https://example.google.test/v1beta",
      fetch: (_input, init) => {
        requestSignal = readRequestSignal(init);
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
        );
      },
    }, "gemini-3-flash");

    const result = await runtime.doStream({
      prompt: [{
        role: "user",
        content: [{ type: "text", text: "Wait for an answer" }],
      }],
    });
    const reader = result.stream.getReader();
    const pendingRead = reader.read();
    await waitWithin(upstreamPullStarted);

    await waitWithin(reader.cancel(consumerReason));
    await waitWithin(upstreamCanceled);

    assertEquals(requestSignal?.aborted, true);
    assertEquals(requestSignal?.reason === consumerReason, true);
    assertEquals(upstreamCancelReason === consumerReason, true);
    assertEquals((await waitWithin(pendingRead)).done, true);
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

  describe("successful response validation", () => {
    const userPrompt = {
      role: "user",
      content: [{ type: "text", text: "Hi" }],
    } as const;

    it("rejects an empty generation envelope without leaking its payload", async () => {
      const providerLabel = "google-test";
      const secret = "private-upstream-diagnostic";
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        name: providerLabel,
        fetch: () =>
          Promise.resolve(
            googleJsonResponse({
              candidates: [],
              upstreamDiagnostic: secret,
            }),
          ),
      }, "gemini-2.0-flash");

      await expectInvalidSuccessfulResponse(
        runtime.doGenerate({ prompt: [userPrompt] }),
        providerLabel,
        "candidates array missing or empty",
        secret,
      );
    });

    it("distinguishes a non-array candidates field from an empty candidates array", async () => {
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        fetch: () => Promise.resolve(googleJsonResponse({ candidates: {} })),
      }, "gemini-2.0-flash");

      await expectInvalidSuccessfulResponse(
        runtime.doGenerate({ prompt: [userPrompt] }),
        "google",
        "candidates was not an array",
      );
    });

    it("rejects malformed generation candidate content", async () => {
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        fetch: () =>
          Promise.resolve(
            googleJsonResponse({
              candidates: [{
                content: { parts: [null] },
                finishReason: "STOP",
              }],
            }),
          ),
      }, "gemini-2.0-flash");

      await expectInvalidSuccessfulResponse(
        runtime.doGenerate({ prompt: [userPrompt] }),
        "google",
        "candidate content part was not an object",
      );
    });

    it("rejects ambiguous successful responses with multiple candidates", async () => {
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        fetch: () =>
          Promise.resolve(
            googleJsonResponse({
              candidates: [
                {
                  content: { parts: [{ text: "first" }] },
                  finishReason: "STOP",
                },
                {
                  content: { parts: [{ text: "second" }] },
                  finishReason: "STOP",
                },
              ],
            }),
          ),
      }, "gemini-2.0-flash");

      await expectInvalidSuccessfulResponse(
        runtime.doGenerate({ prompt: [userPrompt] }),
        "google",
        "generation response contained multiple candidates",
      );
    });

    it("preserves signed thought text and parallel function-call parts", async () => {
      const rawAssistantParts = [
        {
          text: "Private chain of thought.",
          thought: true,
          thoughtSignature: "thought-signature",
        },
        {
          functionCall: {
            id: "tool_paris",
            name: "weather",
            args: { city: "Paris" },
          },
          thoughtSignature: "parallel-call-signature",
        },
        {
          functionCall: {
            id: "tool_london",
            name: "weather",
            args: { city: "London" },
          },
        },
      ];
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        fetch: () =>
          Promise.resolve(
            googleJsonResponse({
              candidates: [{
                content: { role: "model", parts: rawAssistantParts },
                finishReason: "STOP",
              }],
            }),
          ),
      }, "gemini-3-pro");

      assertEquals(await runtime.doGenerate({ prompt: [userPrompt] }), {
        content: [
          {
            type: "reasoning",
            text: "Private chain of thought.",
            signature: "thought-signature",
          },
          {
            type: "tool-call",
            toolCallId: "tool_paris",
            toolName: "weather",
            input: '{"city":"Paris"}',
          },
          {
            type: "tool-call",
            toolCallId: "tool_london",
            toolName: "weather",
            input: '{"city":"London"}',
          },
        ],
        finishReason: { unified: "stop", raw: "STOP" },
        providerMetadata: {
          google: { rawAssistantParts },
        },
      });
    });

    it("maps direct replay metadata budget failures to the typed response error", async () => {
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        fetch: () =>
          Promise.resolve(
            googleJsonResponse({
              candidates: [{
                content: {
                  role: "model",
                  parts: [{
                    text: "x".repeat(MAX_GOOGLE_PROVIDER_METADATA_BYTES),
                    thoughtSignature: "oversized-signed-part",
                  }],
                },
                finishReason: "STOP",
              }],
            }),
          ),
      }, "gemini-3-pro");

      await expectInvalidSuccessfulResponse(
        runtime.doGenerate({ prompt: [userPrompt] }),
        "google",
        "provider metadata could not be retained safely",
      );
    });

    it("normalizes correlated Google code execution and preserves every raw part for replay", async () => {
      const rawAssistantParts = [
        {
          executableCode: {
            id: "code_1",
            language: "PYTHON",
            code: "print(6 * 7)",
          },
          thoughtSignature: "code-signature",
        },
        {
          codeExecutionResult: {
            id: "code_1",
            outcome: "OUTCOME_OK",
            output: "42\n",
          },
        },
        { text: "The answer is 42." },
      ];
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        fetch: () =>
          Promise.resolve(
            googleJsonResponse({
              candidates: [{
                content: { role: "model", parts: rawAssistantParts },
                finishReason: "STOP",
              }],
            }),
          ),
      }, "gemini-3-pro");

      assertEquals(await runtime.doGenerate({ prompt: [userPrompt] }), {
        content: [
          {
            type: "tool-call",
            toolCallId: "code_1",
            toolName: "code_execution",
            input: '{"language":"PYTHON","code":"print(6 * 7)"}',
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: "code_1",
            toolName: "code_execution",
            result: { outcome: "OUTCOME_OK", output: "42\n" },
            providerExecuted: true,
          },
          { type: "text", text: "The answer is 42." },
        ],
        finishReason: { unified: "stop", raw: "STOP" },
        providerMetadata: {
          google: { rawAssistantParts },
        },
      });
    });

    it("synthesizes stable ids and marks failed code execution outcomes as errors", async () => {
      for (
        const outcome of [
          "OUTCOME_FAILED",
          "OUTCOME_DEADLINE_EXCEEDED",
        ] as const
      ) {
        const rawAssistantParts = [
          {
            executableCode: {
              language: "PYTHON",
              code: "raise RuntimeError('boom')",
            },
          },
          {
            codeExecutionResult: {
              outcome,
              output: "boom",
            },
          },
        ];
        const runtime = createGoogleModelRuntime({
          apiKey: "k",
          fetch: () =>
            Promise.resolve(
              googleJsonResponse({
                candidates: [{
                  content: { role: "model", parts: rawAssistantParts },
                  finishReason: "STOP",
                }],
              }),
            ),
        }, "gemini-3-pro");

        assertEquals(await runtime.doGenerate({ prompt: [userPrompt] }), {
          content: [
            {
              type: "tool-call",
              toolCallId: "google-code-execution-0",
              toolName: "code_execution",
              input: '{"language":"PYTHON","code":"raise RuntimeError(\'boom\')"}',
              providerExecuted: true,
            },
            {
              type: "tool-result",
              toolCallId: "google-code-execution-0",
              toolName: "code_execution",
              result: { outcome, output: "boom" },
              isError: true,
              providerExecuted: true,
            },
          ],
          finishReason: { unified: "stop", raw: "STOP" },
          providerMetadata: {
            google: { rawAssistantParts },
          },
        });
      }
    });

    it("fails closed on malformed, unpaired, and unsupported Google output parts", async () => {
      const malformedCases = [
        {
          parts: [{
            executableCode: { id: "code_1", language: "JAVASCRIPT", code: "1 + 1" },
          }],
          issue: "candidate executable code was malformed",
        },
        {
          parts: [{
            executableCode: { id: "code_1", language: "PYTHON", code: "1 + 1" },
          }, {
            codeExecutionResult: {
              id: "code_2",
              outcome: "OUTCOME_OK",
              output: "2",
            },
          }],
          issue: "candidate code execution result did not match executable code",
        },
        {
          parts: [{
            executableCode: { id: "code_1", language: "PYTHON", code: "1 + 1" },
          }],
          issue: "candidate executable code had no matching execution result",
        },
        {
          parts: [{
            executableCode: { id: "code_1", language: "PYTHON", code: "1 + 1" },
          }, {
            codeExecutionResult: {
              id: "code_1",
              outcome: "OUTCOME_UNSPECIFIED",
            },
          }],
          issue: "candidate code execution result was malformed",
        },
        {
          parts: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }],
          issue: "candidate part contained an unsupported data field",
        },
        {
          parts: [{ futureServerTool: { id: "unknown" } }],
          issue: "candidate part contained an unsupported data field",
        },
      ];

      for (const { parts, issue } of malformedCases) {
        const runtime = createGoogleModelRuntime({
          apiKey: "k",
          fetch: () =>
            Promise.resolve(
              googleJsonResponse({
                candidates: [{
                  content: { role: "model", parts },
                  finishReason: "STOP",
                }],
              }),
            ),
        }, "gemini-3-pro");

        await assertRejects(
          () => Promise.resolve(runtime.doGenerate({ prompt: [userPrompt] })),
          ProviderRequestError,
          issue,
        );
      }
    });

    it("rejects malformed thought signatures and non-object function arguments", async () => {
      const malformedCases = [
        {
          part: { text: "answer", thoughtSignature: 42 },
          issue: "candidate thought signature was malformed",
        },
        {
          part: {
            text: "answer",
            functionCall: { id: "tool_1", name: "lookup", args: {} },
          },
          issue: "candidate part contained multiple data fields",
        },
        {
          part: {
            functionCall: { id: "tool_1", name: "lookup", args: ["not", "an", "object"] },
          },
          issue: "candidate function call arguments were not an object",
        },
        {
          part: { functionCall: { id: "tool_1", name: "lookup", args: null } },
          issue: "candidate function call arguments were not an object",
        },
      ];

      for (const { part, issue } of malformedCases) {
        const runtime = createGoogleModelRuntime({
          apiKey: "k",
          fetch: () =>
            Promise.resolve(
              googleJsonResponse({
                candidates: [{
                  content: { role: "model", parts: [part] },
                  finishReason: "STOP",
                }],
              }),
            ),
        }, "gemini-3-pro");

        await assertRejects(
          () => Promise.resolve(runtime.doGenerate({ prompt: [userPrompt] })),
          ProviderRequestError,
          issue,
        );
      }
    });

    it("treats an omitted function call args field as empty arguments", async () => {
      const rawAssistantParts = [{
        functionCall: { id: "tool_1", name: "ping" },
        thoughtSignature: "signed-zero-argument-call",
      }];
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        fetch: () =>
          Promise.resolve(
            googleJsonResponse({
              candidates: [{
                content: {
                  role: "model",
                  parts: rawAssistantParts,
                },
                finishReason: "STOP",
              }],
            }),
          ),
      }, "gemini-3-pro");

      const result = await runtime.doGenerate({ prompt: [userPrompt] });

      assertEquals(result.content, [{
        type: "tool-call",
        toolCallId: "tool_1",
        toolName: "ping",
        input: "{}",
      }]);
      assertEquals(result.providerMetadata, {
        google: { rawAssistantParts },
      });
      if (!result.content) {
        throw new Error("Expected Google tool-call content");
      }

      const continuation = buildGoogleGenerateContentRequest(
        "google",
        {
          prompt: [{
            role: "assistant",
            content: result.content,
            providerMetadata: result.providerMetadata,
          }],
        },
        { push() {}, drain: () => [] },
      );
      assertEquals(continuation.contents, [{
        role: "model",
        parts: rawAssistantParts,
      }]);
    });

    it("rejects a generation candidate with no supported output", async () => {
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        fetch: () =>
          Promise.resolve(
            googleJsonResponse({
              candidates: [{
                content: { parts: [] },
                finishReason: "STOP",
              }],
            }),
          ),
      }, "gemini-2.0-flash");

      await expectInvalidSuccessfulResponse(
        runtime.doGenerate({ prompt: [userPrompt] }),
        "google",
        "candidate contained no supported output content",
      );
    });

    it("preserves a prompt-level content-filter response without candidates", async () => {
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        fetch: () =>
          Promise.resolve(
            googleJsonResponse({
              candidates: [],
              promptFeedback: { blockReason: "PROHIBITED_CONTENT" },
            }),
          ),
      }, "gemini-2.0-flash");

      assertEquals(
        await runtime.doGenerate({ prompt: [userPrompt] }),
        {
          content: [],
          finishReason: {
            unified: "content-filter",
            raw: "PROHIBITED_CONTENT",
          },
        },
      );
    });

    it("preserves a finish-only content-filter response", async () => {
      const contentFilterReasons = [
        "SAFETY",
        "RECITATION",
        "LANGUAGE",
        "BLOCKLIST",
        "PROHIBITED_CONTENT",
        "SPII",
        "IMAGE_SAFETY",
        "IMAGE_PROHIBITED_CONTENT",
        "IMAGE_RECITATION",
        "ESCALATION",
      ];

      for (const finishReason of contentFilterReasons) {
        const runtime = createGoogleModelRuntime({
          apiKey: "k",
          fetch: () =>
            Promise.resolve(
              googleJsonResponse({
                candidates: [{
                  content: { role: "model" },
                  finishReason,
                }],
              }),
            ),
        }, "gemini-2.0-flash");

        assertEquals(
          await runtime.doGenerate({ prompt: [userPrompt] }),
          {
            content: [],
            finishReason: { unified: "content-filter", raw: finishReason },
          },
        );
      }
    });

    it("normalizes successful generation usage through the shared usage invariant", async () => {
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        fetch: () =>
          Promise.resolve(
            googleJsonResponse({
              candidates: [{
                content: { parts: [{ text: "ok" }] },
                finishReason: "STOP",
              }],
              usageMetadata: {
                promptTokenCount: 4,
                candidatesTokenCount: 3,
                totalTokenCount: 1,
                cachedContentTokenCount: -2,
              },
            }),
          ),
      }, "gemini-2.0-flash");

      const result = await runtime.doGenerate({ prompt: [userPrompt] });
      assertEquals(result.usage, {
        inputTokens: 4,
        outputTokens: 3,
        totalTokens: 7,
      });
    });

    it("rejects a malformed embedding envelope without leaking its payload", async () => {
      const providerLabel = "google-embedding-test";
      const secret = "private-embedding-diagnostic";
      const runtime = createGoogleEmbeddingRuntime({
        apiKey: "k",
        name: providerLabel,
        fetch: () =>
          Promise.resolve(
            googleJsonResponse({
              embeddings: [],
              upstreamDiagnostic: secret,
            }),
          ),
      }, "text-embedding-004");

      await expectInvalidSuccessfulResponse(
        runtime.doEmbed({ values: ["alpha"] }),
        providerLabel,
        "embedding response must contain exactly one embedding",
        secret,
      );
    });

    it("rejects an empty or non-finite embedding vector", async () => {
      const malformedBodies = [
        JSON.stringify({ embedding: { values: [] } }),
        '{"embedding":{"values":[1,1e309]}}',
      ];

      for (const body of malformedBodies) {
        const runtime = createGoogleEmbeddingRuntime({
          apiKey: "k",
          fetch: () =>
            Promise.resolve(
              new Response(body, {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
            ),
        }, "text-embedding-004");

        await expectInvalidSuccessfulResponse(
          runtime.doEmbed({ values: ["alpha"] }),
          "google",
          "embedding vector missing or invalid",
        );
      }
    });

    it("rejects inconsistent embedding dimensions across batched inputs", async () => {
      let requestCount = 0;
      const runtime = createGoogleEmbeddingRuntime({
        apiKey: "k",
        fetch: () => {
          requestCount += 1;
          return Promise.resolve(
            googleJsonResponse({
              embedding: {
                values: requestCount === 1 ? [1, 2] : [3],
              },
              usageMetadata: { promptTokenCount: 1 },
            }),
          );
        },
      }, "text-embedding-004");

      await expectInvalidSuccessfulResponse(
        runtime.doEmbed({ values: ["alpha", "beta"] }),
        "google",
        "embedding vectors had inconsistent dimensions",
      );
    });

    it("omits aggregate embedding usage when any response lacks a valid token count", async () => {
      let requestCount = 0;
      const runtime = createGoogleEmbeddingRuntime({
        apiKey: "k",
        fetch: () => {
          requestCount += 1;
          return Promise.resolve(
            googleJsonResponse({
              embedding: { values: requestCount === 1 ? [1, 2] : [3, 4] },
              usageMetadata: requestCount === 1
                ? { promptTokenCount: 3 }
                : { promptTokenCount: Number.MAX_SAFE_INTEGER + 1 },
            }),
          );
        },
      }, "text-embedding-004");

      const result = await runtime.doEmbed({ values: ["alpha", "beta"] });
      assertEquals(result.embeddings, [[1, 2], [3, 4]]);
      assertEquals("usage" in result, false);
    });

    it("aborts a never-settling embedding sibling after the first response fails validation", async () => {
      let requestCount = 0;
      let siblingSignal: AbortSignal | undefined;
      let siblingAbortReason: unknown;
      let notifySiblingStarted!: () => void;
      const siblingStarted = new Promise<void>((resolve) => {
        notifySiblingStarted = resolve;
      });
      let notifySiblingAborted!: () => void;
      const siblingAborted = new Promise<void>((resolve) => {
        notifySiblingAborted = resolve;
      });

      const runtime = createGoogleEmbeddingRuntime({
        apiKey: "k",
        fetch: (_input, init) => {
          requestCount += 1;
          if (requestCount === 1) {
            return Promise.resolve(googleJsonResponse({ embedding: { values: [] } }));
          }

          siblingSignal = readRequestSignal(init);
          notifySiblingStarted();
          return new Promise<Response>((_resolve, reject) => {
            const onAbort = () => {
              siblingAbortReason = siblingSignal?.reason;
              notifySiblingAborted();
              reject(siblingSignal?.reason);
            };
            if (siblingSignal?.aborted) {
              onAbort();
            } else {
              siblingSignal?.addEventListener("abort", onAbort, { once: true });
            }
          });
        },
      }, "text-embedding-004");

      const embeddingPromise = Promise.resolve(
        runtime.doEmbed({ values: ["invalid", "never settles"] }),
      );
      await waitWithin(siblingStarted);
      const error = await assertRejects(
        () => embeddingPromise,
        ProviderRequestError,
        "embedding vector missing or invalid",
      );
      await waitWithin(siblingAborted);

      assertEquals(siblingSignal?.aborted, true);
      assertEquals(siblingAbortReason === error, true);
    });

    it("preserves the caller abort reason across embedding fan-out", async () => {
      const abortController = new AbortController();
      const callerReason = new DOMException("Caller stopped embeddings", "AbortError");
      const requestSignals: AbortSignal[] = [];
      let notifyRequestsStarted!: () => void;
      const requestsStarted = new Promise<void>((resolve) => {
        notifyRequestsStarted = resolve;
      });

      const runtime = createGoogleEmbeddingRuntime({
        apiKey: "k",
        fetch: (_input, init) => {
          const signal = readRequestSignal(init);
          if (signal) {
            requestSignals.push(signal);
            if (requestSignals.length === 2) {
              notifyRequestsStarted();
            }
          }
          return new Promise<Response>((_resolve, reject) => {
            const onAbort = () => reject(signal?.reason);
            if (signal?.aborted) {
              onAbort();
            } else {
              signal?.addEventListener("abort", onAbort, { once: true });
            }
          });
        },
      }, "text-embedding-004");

      const embeddingPromise = Promise.resolve(
        runtime.doEmbed({
          values: ["alpha", "beta"],
          abortSignal: abortController.signal,
        }),
      );
      await waitWithin(requestsStarted);
      abortController.abort(callerReason);
      const error = await assertRejects(() => embeddingPromise, DOMException);

      assertEquals(error === callerReason, true);
      assertEquals(requestSignals.every((signal) => signal.reason === callerReason), true);
    });
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
        cachedInputTokens: 100,
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

    it("classifies a Google 429 RESOURCE_EXHAUSTED with no retry delay as ProviderQuotaError (non-retryable)", async () => {
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

    it("classifies a Google 429 RESOURCE_EXHAUSTED carrying a retry delay as a retryable rate limit", async () => {
      // A per-minute limit uses the same status as the daily quota; the
      // RetryInfo delay is what says the request can succeed again shortly.
      const runtime = createGoogleModelRuntime({
        apiKey: "k",
        baseURL: "https://example.google.test/v1beta",
        fetch: () =>
          Promise.resolve(
            errorResponse(429, {
              error: {
                code: 429,
                status: "RESOURCE_EXHAUSTED",
                message: "Requests per minute exceeded",
                details: [
                  { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "23s" },
                ],
              },
            }),
          ),
      }, "gemini-1.5-pro");
      const err = await expectError(
        runtime.doGenerate({ prompt: [userPrompt] }),
        ProviderRateLimitError,
      );
      assertEquals(err.retryable, true);
      assertEquals(err.retryAfterMs, 23_000);
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

  describe("Google provider-specific request options", () => {
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
      }) as {
        groundingMetadata?: Record<string, unknown>;
        providerMetadata?: Record<string, unknown>;
      };
      assertEquals(result.groundingMetadata, groundingMetadata);
      assertEquals(result.providerMetadata, {
        google: { groundingMetadata },
      });
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

    it("rejects malformed Google grounding metadata", async () => {
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
                  groundingMetadata: [],
                }],
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          ),
      }, "gemini-2.5-pro");

      await assertRejects(
        () =>
          runtime.doGenerate({
            prompt: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
          }),
        ProviderRequestError,
        "candidate grounding metadata was malformed",
      );
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
