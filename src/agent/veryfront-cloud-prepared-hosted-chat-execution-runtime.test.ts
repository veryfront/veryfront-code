import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createChatStreamWatchdog } from "#veryfront/chat/stream-watchdog.ts";
import type { AgentTraceAttributes } from "./agent-trace-attributes.ts";
import type { HostedAgentRunTracer } from "./hosted/agent-run-lifecycle.ts";
import { createVeryfrontCloudPreparedHostedChatExecutionRuntimeOptions } from "./veryfront-cloud-prepared-hosted-chat-execution-runtime.ts";

function createTracer(): HostedAgentRunTracer {
  return {
    startSpan: () => ({
      setAttributes: () => {},
      finish: () => {},
      withContext: (fn) => fn(),
    }),
  };
}

describe("agent/veryfront-cloud-prepared-hosted-chat-execution-runtime", () => {
  it("builds prepared execution runtime options with Veryfront Cloud provider defaults", () => {
    const tracer = createTracer();
    const logger = {
      error: () => {},
      warn: () => {},
    };
    const trace = async <TResult>(
      _operationName: string,
      operation: () => Promise<TResult>,
    ): Promise<TResult> => await operation();
    const traceStream = async <TResult>(operation: () => Promise<TResult>): Promise<TResult> =>
      await operation();
    const setActiveSpanAttributes = (_attributes: AgentTraceAttributes) => {};

    const options = createVeryfrontCloudPreparedHostedChatExecutionRuntimeOptions({
      apiUrl: "https://api.example.com",
      tracer,
      logger,
      trace,
      traceStream,
      setActiveSpanAttributes,
    });

    assertEquals(options.apiUrl, "https://api.example.com");
    assertStrictEquals(options.tracer, tracer);
    assertStrictEquals(options.logger, logger);
    assertStrictEquals(options.trace, trace);
    assertStrictEquals(options.traceStream, traceStream);
    assertStrictEquals(options.setActiveSpanAttributes, setActiveSpanAttributes);
    assertEquals(options.resolveProvider("veryfront-cloud/openai/gpt-5.2"), "openai");
    assertEquals(typeof options.createRootStreamWatchdog, "function");
  });

  it("preserves host-provided watchdog factories", () => {
    const createRootStreamWatchdog = () => createChatStreamWatchdog();

    const options = createVeryfrontCloudPreparedHostedChatExecutionRuntimeOptions({
      apiUrl: new URL("https://api.example.com"),
      tracer: createTracer(),
      createRootStreamWatchdog,
    });

    assertStrictEquals(options.createRootStreamWatchdog, createRootStreamWatchdog);
  });
});
