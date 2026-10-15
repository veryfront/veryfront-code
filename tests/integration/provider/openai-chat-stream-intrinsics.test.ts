import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { ProviderRateLimitError, ProviderRequestError } from "veryfront/provider/shared";
import { streamOpenAICompatibleParts } from "../../../extensions/ext-llm-openai/src/openai-chat-stream.ts";

// These cases replace process-wide intrinsics, so they run outside unit suites.

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

async function collectParts(text: string): Promise<unknown[]> {
  const parts: unknown[] = [];
  for await (const part of streamOpenAICompatibleParts(streamFromText(text))) parts.push(part);
  return parts;
}

function data(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\r\n\r\n`;
}

it("reads streamed error fields only as own data properties", async () => {
  const keys = ["error", "code"] as const;
  const originals = keys.map((key) => Object.getOwnPropertyDescriptor(Object.prototype, key));
  let calls = 0;
  let terminal: unknown;
  let parts: unknown[] = [];
  try {
    Object.defineProperty(Object.prototype, "error", {
      configurable: true,
      get() {
        calls++;
        return { message: "forged", code: "server_error" };
      },
    });
    Object.defineProperty(Object.prototype, "code", {
      configurable: true,
      get() {
        calls++;
        return "rate_limit_exceeded";
      },
    });
    terminal = await assertRejects(
      () => collectParts(data({ error: { message: "Bad request" } })),
      ProviderRequestError,
    );
    parts = await collectParts([
      data({ choices: [{ index: 0, delta: { content: "Ready." }, finish_reason: "stop" }] }),
      "data: [DONE]\r\n\r\n",
    ].join(""));
  } finally {
    keys.forEach((key, index) => {
      const original = originals[index];
      if (original) Object.defineProperty(Object.prototype, key, original);
      else Reflect.deleteProperty(Object.prototype, key);
    });
  }
  assertEquals(calls, 0);
  assert(terminal instanceof ProviderRequestError);
  assertEquals(terminal instanceof ProviderRateLimitError, false);
  assertEquals(terminal.retryable, false);
  assertEquals(parts.length > 0, true);
});

it("classifies streamed errors without dispatching through replaced string methods", async () => {
  const originalLowerCase = String.prototype.toLowerCase;
  const originalIncludes = String.prototype.includes;
  let calls = 0;
  let error: unknown;
  try {
    String.prototype.toLowerCase = function () {
      calls++;
      return "context length exceeded";
    };
    String.prototype.includes = function () {
      calls++;
      return true;
    };
    error = await assertRejects(
      () => collectParts(data({ error: { message: "Slow down", code: "rate_limit_exceeded" } })),
      ProviderRateLimitError,
    );
  } finally {
    String.prototype.toLowerCase = originalLowerCase;
    String.prototype.includes = originalIncludes;
  }
  assertEquals(calls, 0);
  assert(error instanceof ProviderRateLimitError);
  assertEquals(error.retryable, true);
});
