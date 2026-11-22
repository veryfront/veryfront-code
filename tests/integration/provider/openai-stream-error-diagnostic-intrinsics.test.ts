import "#veryfront/schemas/_test-setup.ts";
import { summarizeErrorCausesForLog } from "#veryfront/observability/telemetry-error.ts";
import { createRuntimeProviderStreamFailure } from "#veryfront/runtime/provider-stream-error-provenance.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { ProviderRequestError, ProviderStreamProtocolError } from "veryfront/provider/shared";
import { streamOpenAICompatibleParts } from "../../../extensions/ext-llm-openai/src/openai-chat-stream.ts";
import { streamOpenAIResponsesParts } from "../../../extensions/ext-llm-openai/src/openai-responses-stream.ts";

function streamFromText(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

async function collectParts(
  parse: (stream: ReadableStream<Uint8Array>) => AsyncIterable<unknown>,
  stream: ReadableStream<Uint8Array>,
): Promise<void> {
  for await (const _part of parse(stream)) { /* Drain the real parser. */ }
}

function data(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\r\n\r\n`;
}

// These cases replace process-wide intrinsics, so they run outside unit suites.
it("chat stream ignores inherited diagnostic fields without invoking accessors", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "param");
  let reads = 0;
  Object.defineProperty(Object.prototype, "param", {
    configurable: true,
    get() {
      reads++;
      return "temperature";
    },
  });
  try {
    const error = await assertRejects(
      () =>
        collectParts(
          streamOpenAICompatibleParts,
          streamFromText(
            data({ error: { code: "invalid_tool_schema", message: "private payload" } }),
          ),
        ),
      ProviderRequestError,
    );
    const causes = summarizeErrorCausesForLog(createRuntimeProviderStreamFailure(error));
    assert(causes !== undefined);
    const providerCause = causes.find((cause) => cause.name === "ProviderRequestError");
    assert(providerCause !== undefined);
    assertEquals(providerCause.providerErrorParam, undefined);
    assertEquals(providerCause.providerErrorCode, "invalid_tool_schema");
    assertEquals(reads, 0);
  } finally {
    if (descriptor) Object.defineProperty(Object.prototype, "param", descriptor);
    else Reflect.deleteProperty(Object.prototype, "param");
  }
});

it("Responses stream ignores inherited diagnostic fields without invoking accessors", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "param");
  let reads = 0;
  Object.defineProperty(Object.prototype, "param", {
    configurable: true,
    get() {
      reads++;
      return "temperature";
    },
  });
  try {
    const error = await assertRejects(
      () =>
        collectParts(
          streamOpenAIResponsesParts,
          streamFromText(
            data({
              type: "error",
              error: { code: "invalid_tool_schema", message: "private payload" },
            }),
          ),
        ),
      ProviderRequestError,
    );
    const causes = summarizeErrorCausesForLog(createRuntimeProviderStreamFailure(error));
    assert(causes !== undefined);
    const providerCause = causes.find((cause) => cause.name === "ProviderRequestError");
    assert(providerCause !== undefined);
    assertEquals(providerCause.providerErrorParam, undefined);
    assertEquals(providerCause.providerErrorCode, "invalid_tool_schema");
    assertEquals(reads, 0);
  } finally {
    if (descriptor) Object.defineProperty(Object.prototype, "param", descriptor);
    else Reflect.deleteProperty(Object.prototype, "param");
  }
});

it("Responses stream never certifies an inherited error code", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "code");
  let reads = 0;
  Object.defineProperty(Object.prototype, "code", {
    configurable: true,
    get() {
      reads++;
      return "invalid_tool_schema";
    },
  });
  try {
    await assertRejects(() =>
      collectParts(
        streamOpenAIResponsesParts,
        streamFromText(data({
          type: "error",
          error: { message: "private payload" },
        })),
      ), ProviderStreamProtocolError);
    assertEquals(reads, 0);
  } finally {
    if (descriptor) Object.defineProperty(Object.prototype, "code", descriptor);
    else Reflect.deleteProperty(Object.prototype, "code");
  }
});
