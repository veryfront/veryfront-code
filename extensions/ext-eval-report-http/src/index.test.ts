/**
 * ext-eval-report-http extension tests.
 *
 * @module extensions/ext-eval-report-http/test
 */

import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { ExtensionContext } from "veryfront/extensions";
import {
  createEvalReportExporterRegistry,
  type EvalReportExporterRegistry,
  EvalReportExporterRegistryName,
} from "veryfront/extensions/eval";
import factory from "./index.ts";

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
} satisfies ExtensionContext["logger"];

function createContext(registry: EvalReportExporterRegistry): ExtensionContext {
  return {
    config: {},
    logger: noopLogger,
    provide() {},
    get: <T>(name: string) => name === EvalReportExporterRegistryName ? registry as T : undefined,
    require: <T>(name: string) => {
      if (name === EvalReportExporterRegistryName) return registry as T;
      throw new Error(`missing ${name}`);
    },
  };
}

describe("ext-eval-report-http", () => {
  it("declares the eval report exporter registry dependency", () => {
    const extension = factory();

    assertEquals(extension.name, "ext-eval-report-http");
    assertEquals(extension.version, "0.1.0");
    assertEquals(extension.contracts?.requires, [EvalReportExporterRegistryName]);
    assertEquals(extension.capabilities, [
      { type: "net:outbound", hosts: ["*"] },
      {
        type: "env:read",
        keys: [
          "VERYFRONT_EVAL_HTTP_EXPORTER_HEADERS",
          "VERYFRONT_EVAL_HTTP_EXPORTER_ID",
          "VERYFRONT_EVAL_HTTP_EXPORTER_TOKEN",
          "VERYFRONT_EVAL_HTTP_EXPORTER_URL",
        ],
      },
    ]);
  });

  it("registers configured HTTP eval report exporters during setup", async () => {
    const registry = createEvalReportExporterRegistry();
    const requests: Array<{ url: string; init: RequestInit }> = [];

    const extension = factory({
      exporters: [
        {
          id: "braintrust-proxy",
          url: "https://evals.example.test/reports",
          token: "test-token",
          headers: { "x-workspace": "docs" },
        },
      ],
      fetch: (input: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(input), init: init ?? {} });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              externalRunId: "run-123",
              url: "https://evals.example.test/runs/run-123",
              metadata: { provider: "proxy" },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      },
    });

    await extension.setup?.(createContext(registry));

    const exporter = registry.get("braintrust-proxy");
    assertExists(exporter);

    const receipt = await exporter.export(
      {
        kind: "eval-report",
        definitionId: "eval:smoke",
        targetKind: "agent",
        target: "agent:researcher",
        runId: "evalrun_1",
        startedAt: "2026-06-21T00:00:00.000Z",
        endedAt: "2026-06-21T00:00:01.000Z",
        records: [],
        summary: {
          records: 0,
          passed: 0,
          failed: 0,
          passRate: 1,
          metrics: [],
        },
      },
      {
        projectReference: "docs-agent",
        trace: { traceId: "trace-1", spanId: "span-1" },
      },
    );

    assertEquals(receipt, {
      externalRunId: "run-123",
      url: "https://evals.example.test/runs/run-123",
      metadata: { provider: "proxy" },
    });
    assertEquals(requests.length, 1);
    assertEquals(requests[0]?.url, "https://evals.example.test/reports");
    assertEquals(requests[0]?.init.method, "POST");
    assertEquals(requests[0]?.init.headers, {
      "authorization": "Bearer test-token",
      "content-type": "application/json",
      "x-workspace": "docs",
    });
    assertEquals(JSON.parse(String(requests[0]?.init.body)), {
      report: {
        kind: "eval-report",
        definitionId: "eval:smoke",
        targetKind: "agent",
        target: "agent:researcher",
        runId: "evalrun_1",
        startedAt: "2026-06-21T00:00:00.000Z",
        endedAt: "2026-06-21T00:00:01.000Z",
        records: [],
        summary: {
          records: 0,
          passed: 0,
          failed: 0,
          passRate: 1,
          metrics: [],
        },
      },
      context: {
        projectReference: "docs-agent",
        trace: { traceId: "trace-1", spanId: "span-1" },
      },
    });
  });

  it("unregisters exporters during teardown", async () => {
    const registry = createEvalReportExporterRegistry();
    const extension = factory({
      exporters: [{ id: "generic-http", url: "https://evals.example.test/reports" }],
    });

    await extension.setup?.(createContext(registry));
    assertEquals(registry.has("generic-http"), true);

    await extension.teardown?.();
    assertEquals(registry.has("generic-http"), false);
  });

  it("does not register an exporter when no URL is configured", async () => {
    const registry = createEvalReportExporterRegistry();
    const extension = factory({ exporters: [{ id: "missing-url" }] });

    await extension.setup?.(createContext(registry));

    assertEquals(registry.list(), []);
  });
});
