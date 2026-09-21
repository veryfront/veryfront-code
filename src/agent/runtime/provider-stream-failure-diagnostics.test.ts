import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { __subscribeLogRecordEmitter, type LogEntry } from "#veryfront/utils/logger/logger.ts";
import type { ModelRuntime } from "#veryfront/provider";
import * as otelApi from "npm:@opentelemetry/api@1.9.1";
import { AsyncLocalStorageContextManager } from "npm:@opentelemetry/context-async-hooks@2.9.0";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "npm:@opentelemetry/sdk-trace-base@2.9.0";
import {
  _resetShimForTests,
  setGlobalActiveSpanAccessor,
  setGlobalContextAccessor,
  setGlobalTracerProvider,
  SpanStatusCode,
} from "#veryfront/observability/tracing/api-shim.ts";
import { AgentRuntime } from "./index.ts";

/**
 * Regression coverage for a provider body read that fails mid-stream. The
 * runtime wraps the failure as `RuntimeProviderStreamFailure` and keeps the
 * cause private, so the server log and the `chat` span must still name what
 * actually broke while the client keeps the generic SSE error.
 */

const MODEL_ID = "diagnostics-model";
const CAUSE_MESSAGE = "Anthropic partial_json exceeded 4096 deltas";

function installRealTracing() {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  otelApi.context.setGlobalContextManager(contextManager);
  setGlobalTracerProvider(provider as never);
  setGlobalActiveSpanAccessor(otelApi.trace as never);
  setGlobalContextAccessor(otelApi.context as never);
  return {
    exporter,
    provider,
    async dispose() {
      _resetShimForTests();
      contextManager.disable();
      otelApi.context.disable();
      await provider.shutdown();
    },
  };
}

function captureStreamErrorLogs(): { records: LogEntry[]; stop: () => void } {
  const records: LogEntry[] = [];
  const stop = __subscribeLogRecordEmitter((entry) => {
    if (entry.message === "Agent stream error") records.push(entry);
  });
  return { records, stop };
}

/** A provider whose response body fails after the stream has opened. */
function failingBodyModel(cause: unknown): ModelRuntime {
  return {
    provider: "anthropic",
    modelId: MODEL_ID,
    doGenerate: () => Promise.reject(new Error("Unexpected generate")),
    doStream: () =>
      Promise.resolve({
        stream: new ReadableStream({
          pull(controller) {
            controller.error(cause);
          },
        }),
      }),
  } as ModelRuntime;
}

async function runFailingStream(cause: unknown): Promise<string> {
  const runtime = new AgentRuntime("provider-stream-failure-diagnostics", {
    model: `veryfront-cloud/anthropic/${MODEL_ID}`,
    system: "Synthetic instructions",
    maxSteps: 1,
  }, {
    resolveModelRuntime: () => failingBodyModel(cause),
  });
  const stream = await runtime.stream([{
    id: "synthetic-message",
    role: "user",
    parts: [{ type: "text", text: "Synthetic input" }],
  }]);
  const decoder = new TextDecoder();
  let body = "";
  for await (const chunk of stream) body += decoder.decode(chunk, { stream: true });
  return body;
}

describe("provider stream failure diagnostics", () => {
  it("logs the underlying cause chain and keeps the client SSE error generic", async () => {
    const logs = captureStreamErrorLogs();
    try {
      const body = await runFailingStream(new RangeError(CAUSE_MESSAGE));

      assertEquals(body.includes("Provider stream failed"), true);
      assertEquals(body.includes(CAUSE_MESSAGE), false, "the cause must stay off the client SSE");

      assertEquals(logs.records.length, 1);
      const record = logs.records[0]!;
      assertEquals(record.error?.name, "RuntimeProviderStreamFailure");
      assertEquals(record.context?.errorCauses, [{ name: "RangeError", message: CAUSE_MESSAGE }]);
    } finally {
      logs.stop();
    }
  });

  it("logs nested causes with their code and never untrusted cause text", async () => {
    const logs = captureStreamErrorLogs();
    try {
      const socketError = Object.assign(
        new Error(`socket hang up at https://user:<TOKEN>@provider.example/v1 ${"x".repeat(2000)}`),
        { code: "ECONNRESET" },
      );
      await runFailingStream(
        new TypeError("error reading a body from connection", { cause: socketError }),
      );

      assertEquals(logs.records.length, 1);
      const causes = logs.records[0]!.context?.errorCauses as Array<Record<string, unknown>>;
      assertEquals(causes.length, 2);
      assertEquals(causes[0], {
        name: "TypeError",
        message: "error reading a body from connection",
      });
      // The socket error's text is untrusted (it carries a URL), so only its
      // fixed classification is logged.
      assertEquals(causes[1], { name: "Error", code: "ECONNRESET", messageRedacted: true });
      assertEquals(JSON.stringify(causes).includes("<TOKEN>"), false);
    } finally {
      logs.stop();
    }
  });

  it("records the wrapper type and the cause class on the chat span", async () => {
    const tracing = installRealTracing();
    try {
      await runFailingStream(new RangeError(CAUSE_MESSAGE));
      await tracing.provider.forceFlush();
      const spans = tracing.exporter.getFinishedSpans();

      const chat = spans.find((span) => span.name.startsWith("chat "));
      assertExists(chat, `expected a chat span, got ${spans.map((s) => s.name).join(", ")}`);
      assertEquals(chat.status.code, SpanStatusCode.ERROR);
      assertEquals(chat.status.message, "RuntimeProviderStreamFailure");
      const exception = chat.events.find((event) => event.name === "exception");
      assertEquals(exception?.attributes?.["exception.type"], "RuntimeProviderStreamFailure");
      assertEquals(chat.attributes["error.cause.type"], "RangeError");

      for (const span of spans) {
        const fields = [
          span.status.message,
          ...Object.values(span.attributes),
          ...span.events.flatMap((event) => Object.values(event.attributes ?? {})),
        ];
        for (const value of fields) {
          assertEquals(
            String(value ?? "").includes(CAUSE_MESSAGE),
            false,
            `${span.name} must not carry the provider cause text`,
          );
        }
      }
    } finally {
      await tracing.dispose();
    }
  });
});
