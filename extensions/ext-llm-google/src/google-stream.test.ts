import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ProviderRequestError } from "veryfront/provider/shared";
import {
  extractGoogleUsage,
  MAX_GOOGLE_SSE_BUFFER_CODE_UNITS,
  MAX_GOOGLE_SSE_CHUNK_BYTES,
  streamGoogleCompatibleParts,
} from "./google-stream.ts";

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
