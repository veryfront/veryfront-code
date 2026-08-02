import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ProviderRequestError } from "veryfront/provider/shared";
import {
  extractGoogleUsage,
  MAX_GOOGLE_RETAINED_STATE_BYTES,
  MAX_GOOGLE_RETAINED_STATE_ITEMS,
  MAX_GOOGLE_SSE_BUFFER_CODE_UNITS,
  MAX_GOOGLE_SSE_CHUNK_BYTES,
  streamGoogleCompatibleParts,
} from "./google-stream.ts";
import { buildGoogleGenerateContentRequest } from "./google-request-builder.ts";

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function streamFromBytes(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

async function collectParts(stream: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const parts: unknown[] = [];
  for await (const part of streamGoogleCompatibleParts(stream)) {
    parts.push(part);
  }
  return parts;
}

function data(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\r\n\r\n`;
}

function utf8StringWithByteLength(byteLength: number): string {
  return `${"é".repeat(Math.floor(byteLength / 2))}${byteLength % 2 === 0 ? "" : "x"}`;
}

function createWarningCollector() {
  const warnings: Array<{
    type: "unsupported-setting" | "other";
    setting?: string;
    details?: string;
    provider: string;
  }> = [];

  return {
    push(warning: (typeof warnings)[number]) {
      warnings.push(warning);
    },
    drain() {
      return warnings.slice();
    },
  };
}

describe("ext-llm-google/google-stream", () => {
  it("preserves thought, text, tool-call, usage, and finish events", async () => {
    const parts = await collectParts(streamFromText([
      data({
        candidates: [{
          content: {
            role: "model",
            parts: [{ text: "Think", thought: true }],
          },
        }],
      }),
      data({
        candidates: [{
          content: {
            role: "model",
            parts: [{ text: "Done." }],
          },
        }],
      }),
      data({
        candidates: [{
          content: {
            role: "model",
            parts: [{ functionCall: { id: "tool_1", name: "lookup", args: { id: "abc" } } }],
          },
        }],
      }),
      data({
        candidates: [{
          content: {
            role: "model",
            parts: [{ functionCall: { id: "tool_1", name: "lookup", args: { id: "abc" } } }],
          },
        }],
      }),
      data({
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 7,
          totalTokenCount: 12,
          cachedContentTokenCount: 3,
          thoughtsTokenCount: 2,
        },
      }),
      "data: [DONE]\r\n\r\n",
    ].join("")));

    assertEquals(parts, [
      { type: "reasoning-start", id: "reasoning-0" },
      { type: "reasoning-delta", id: "reasoning-0", delta: "Think" },
      { type: "reasoning-end", id: "reasoning-0" },
      { type: "text-delta", delta: "Done." },
      { type: "tool-input-start", id: "tool_1", toolName: "lookup" },
      { type: "tool-input-delta", id: "tool_1", delta: '{"id":"abc"}' },
      {
        type: "tool-call",
        toolCallId: "tool_1",
        toolName: "lookup",
        input: '{"id":"abc"}',
      },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "STOP" },
        usage: {
          inputTokens: 5,
          outputTokens: 7,
          totalTokens: 12,
          cacheReadInputTokens: 3,
          cachedInputTokens: 3,
          reasoningTokens: 2,
        },
      },
    ]);
  });

  it("sanitizes Google usage counters at the response boundary", () => {
    assertEquals(
      extractGoogleUsage({
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: -1,
          totalTokenCount: Number.POSITIVE_INFINITY,
          cachedContentTokenCount: 3,
          thoughtsTokenCount: 1.5,
        },
      }),
      {
        inputTokens: 5,
        outputTokens: undefined,
        totalTokens: undefined,
        cacheReadInputTokens: 3,
      },
    );
    assertEquals(
      extractGoogleUsage({
        usageMetadata: {
          promptTokenCount: Number.NaN,
          candidatesTokenCount: -1,
          totalTokenCount: Number.MAX_SAFE_INTEGER + 1,
          cachedContentTokenCount: 0.5,
          thoughtsTokenCount: Number.NEGATIVE_INFINITY,
        },
      }),
      undefined,
    );
  });

  it("accumulates ordered Google Search grounding metadata deltas", async () => {
    const initialGroundingMetadata = {
      webSearchQueries: ["first query"],
      groundingChunks: [{
        web: {
          uri: "https://example.test/first",
          title: "First source",
        },
      }],
      groundingSupports: [{
        segment: { startIndex: 0, endIndex: 8 },
        groundingChunkIndices: [0],
      }],
    };
    const finalGroundingMetadata = {
      webSearchQueries: ["second query"],
      groundingChunks: [{
        web: {
          uri: "https://example.test/second",
          title: "Second source",
        },
      }],
      groundingSupports: [{
        segment: { startIndex: 9, endIndex: 16 },
        groundingChunkIndices: [1],
      }],
    };
    const mergedGroundingMetadata = {
      webSearchQueries: ["first query", "second query"],
      groundingChunks: [
        initialGroundingMetadata.groundingChunks[0],
        finalGroundingMetadata.groundingChunks[0],
      ],
      groundingSupports: [
        initialGroundingMetadata.groundingSupports[0],
        finalGroundingMetadata.groundingSupports[0],
      ],
    };
    const parts = await collectParts(streamFromText([
      data({
        candidates: [{
          content: { parts: [{ text: "Grounded answer." }] },
          groundingMetadata: initialGroundingMetadata,
        }],
      }),
      data({
        candidates: [{
          finishReason: "STOP",
          groundingMetadata: finalGroundingMetadata,
        }],
      }),
      "data: [DONE]\r\n\r\n",
    ].join("")));

    assertEquals(parts, [
      { type: "text-delta", delta: "Grounded answer." },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "STOP" },
        providerMetadata: {
          google: {
            groundingMetadata: mergedGroundingMetadata,
          },
        },
      },
    ]);

    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          candidates: [{
            content: { parts: [{ text: "Do not accept malformed metadata." }] },
            finishReason: "STOP",
            groundingMetadata: [],
          }],
        }))),
      ProviderRequestError,
      "candidate grounding metadata was malformed",
    );
  });

  it("preserves signed thought and parallel function-call parts for exact replay", async () => {
    const signedThought = {
      text: "Think",
      thought: true,
      thoughtSignature: "thought-signature",
    };
    const signedToolCall = {
      functionCall: {
        id: "tool_paris",
        name: "weather",
        args: { city: "Paris" },
      },
      thoughtSignature: "parallel-call-signature",
    };
    const unsignedToolCall = {
      functionCall: {
        id: "tool_london",
        name: "weather",
        args: { city: "London" },
      },
    };
    const parts = await collectParts(streamFromText([
      data({
        candidates: [{
          content: { role: "model", parts: [signedThought] },
        }],
      }),
      data({
        candidates: [{
          content: { role: "model", parts: [signedToolCall, unsignedToolCall] },
        }],
      }),
      data({ candidates: [{ finishReason: "STOP" }] }),
      "data: [DONE]\r\n\r\n",
    ].join("")));

    assertEquals(parts, [
      { type: "reasoning-start", id: "reasoning-0" },
      { type: "reasoning-delta", id: "reasoning-0", delta: "Think" },
      {
        type: "reasoning-end",
        id: "reasoning-0",
        signature: "thought-signature",
      },
      { type: "tool-input-start", id: "tool_paris", toolName: "weather" },
      { type: "tool-input-delta", id: "tool_paris", delta: '{"city":"Paris"}' },
      {
        type: "tool-call",
        toolCallId: "tool_paris",
        toolName: "weather",
        input: '{"city":"Paris"}',
      },
      { type: "tool-input-start", id: "tool_london", toolName: "weather" },
      { type: "tool-input-delta", id: "tool_london", delta: '{"city":"London"}' },
      {
        type: "tool-call",
        toolCallId: "tool_london",
        toolName: "weather",
        input: '{"city":"London"}',
      },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "STOP" },
        providerMetadata: {
          google: {
            rawAssistantParts: [signedThought, signedToolCall, unsignedToolCall],
          },
        },
      },
    ]);
  });

  it("keeps anonymous function ids stable from stream output through exact continuation replay", async () => {
    const signedThought = {
      text: "Think",
      thought: true,
      thoughtSignature: "thought-signature",
    };
    const anonymousFunctionCall = {
      functionCall: {
        name: "lookup",
        args: { city: "Paris" },
      },
    };
    const executableCode = {
      executableCode: {
        id: "tool-2",
        language: "PYTHON",
        code: "print('ok')",
      },
    };
    const executionResult = {
      codeExecutionResult: {
        id: "tool-2",
        outcome: "OUTCOME_OK",
        output: "ok\n",
      },
    };
    const rawAssistantParts = [
      signedThought,
      anonymousFunctionCall,
      executableCode,
      executionResult,
    ];
    const parts = await collectParts(streamFromText([
      data({
        candidates: [{
          content: { role: "model", parts: rawAssistantParts },
          finishReason: "STOP",
        }],
      }),
      "data: [DONE]\r\n\r\n",
    ].join("")));

    assertEquals(
      parts.filter((part) =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "tool-call"
      ),
      [{
        type: "tool-call",
        toolCallId: "tool-1",
        toolName: "lookup",
        input: '{"city":"Paris"}',
      }, {
        type: "tool-call",
        toolCallId: "tool-2",
        toolName: "code_execution",
        input: '{"language":"PYTHON","code":"print(\'ok\')"}',
        providerExecuted: true,
      }],
    );
    assertEquals(parts.at(-1), {
      type: "finish",
      finishReason: { unified: "stop", raw: "STOP" },
      providerMetadata: {
        google: { rawAssistantParts },
      },
    });

    const continuation = buildGoogleGenerateContentRequest(
      "google",
      {
        prompt: [{
          role: "assistant",
          content: [{
            type: "reasoning",
            text: "Think",
          }, {
            type: "tool-call",
            toolCallId: "tool-1",
            toolName: "lookup",
            input: { city: "Paris" },
          }, {
            type: "tool-call",
            toolCallId: "tool-2",
            toolName: "code_execution",
            input: { language: "PYTHON", code: "print('ok')" },
            providerExecuted: true,
          }, {
            type: "tool-result",
            toolCallId: "tool-2",
            toolName: "code_execution",
            result: { outcome: "OUTCOME_OK", output: "ok\n" },
            providerExecuted: true,
          }],
          providerMetadata: {
            google: { rawAssistantParts },
          },
        }],
      },
      createWarningCollector(),
    );

    assertEquals(continuation.contents, [{
      role: "model",
      parts: rawAssistantParts,
    }]);
  });

  it("coalesces replayed anonymous function calls by candidate position", async () => {
    const functionCall = {
      functionCall: {
        name: "lookup",
        args: { city: "Paris" },
      },
    };
    const parts = await collectParts(streamFromText([
      data({
        candidates: [{ content: { role: "model", parts: [functionCall] } }],
      }),
      data({
        candidates: [{
          content: { role: "model", parts: [functionCall] },
          finishReason: "STOP",
        }],
      }),
      "data: [DONE]\r\n\r\n",
    ].join("")));

    assertEquals(
      parts.filter((part) =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "tool-call"
      ),
      [{
        type: "tool-call",
        toolCallId: "tool-0",
        toolName: "lookup",
        input: '{"city":"Paris"}',
      }],
    );
  });

  it("rejects a provider id that collides with an anonymous raw-position id", async () => {
    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          candidates: [{
            content: {
              role: "model",
              parts: [{
                text: "Think",
                thought: true,
                thoughtSignature: "thought-signature",
              }, {
                functionCall: {
                  name: "lookup",
                  args: { city: "Paris" },
                },
              }, {
                executableCode: {
                  id: "tool-1",
                  language: "PYTHON",
                  code: "print('collision')",
                },
              }],
            },
            finishReason: "STOP",
          }],
        }))),
      ProviderRequestError,
      "candidate executable code id was duplicated",
    );
  });

  it("retains an empty final text part carrying a thought signature", async () => {
    const visibleText = { text: "Answer." };
    const signatureCarrier = { text: "", thoughtSignature: "final-text-signature" };
    const parts = await collectParts(streamFromText([
      data({
        candidates: [{
          content: { role: "model", parts: [visibleText] },
        }],
      }),
      data({
        candidates: [{
          content: { role: "model", parts: [signatureCarrier] },
        }],
      }),
      data({ candidates: [{ finishReason: "STOP" }] }),
      "data: [DONE]\r\n\r\n",
    ].join("")));

    assertEquals(parts, [
      { type: "text-delta", delta: "Answer." },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "STOP" },
        providerMetadata: {
          google: {
            rawAssistantParts: [visibleText, signatureCarrier],
          },
        },
      },
    ]);
  });

  it("normalizes correlated provider-executed code calls, results, and failures", async () => {
    const signedExecutableCode = {
      executableCode: {
        id: "code_1",
        language: "PYTHON",
        code: "print(6 * 7)",
      },
      thoughtSignature: "code-signature",
    };
    const successfulResult = {
      codeExecutionResult: {
        id: "code_1",
        outcome: "OUTCOME_OK",
        output: "42\n",
      },
    };
    const anonymousExecutableCode = {
      executableCode: {
        language: "PYTHON",
        code: "while True: pass",
      },
    };
    const deadlineResult = {
      codeExecutionResult: {
        outcome: "OUTCOME_DEADLINE_EXCEEDED",
        output: "partial",
      },
    };
    const parts = await collectParts(streamFromText([
      data({
        candidates: [{
          content: { role: "model", parts: [signedExecutableCode] },
        }],
      }),
      data({
        candidates: [{
          content: { role: "model", parts: [successfulResult] },
        }],
      }),
      // Some compatible gateways retransmit a cumulative tool snapshot.
      data({
        candidates: [{
          content: {
            role: "model",
            parts: [signedExecutableCode, successfulResult],
          },
        }],
      }),
      data({
        candidates: [{
          content: {
            role: "model",
            parts: [anonymousExecutableCode, deadlineResult],
          },
        }],
      }),
      data({ candidates: [{ finishReason: "STOP" }] }),
      "data: [DONE]\r\n\r\n",
    ].join("")));

    assertEquals(parts, [
      {
        type: "tool-input-start",
        id: "code_1",
        toolName: "code_execution",
        providerExecuted: true,
      },
      {
        type: "tool-input-delta",
        id: "code_1",
        delta: '{"language":"PYTHON","code":"print(6 * 7)"}',
      },
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
      {
        type: "tool-input-start",
        id: "google-code-execution-0",
        toolName: "code_execution",
        providerExecuted: true,
      },
      {
        type: "tool-input-delta",
        id: "google-code-execution-0",
        delta: '{"language":"PYTHON","code":"while True: pass"}',
      },
      {
        type: "tool-call",
        toolCallId: "google-code-execution-0",
        toolName: "code_execution",
        input: '{"language":"PYTHON","code":"while True: pass"}',
        providerExecuted: true,
      },
      {
        type: "tool-error",
        toolCallId: "google-code-execution-0",
        toolName: "code_execution",
        error: {
          outcome: "OUTCOME_DEADLINE_EXCEEDED",
          output: "partial",
        },
        isError: true,
        providerExecuted: true,
      },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "STOP" },
        providerMetadata: {
          google: {
            rawAssistantParts: [
              signedExecutableCode,
              successfulResult,
              anonymousExecutableCode,
              deadlineResult,
            ],
          },
        },
      },
    ]);
  });

  it("fails closed on malformed, unpaired, and unsupported streamed parts", async () => {
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
      await assertRejects(
        () =>
          collectParts(streamFromText(
            data({
              candidates: [{
                content: { role: "model", parts },
                finishReason: "STOP",
              }],
            }),
          )),
        ProviderRequestError,
        issue,
      );
    }

    await assertRejects(
      () =>
        collectParts(streamFromText(
          data({
            candidates: [{
              content: {
                parts: [{
                  executableCode: {
                    id: "code_1",
                    language: "PYTHON",
                    code: "print('missing result')",
                  },
                }],
              },
            }],
          }) +
            data({ candidates: [{ finishReason: "STOP" }] }),
        )),
      ProviderRequestError,
      "candidate executable code had no matching execution result",
    );
  });

  it("accepts every current content-filter finish reason without output", async () => {
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
      assertEquals(
        await collectParts(streamFromText(
          data({ candidates: [{ finishReason }] }) + "data: [DONE]\r\n\r\n",
        )),
        [{
          type: "finish",
          finishReason: { unified: "content-filter", raw: finishReason },
        }],
      );
    }
  });

  it("rejects malformed thought signatures and non-object function arguments", async () => {
    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          candidates: [{
            content: { parts: [{ text: "answer", thoughtSignature: 42 }] },
            finishReason: "STOP",
          }],
        }))),
      ProviderRequestError,
      "candidate thought signature was malformed",
    );
    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          candidates: [{
            content: {
              parts: [{
                functionCall: { id: "tool_1", name: "lookup", args: ["not", "an", "object"] },
              }],
            },
            finishReason: "STOP",
          }],
        }))),
      ProviderRequestError,
      "candidate function call arguments were not an object",
    );
    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          candidates: [{
            content: {
              parts: [{ functionCall: { id: "tool_1", name: "lookup", args: null } }],
            },
            finishReason: "STOP",
          }],
        }))),
      ProviderRequestError,
      "candidate function call arguments were not an object",
    );
  });

  it("treats an omitted function call args field as empty arguments", async () => {
    const rawAssistantParts = [{
      functionCall: { id: "tool_1", name: "ping" },
      thoughtSignature: "signed-zero-argument-call",
    }];
    const parts = await collectParts(streamFromText([
      data({
        candidates: [{
          content: { role: "model", parts: rawAssistantParts },
          finishReason: "STOP",
        }],
      }),
      "data: [DONE]\r\n\r\n",
    ].join("")));

    assertEquals(
      parts.filter((part) =>
        typeof part === "object" &&
        part !== null &&
        "type" in part &&
        part.type === "tool-call"
      ),
      [{
        type: "tool-call",
        toolCallId: "tool_1",
        toolName: "ping",
        input: "{}",
      }],
    );

    assertEquals(parts.at(-1), {
      type: "finish",
      finishReason: { unified: "stop", raw: "STOP" },
      providerMetadata: {
        google: { rawAssistantParts },
      },
    });

    const continuation = buildGoogleGenerateContentRequest(
      "google",
      {
        prompt: [{
          role: "assistant",
          content: [{
            type: "tool-call",
            toolCallId: "tool_1",
            toolName: "ping",
            input: {},
          }],
          providerMetadata: {
            google: { rawAssistantParts },
          },
        }],
      },
      createWarningCollector(),
    );
    assertEquals(continuation.contents, [{
      role: "model",
      parts: rawAssistantParts,
    }]);
  });

  it("fully processes a trailing terminal record without a final delimiter", async () => {
    const parts = await collectParts(streamFromText(
      `data: ${
        JSON.stringify({
          candidates: [{
            content: { parts: [{ text: "tail" }] },
            finishReason: "STOP",
          }],
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 2,
            totalTokenCount: 3,
          },
        })
      }`,
    ));

    assertEquals(parts, [
      { type: "text-delta", delta: "tail" },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "STOP" },
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          totalTokens: 3,
        },
      },
    ]);
  });

  it("enforces one candidate and a single successful-stream terminal lifecycle", async () => {
    await assertRejects(
      () =>
        collectParts(streamFromText(
          data({
            candidates: [
              { content: { parts: [{ text: "first" }] } },
              { content: { parts: [{ text: "second" }] } },
            ],
          }),
        )),
      ProviderRequestError,
      "event contained multiple candidates",
    );

    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({
            candidates: [{
              content: { parts: [{ text: "before" }] },
              finishReason: "STOP",
            }],
          }),
          data({ candidates: [{ content: { parts: [{ text: "after" }] } }] }),
        ].join(""))),
      ProviderRequestError,
      "candidate appeared after a terminal marker",
    );

    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({ candidates: [{ content: { parts: [{ text: "before" }] } }] }),
          "data: [DONE]\r\n\r\n",
          data({ candidates: [{ content: { parts: [{ text: "after" }] } }] }),
        ].join(""))),
      ProviderRequestError,
      "event appeared after [DONE]",
    );

    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({ candidates: [{ content: { parts: [{ text: "answer" }] } }] }),
          "data: [DONE]\r\n\r\n",
          "data: [DONE]\r\n\r\n",
        ].join(""))),
      ProviderRequestError,
      "stream contained duplicate [DONE] markers",
    );

    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({ candidates: [{ content: { parts: [{ text: "answer" }] } }] }),
          "data: [DONE]\r\n\r\n",
          data({
            usageMetadata: {
              promptTokenCount: 2,
              candidatesTokenCount: 1,
              totalTokenCount: 3,
            },
          }),
        ].join(""))),
      ProviderRequestError,
      "event appeared after [DONE]",
    );

    await assertRejects(
      () =>
        collectParts(streamFromText([
          data({
            candidates: [{
              content: { parts: [{ text: "answer" }] },
              finishReason: "STOP",
            }],
          }),
          data({ candidates: [{ finishReason: "STOP" }] }),
        ].join(""))),
      ProviderRequestError,
      "stream contained duplicate terminal reasons",
    );

    const usageTail = await collectParts(streamFromText([
      data({ candidates: [{ content: { parts: [{ text: "answer" }] } }] }),
      data({ candidates: [{ finishReason: "STOP" }] }),
      data({
        usageMetadata: {
          promptTokenCount: 2,
          candidatesTokenCount: 1,
          totalTokenCount: 3,
        },
      }),
      "data: [DONE]\r\n\r\n",
    ].join("")));
    assertEquals(usageTail, [
      { type: "text-delta", delta: "answer" },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: "STOP" },
        usage: {
          inputTokens: 2,
          outputTokens: 1,
          totalTokens: 3,
        },
      },
    ]);
  });

  it("bounds raw chunks and decoded SSE buffers without leaking payloads", async () => {
    await assertRejects(
      () => collectParts(streamFromBytes(new Uint8Array([0xff]))),
      ProviderRequestError,
      "google request failed: invalid successful stream (stream contained invalid UTF-8)",
    );

    const terminalEvent = data({
      candidates: [{
        content: { parts: [{ text: "ok" }] },
        finishReason: "STOP",
      }],
    }) + "data: [DONE]\r\n\r\n";
    const paddingLength = MAX_GOOGLE_SSE_CHUNK_BYTES - terminalEvent.length;
    const exactBoundaryText = `:${"x".repeat(paddingLength - 3)}\n\n${terminalEvent}`;
    const encoder = new TextEncoder();
    const exactBoundaryChunk = encoder.encode(exactBoundaryText);
    assertEquals(exactBoundaryChunk.byteLength, MAX_GOOGLE_SSE_CHUNK_BYTES);
    assertEquals(
      await collectParts(streamFromBytes(exactBoundaryChunk)),
      [
        { type: "text-delta", delta: "ok" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: "STOP" },
        },
      ],
    );

    const secret = "private-provider-payload";
    const oversizedRawChunk = new Uint8Array(MAX_GOOGLE_SSE_CHUNK_BYTES + 1);
    oversizedRawChunk.set(encoder.encode(secret));
    const rawError = await assertRejects(
      () => collectParts(streamFromBytes(oversizedRawChunk)),
      ProviderRequestError,
      `SSE chunk exceeded ${MAX_GOOGLE_SSE_CHUNK_BYTES} bytes`,
    );
    assertEquals(
      rawError instanceof Error && rawError.message.includes(secret),
      false,
    );

    await assertRejects(
      () =>
        collectParts(streamFromBytes(
          encoder.encode("x".repeat(MAX_GOOGLE_SSE_BUFFER_CODE_UNITS)),
          encoder.encode("y"),
        )),
      ProviderRequestError,
      `SSE buffer exceeded ${MAX_GOOGLE_SSE_BUFFER_CODE_UNITS} code units`,
    );
  });

  it("bounds retained raw parts across many small candidate events", async () => {
    const events = Array.from(
      { length: MAX_GOOGLE_RETAINED_STATE_ITEMS + 1 },
      () => data({ candidates: [{ content: { parts: [{ text: "x" }] } }] }),
    );

    await assertRejects(
      () => collectParts(streamFromText(events.join(""))),
      ProviderRequestError,
      `retained state exceeded ${MAX_GOOGLE_RETAINED_STATE_ITEMS} items`,
    );
  });

  it("bounds retained correlation maps across many small function calls", async () => {
    const events = Array.from(
      { length: Math.floor(MAX_GOOGLE_RETAINED_STATE_ITEMS / 2) + 1 },
      (_, index) =>
        data({
          candidates: [{
            content: {
              parts: [{
                functionCall: { id: `call-${index}`, name: "lookup", args: {} },
              }],
            },
          }],
        }),
    );

    await assertRejects(
      () => collectParts(streamFromText(events.join(""))),
      ProviderRequestError,
      `retained state exceeded ${MAX_GOOGLE_RETAINED_STATE_ITEMS} items`,
    );
  });

  it("accepts the exact aggregate UTF-8 byte limit and rejects limit plus one", async () => {
    const emptyPartBytes = new TextEncoder().encode(JSON.stringify({ text: "" })).byteLength;
    const quarter = Math.floor(MAX_GOOGLE_RETAINED_STATE_BYTES / 4);
    const serializedPartBytes = [
      quarter,
      quarter,
      quarter,
      MAX_GOOGLE_RETAINED_STATE_BYTES - quarter * 3,
    ];
    const encoder = new TextEncoder();
    const events = (lastPartExtraBytes: number) =>
      [
        ...serializedPartBytes.map((byteLength, index) =>
          data({
            candidates: [{
              content: {
                parts: [{
                  text: utf8StringWithByteLength(
                    byteLength - emptyPartBytes +
                      (index === serializedPartBytes.length - 1 ? lastPartExtraBytes : 0),
                  ),
                }],
              },
            }],
          })
        ),
        data({ candidates: [{ finishReason: "STOP" }] }),
        "data: [DONE]\r\n\r\n",
      ].map((event) => encoder.encode(event));

    const exactParts = await collectParts(streamFromBytes(...events(0)));
    assertEquals(exactParts.at(-1), {
      type: "finish",
      finishReason: { unified: "stop", raw: "STOP" },
    });

    await assertRejects(
      () => collectParts(streamFromBytes(...events(1))),
      ProviderRequestError,
      `retained state exceeded ${MAX_GOOGLE_RETAINED_STATE_BYTES} UTF-8 bytes`,
    );
  });

  it("rejects structurally empty and unterminated successful streams", async () => {
    await assertRejects(
      () => collectParts(streamFromText(data({}))),
      ProviderRequestError,
      "event had neither candidates nor usage",
    );
    await assertRejects(
      () =>
        collectParts(streamFromText(data({
          candidates: [{ content: { parts: [{ text: "partial" }] } }],
        }))),
      ProviderRequestError,
      "stream ended before a terminal marker",
    );
  });
});
