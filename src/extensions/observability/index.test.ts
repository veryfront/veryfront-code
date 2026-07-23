import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { NodeTelemetryLogRecord, TracingExporter } from "./index.ts";

describe("extensions/observability public contracts", () => {
  it("uses the shared structured log record for tracing emitters", () => {
    const emitted: NodeTelemetryLogRecord[] = [];
    const exporter = {
      start: () => Promise.resolve(),
      export: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
      getProvider: () => ({ getTracer: () => ({}) }),
      getMetricsAPI: () => null,
      getLogRecordEmitter: () => (record) => emitted.push(record),
    } satisfies TracingExporter;

    exporter.getLogRecordEmitter()?.({
      message: "Run completed",
      run_id: "<RUN_ID>",
      tool_call_id: "tool-call-1",
      request_id: "request-1",
      duration_ms: 12,
      custom_dimension: "future-compatible",
    });

    assertEquals(emitted, [{
      message: "Run completed",
      run_id: "<RUN_ID>",
      tool_call_id: "tool-call-1",
      request_id: "request-1",
      duration_ms: 12,
      custom_dimension: "future-compatible",
    }]);
  });
});
