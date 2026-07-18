/**
 * ext-eval-report-mlflow extension tests.
 *
 * @module extensions/ext-eval-report-mlflow/test
 */

import { assertEquals, assertExists, assertRejects, assertThrows } from "@std/assert";
import { afterEach, describe, it } from "@std/testing/bdd";
import type { EvalReport } from "veryfront/eval";
import type { ExtensionContext } from "veryfront/extensions";
import {
  createEvalReportExporterRegistry,
  type EvalReportExporterRegistry,
  EvalReportExporterRegistryName,
} from "veryfront/extensions/eval";
import factory, { createEvalReportMlflowExporter } from "./index.ts";

const MLFLOW_ENV_KEYS = [
  "MLFLOW_ARTIFACTS_URI",
  "MLFLOW_EXPERIMENT_NAME",
  "MLFLOW_RUN_NAME",
  "MLFLOW_TRACKING_PASSWORD",
  "MLFLOW_TRACKING_TOKEN",
  "MLFLOW_TRACKING_URI",
  "MLFLOW_TRACKING_USERNAME",
] as const;

const originalMlflowEnv = new Map(
  MLFLOW_ENV_KEYS.map((key) => [key, Deno.env.get(key)]),
);

function createContext(registry: EvalReportExporterRegistry): ExtensionContext {
  return {
    get: <T>(name: string) => name === EvalReportExporterRegistryName ? registry as T : undefined,
    require: <T>(name: string) => {
      if (name === EvalReportExporterRegistryName) return registry as T;
      throw new Error(`Missing contract ${name}`);
    },
    provide: () => undefined,
    config: {},
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  };
}

function restoreMlflowEnv(): void {
  for (const key of MLFLOW_ENV_KEYS) {
    const value = originalMlflowEnv.get(key);
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }
}

function clearMlflowEnv(): void {
  for (const key of MLFLOW_ENV_KEYS) Deno.env.delete(key);
}

function createReport(): EvalReport {
  return {
    kind: "eval-report",
    runId: "evalrun_1",
    definitionId: "eval:smoke",
    targetKind: "agent",
    target: "agent:support",
    startedAt: "2026-06-21T00:00:00.000Z",
    endedAt: "2026-06-21T00:00:01.000Z",
    summary: {
      records: 1,
      passed: 1,
      failed: 0,
      passRate: 1,
      skippedResults: 0,
      metrics: [
        {
          name: "answer.exactMatch",
          family: "answer",
          severity: "gate",
          passed: 1,
          failed: 0,
          skipped: 0,
          passRate: 1,
        },
      ],
      duration: {
        totalMs: 1000,
        minMs: 1000,
        maxMs: 1000,
        meanMs: 1000,
        p50Ms: 1000,
        p95Ms: 1000,
      },
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        costUsd: 0.01,
      },
    },
    records: [
      {
        id: "q1:1",
        evalId: "eval:smoke",
        exampleId: "q1",
        repetition: 1,
        input: "question",
        output: { text: "answer" },
        reference: "answer",
        metadata: {},
        trace: { events: [], toolCalls: [] },
        usage: { totalTokens: 15 },
        durationMs: 1000,
        completed: true,
        metrics: [
          {
            name: "answer.exactMatch",
            family: "answer",
            severity: "gate",
            score: 1,
            pass: true,
          },
        ],
      },
    ],
  };
}

function createSensitiveReport(): EvalReport {
  return {
    ...createReport(),
    records: [
      {
        ...createReport().records[0]!,
        input: { prompt: "private customer issue", apiKey: "<REDACTED>" },
        output: { text: "private answer" },
        reference: { text: "private reference" },
        metadata: { tenantId: "tenant-secret", topic: "private" },
        trace: {
          events: [{ type: "message", content: "private model output" }],
          toolCalls: [
            {
              id: "tool_1",
              name: "lookup_customer",
              status: "ok",
              input: { customerId: "customer-secret" },
              output: { result: "private result" },
              metadata: { token: "<REDACTED>" },
            },
          ],
        },
        metrics: [
          {
            name: "answer.exactMatch",
            family: "answer",
            severity: "gate",
            score: 1,
            pass: true,
            explanation: "Private explanation",
            evidence: {
              output: "private answer",
              reference: "private reference",
            },
          },
        ],
      },
    ],
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface RecordedMlflowRequest {
  url: string;
  method: string;
  headers: Headers;
  body?: string;
}

function createMlflowFetchRecorder(options: {
  experimentId?: string;
  runId?: string;
  artifactUri?: string;
} = {}): {
  requests: RecordedMlflowRequest[];
  fetchImpl: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
} {
  const experimentId = options.experimentId ?? "exp-1";
  const runId = options.runId ?? "run-1";
  const artifactUri = options.artifactUri ?? "http://artifacts.test/root";
  const requests: RecordedMlflowRequest[] = [];

  const fetchImpl = (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    requests.push({
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : undefined,
    });

    if (url.includes("/experiments/get-by-name")) {
      return Promise.resolve(jsonResponse({
        error_code: "RESOURCE_DOES_NOT_EXIST",
        message: "not found",
      }, 404));
    }
    if (url.endsWith("/api/2.0/mlflow/experiments/create")) {
      return Promise.resolve(jsonResponse({ experiment_id: experimentId }));
    }
    if (url.endsWith("/api/2.0/mlflow/runs/create")) {
      return Promise.resolve(jsonResponse({
        run: {
          info: {
            run_id: runId,
            artifact_uri: artifactUri,
          },
        },
      }));
    }
    if (url.endsWith("/api/2.0/mlflow/runs/log-batch")) {
      return Promise.resolve(jsonResponse({}));
    }
    if (url.endsWith("/api/2.0/mlflow/runs/update")) {
      return Promise.resolve(jsonResponse({}));
    }
    if (init?.method === "PUT") {
      return Promise.resolve(new Response("", { status: 200 }));
    }
    return Promise.resolve(jsonResponse({ message: `unexpected ${url}` }, 500));
  };

  return { requests, fetchImpl };
}

describe("ext-eval-report-mlflow", () => {
  afterEach(() => {
    restoreMlflowEnv();
  });

  it("declares the eval report exporter registry dependency", () => {
    const extension = factory({ trackingUri: "http://mlflow.test" });

    assertEquals(extension.name, "ext-eval-report-mlflow");
    assertEquals(extension.contracts?.requires, [
      EvalReportExporterRegistryName,
    ]);
    assertEquals(extension.capabilities, [
      { type: "net:outbound", hosts: ["*"] },
      {
        type: "env:read",
        keys: [
          "MLFLOW_ARTIFACTS_URI",
          "MLFLOW_EXPERIMENT_NAME",
          "MLFLOW_RUN_NAME",
          "MLFLOW_TRACKING_PASSWORD",
          "MLFLOW_TRACKING_TOKEN",
          "MLFLOW_TRACKING_URI",
          "MLFLOW_TRACKING_USERNAME",
        ],
      },
    ]);
  });

  it("registers an MLflow eval report exporter during setup when MLFLOW_TRACKING_URI is set", async () => {
    clearMlflowEnv();
    Deno.env.set("MLFLOW_TRACKING_URI", "http://mlflow.test");
    const registry = createEvalReportExporterRegistry();
    const { fetchImpl } = createMlflowFetchRecorder();
    const extension = factory({ fetch: fetchImpl });

    await extension.setup?.(createContext(registry));

    assertExists(registry.get("mlflow"));
  });

  it("unregisters the MLflow eval report exporter during teardown", async () => {
    clearMlflowEnv();
    Deno.env.set("MLFLOW_TRACKING_URI", "http://mlflow.test");
    const registry = createEvalReportExporterRegistry();
    const { fetchImpl } = createMlflowFetchRecorder();
    const extension = factory({ fetch: fetchImpl });

    await extension.setup?.(createContext(registry));
    assertExists(registry.get("mlflow"));

    await extension.teardown?.();

    assertEquals(registry.get("mlflow"), undefined);
  });

  it("skips exporter registration when no tracking URI is configured", async () => {
    clearMlflowEnv();
    const registry = createEvalReportExporterRegistry();
    const { fetchImpl } = createMlflowFetchRecorder();
    const extension = factory({ fetch: fetchImpl });

    await extension.setup?.(createContext(registry));

    assertEquals(registry.list(), []);
  });

  it("uses the fixed mlflow exporter id even when config includes an id field", async () => {
    clearMlflowEnv();
    Deno.env.set("MLFLOW_TRACKING_URI", "http://mlflow.test");
    const registry = createEvalReportExporterRegistry();
    const { fetchImpl } = createMlflowFetchRecorder();
    const extension = factory({
      id: "custom-config",
      fetch: fetchImpl,
    });

    await extension.setup?.(createContext(registry));

    assertEquals(registry.list().map((exporter) => exporter.id), ["mlflow"]);
    assertExists(registry.get("mlflow"));
    assertEquals(registry.get("custom-config"), undefined);
  });

  it("rejects non-HTTP tracking URIs before making MLflow REST calls", async () => {
    assertThrows(
      () =>
        createEvalReportMlflowExporter({
          trackingUri: "file:///tmp/mlruns",
          experimentName: "support-agent-classification",
        }),
      Error,
      "MLflow trackingUri must be an HTTP(S) URI: file:///tmp/mlruns",
    );

    clearMlflowEnv();
    Deno.env.set("MLFLOW_TRACKING_URI", "ftp://mlflow.test");
    const registry = createEvalReportExporterRegistry();
    const { fetchImpl } = createMlflowFetchRecorder();
    const extension = factory({ fetch: fetchImpl });

    assertThrows(
      () => extension.setup?.(createContext(registry)),
      Error,
      "MLflow trackingUri must be an HTTP(S) URI: ftp://mlflow.test",
    );
    assertEquals(registry.list(), []);
  });

  it("rejects credential-bearing tracking URIs and supports standard auth env headers", async () => {
    assertThrows(
      () =>
        createEvalReportMlflowExporter({
          trackingUri: "https://user:secret-token@mlflow.test",
          experimentName: "support-agent-classification",
        }),
      Error,
      "MLflow trackingUri must not include credentials",
    );

    clearMlflowEnv();
    Deno.env.set("MLFLOW_TRACKING_URI", "https://mlflow.test");
    Deno.env.set("MLFLOW_TRACKING_TOKEN", "secret-token");
    const registry = createEvalReportExporterRegistry();
    const { requests, fetchImpl } = createMlflowFetchRecorder();
    const extension = factory({ fetch: fetchImpl });

    await extension.setup?.(createContext(registry));
    const results = await registry.export(createReport(), {
      projectReference: "customer-support-agent",
      sourcePath: "evals/service-now-classification.eval.ts",
    });

    assertEquals(results[0]?.ok, true);
    const receipt = results[0]?.ok ? results[0].receipt : undefined;
    assertEquals(receipt?.url, "https://mlflow.test/#/experiments/exp-1/runs/run-1");
    assertEquals(JSON.stringify(results).includes("secret-token"), false);
    assertEquals(
      requests
        .filter((request) => request.method !== "PUT")
        .every((request) => request.headers.get("authorization") === "Bearer secret-token"),
      true,
    );
    assertEquals(
      requests
        .filter((request) => request.method === "PUT")
        .some((request) => request.headers.has("authorization")),
      false,
    );

    const reportUpload = requests.find((request) =>
      request.method === "PUT" &&
      request.url.endsWith("/veryfront-eval/report.json")
    );
    assertExists(reportUpload);
    assertEquals(String(reportUpload.body).includes("secret-token"), false);
  });

  it("logs a Veryfront eval report as an MLflow run", async () => {
    const { requests, fetchImpl } = createMlflowFetchRecorder();
    const exporter = createEvalReportMlflowExporter({
      trackingUri: "http://mlflow.test",
      experimentName: "support-agent-classification",
    }, fetchImpl);

    const receipt = await exporter.export(createReport(), {
      projectReference: "customer-support-agent",
      sourcePath: "evals/service-now-classification.eval.ts",
    });

    assertEquals(receipt.externalRunId, "run-1");
    assertEquals(
      receipt.url,
      "http://mlflow.test/#/experiments/exp-1/runs/run-1",
    );
    assertEquals(receipt.metadata?.artifacts, [
      "veryfront-eval/report.json",
      "veryfront-eval/summary.json",
      "veryfront-eval/results.jsonl",
    ]);

    const createRun = requests.find((request) =>
      request.url.endsWith("/api/2.0/mlflow/runs/create")
    );
    assertExists(createRun);
    const createRunBody = JSON.parse(String(createRun.body));
    assertEquals(createRunBody.experiment_id, "exp-1");
    assertEquals(createRunBody.run_name, "eval:smoke-evalrun_1");
    assertEquals(
      createRunBody.tags.some((entry: { key: string; value: string }) =>
        entry.key === "eval.source_path" &&
        entry.value === "evals/service-now-classification.eval.ts"
      ),
      true,
    );

    const logBatch = requests.find((request) =>
      request.url.endsWith("/api/2.0/mlflow/runs/log-batch")
    );
    assertExists(logBatch);
    const logBatchBody = JSON.parse(String(logBatch.body));
    const metricByKey = new Map(
      logBatchBody.metrics.map((metric: { key: string; value: number }) => [
        metric.key,
        metric.value,
      ]),
    );
    assertEquals(metricByKey.get("veryfront_pass_rate"), 1);
    assertEquals(metricByKey.get("total_tokens"), 15);
    assertEquals(
      metricByKey.get("veryfront_metric.answer_exactmatch.pass_rate"),
      1,
    );
    assertEquals(
      metricByKey.get("veryfront_metric.answer_exactmatch.score_mean"),
      1,
    );

    assertEquals(
      requests.filter((request) => request.method === "PUT").map((request) => request.url),
      [
        "http://artifacts.test/root/veryfront-eval/report.json",
        "http://artifacts.test/root/veryfront-eval/summary.json",
        "http://artifacts.test/root/veryfront-eval/results.jsonl",
      ],
    );
  });

  it("maps MLflow REST and explicit artifact endpoints for mlflow-artifacts URIs", async () => {
    const { requests, fetchImpl } = createMlflowFetchRecorder({
      artifactUri: "mlflow-artifacts:/exp-1/run-1/artifacts",
    });
    const exporter = createEvalReportMlflowExporter({
      trackingUri: "http://mlflow.test:5001",
      artifactsUri: "http://mlflow.test:5600",
      experimentName: "support-agent-classification",
    }, fetchImpl);

    await exporter.export(createReport(), {
      projectReference: "customer-support-agent",
      sourcePath: "evals/service-now-classification.eval.ts",
    });

    assertEquals(
      requests.filter((request) => request.method !== "PUT").map((request) => {
        const url = new URL(request.url);
        return {
          method: request.method,
          endpoint: `${url.origin}${url.pathname}${url.search}`,
        };
      }),
      [
        {
          method: "GET",
          endpoint:
            "http://mlflow.test:5001/api/2.0/mlflow/experiments/get-by-name?experiment_name=support-agent-classification",
        },
        {
          method: "POST",
          endpoint: "http://mlflow.test:5001/api/2.0/mlflow/experiments/create",
        },
        {
          method: "POST",
          endpoint: "http://mlflow.test:5001/api/2.0/mlflow/runs/create",
        },
        {
          method: "POST",
          endpoint: "http://mlflow.test:5001/api/2.0/mlflow/runs/log-batch",
        },
        {
          method: "POST",
          endpoint: "http://mlflow.test:5001/api/2.0/mlflow/runs/log-batch",
        },
        {
          method: "POST",
          endpoint: "http://mlflow.test:5001/api/2.0/mlflow/runs/update",
        },
      ],
    );
    assertEquals(
      requests.filter((request) => request.method === "PUT").map((request) => ({
        url: request.url,
        contentType: request.headers.get("content-type"),
      })),
      [
        {
          url:
            "http://mlflow.test:5600/api/2.0/mlflow-artifacts/artifacts/exp-1/run-1/artifacts/veryfront-eval/report.json",
          contentType: "application/json",
        },
        {
          url:
            "http://mlflow.test:5600/api/2.0/mlflow-artifacts/artifacts/exp-1/run-1/artifacts/veryfront-eval/summary.json",
          contentType: "application/json",
        },
        {
          url:
            "http://mlflow.test:5600/api/2.0/mlflow-artifacts/artifacts/exp-1/run-1/artifacts/veryfront-eval/results.jsonl",
          contentType: "application/x-ndjson",
        },
      ],
    );
  });

  it("uses only sanitized classification evidence keys for classification metrics", async () => {
    const { requests, fetchImpl } = createMlflowFetchRecorder();
    const exporter = createEvalReportMlflowExporter({
      trackingUri: "http://mlflow.test",
      experimentName: "support-agent-classification",
    }, fetchImpl);
    const baseRecord = createReport().records[0]!;
    const report: EvalReport = {
      ...createReport(),
      summary: {
        ...createReport().summary,
        records: 4,
        passed: 3,
        failed: 1,
        passRate: 3 / 4,
        metrics: [
          {
            name: "intent.classification",
            family: "answer",
            severity: "gate",
            passed: 2,
            failed: 1,
            skipped: 0,
            passRate: 2 / 3,
          },
        ],
      },
      records: [
        {
          ...baseRecord,
          id: "q1:1",
          input: { expectedCategory: "billing", predictedCategory: "billing" },
          output: { predictedCategory: "billing" },
          reference: { expectedCategory: "billing" },
          metrics: [
            {
              name: "intent.classification",
              family: "answer",
              severity: "gate",
              score: 1,
              pass: true,
              evidence: {
                expectedCategory: "billing",
                predictedCategory: "billing",
              },
            },
          ],
        },
        {
          ...baseRecord,
          id: "q2:1",
          input: { expectedCategory: "support" },
          output: { predictedCategory: "sales" },
          reference: { expectedCategory: "support" },
          metrics: [
            {
              name: "intent.classification",
              family: "answer",
              severity: "gate",
              score: 0,
              pass: false,
              evidence: {
                expected: "support",
                predicted: "sales",
              },
            },
          ],
        },
        {
          ...baseRecord,
          id: "q3:1",
          input: { expectedCategory: "technical" },
          output: { predictedCategory: "technical" },
          reference: { expectedCategory: "technical" },
          metrics: [
            {
              name: "intent.classification",
              family: "answer",
              severity: "gate",
              score: 1,
              pass: true,
              evidence: {
                expectedLabel: "technical",
                predictedLabel: "technical",
                confidence: 0.5,
              },
            },
          ],
        },
        {
          ...baseRecord,
          id: "q4:1",
          input: { expectedCategory: "ignored-input" },
          output: { predictedCategory: "ignored-output" },
          reference: { expectedCategory: "ignored-reference" },
          metrics: [
            {
              name: "intent.classification",
              family: "answer",
              severity: "gate",
              score: 1,
              pass: true,
            },
          ],
        },
      ],
    };

    await exporter.export(report, {
      projectReference: "customer-support-agent",
      sourcePath: "evals/service-now-classification.eval.ts",
    });

    const logBatch = requests.find((request) =>
      request.url.endsWith("/api/2.0/mlflow/runs/log-batch")
    );
    assertExists(logBatch);
    const logBatchBody = JSON.parse(String(logBatch.body));
    const metricByKey = new Map(
      logBatchBody.metrics.map((metric: { key: string; value: number }) => [
        metric.key,
        metric.value,
      ]),
    );

    assertEquals(metricByKey.get("evaluated_count"), 3);
    assertEquals(metricByKey.get("correct_count"), 2);
    assertEquals(metricByKey.get("failure_count"), 1);
    assertEquals(metricByKey.get("confidence_mean"), 0.5);
    assertEquals(
      metricByKey.get("classification.intent_classification.evaluated_count"),
      3,
    );
    assertEquals(
      metricByKey.get("classification.intent_classification.confidence_mean"),
      0.5,
    );
    assertEquals(
      metricByKey.get(
        "classification.intent_classification.category.billing.total",
      ),
      1,
    );
    assertEquals(
      metricByKey.get(
        "classification.intent_classification.category.support.total",
      ),
      1,
    );
    assertEquals(
      metricByKey.get(
        "classification.intent_classification.category.technical.total",
      ),
      1,
    );
    assertEquals(
      metricByKey.get(
        "classification.intent_classification.category.ignored_input.total",
      ),
      undefined,
    );
  });

  it("marks MLflow runs FAILED when the eval report has failed records", async () => {
    const { requests, fetchImpl } = createMlflowFetchRecorder();
    const exporter = createEvalReportMlflowExporter({
      trackingUri: "http://mlflow.test",
      experimentName: "support-agent-classification",
    }, fetchImpl);
    const report: EvalReport = {
      ...createReport(),
      summary: {
        ...createReport().summary,
        passed: 0,
        failed: 1,
        passRate: 0,
      },
    };

    await exporter.export(report, {
      projectReference: "customer-support-agent",
      sourcePath: "evals/service-now-classification.eval.ts",
    });

    const updates = requests.filter((request) =>
      request.url.endsWith("/api/2.0/mlflow/runs/update")
    );
    assertEquals(updates.length, 1);
    assertEquals(JSON.parse(String(updates[0]!.body)).status, "FAILED");
  });

  it("fails clearly and marks the run FAILED when s3 artifacts lack an explicit artifactsUri", async () => {
    const { requests, fetchImpl } = createMlflowFetchRecorder({
      artifactUri: "s3://mlflow-bucket/exp-1/run-1/artifacts",
    });
    const exporter = createEvalReportMlflowExporter({
      trackingUri: "http://mlflow.test",
      experimentName: "support-agent-classification",
    }, fetchImpl);

    const error = await assertRejects(
      () =>
        exporter.export(createReport(), {
          projectReference: "customer-support-agent",
          sourcePath: "evals/service-now-classification.eval.ts",
        }),
      Error,
      "MLflow artifactsUri is required for non-HTTP artifact URI s3://mlflow-bucket/exp-1/run-1/artifacts",
    );
    assertEquals(
      error.message,
      "MLflow artifactsUri is required for non-HTTP artifact URI s3://mlflow-bucket/exp-1/run-1/artifacts. Configure MLFLOW_ARTIFACTS_URI or config.artifactsUri.",
    );

    const updates = requests.filter((request) =>
      request.url.endsWith("/api/2.0/mlflow/runs/update")
    );
    assertEquals(updates.length, 1);
    assertEquals(JSON.parse(String(updates[0]!.body)).status, "FAILED");
  });

  it("uploads s3 artifacts through an explicit artifactsUri", async () => {
    const { requests, fetchImpl } = createMlflowFetchRecorder({
      artifactUri: "s3://mlflow-bucket/exp-1/run-1/artifacts",
    });
    const exporter = createEvalReportMlflowExporter({
      trackingUri: "http://mlflow.test",
      artifactsUri: "http://artifacts-proxy.test",
      experimentName: "support-agent-classification",
    }, fetchImpl);

    const receipt = await exporter.export(createReport(), {
      projectReference: "customer-support-agent",
      sourcePath: "evals/service-now-classification.eval.ts",
    });

    assertEquals(receipt.externalRunId, "run-1");
    assertEquals(
      requests.filter((request) => request.method === "PUT").map((request) => request.url),
      [
        "http://artifacts-proxy.test/api/2.0/mlflow-artifacts/artifacts/exp-1/run-1/artifacts/veryfront-eval/report.json",
        "http://artifacts-proxy.test/api/2.0/mlflow-artifacts/artifacts/exp-1/run-1/artifacts/veryfront-eval/summary.json",
        "http://artifacts-proxy.test/api/2.0/mlflow-artifacts/artifacts/exp-1/run-1/artifacts/veryfront-eval/results.jsonl",
      ],
    );
  });

  it("rejects unsupported artifact roots even when artifactsUri is explicit", async () => {
    const unsupportedArtifactUris = [
      "gs://mlflow-bucket/exp-1/run-1/artifacts",
      "dbfs://mlflow/exp-1/run-1/artifacts",
      "wasbs://container@account.blob.core.windows.net/exp-1/run-1/artifacts",
      "file:///tmp/mlruns/exp-1/run-1/artifacts",
      "/tmp/mlruns/exp-1/run-1/artifacts",
      "ftp://artifacts.test/exp-1/run-1/artifacts",
    ];

    for (const artifactUri of unsupportedArtifactUris) {
      const { requests, fetchImpl } = createMlflowFetchRecorder({
        artifactUri,
      });
      const exporter = createEvalReportMlflowExporter({
        trackingUri: "http://mlflow.test",
        artifactsUri: "http://artifacts-proxy.test",
        experimentName: "support-agent-classification",
      }, fetchImpl);

      const error = await assertRejects(
        () =>
          exporter.export(createReport(), {
            projectReference: "customer-support-agent",
            sourcePath: "evals/service-now-classification.eval.ts",
          }),
        Error,
        `Unsupported MLflow artifact URI: ${artifactUri}`,
      );
      assertEquals(
        error.message,
        `Unsupported MLflow artifact URI: ${artifactUri}. Supported proxied artifact roots: mlflow-artifacts:/, s3://`,
      );
      assertEquals(
        requests.some((request) =>
          request.method === "PUT" &&
          new URL(request.url).origin === "http://artifacts-proxy.test"
        ),
        false,
      );

      const updates = requests.filter((request) =>
        request.url.endsWith("/api/2.0/mlflow/runs/update")
      );
      assertEquals(updates.length, 1);
      assertEquals(JSON.parse(String(updates[0]!.body)).status, "FAILED");
    }
  });

  it("chunks MLflow log-batch requests above REST count limits", async () => {
    const { requests, fetchImpl } = createMlflowFetchRecorder();
    const exporter = createEvalReportMlflowExporter({
      trackingUri: "http://mlflow.test",
      experimentName: "support-agent-classification",
    }, fetchImpl);
    const baseReport = createReport();
    const report: EvalReport = {
      ...baseReport,
      summary: {
        ...baseReport.summary,
        metrics: Array.from({ length: 260 }, (_, index) => ({
          name: `metric.${index}`,
          family: "answer",
          severity: "soft",
          passed: 1,
          failed: 0,
          skipped: 0,
          passRate: 1,
        })),
      },
    };

    await exporter.export(report, {
      projectReference: "customer-support-agent",
      sourcePath: "evals/service-now-classification.eval.ts",
    });

    const metricLogBatches = requests
      .filter((request) => request.url.endsWith("/api/2.0/mlflow/runs/log-batch"))
      .map((request) => JSON.parse(String(request.body)))
      .filter((body) => body.metrics.length > 0);

    assertEquals(metricLogBatches.length > 1, true);
    assertEquals(
      metricLogBatches.every((body) =>
        body.metrics.length <= 1000 &&
        body.params.length <= 100 &&
        body.tags.length <= 100 &&
        body.metrics.length + body.params.length + body.tags.length <= 1000
      ),
      true,
    );
    assertEquals(
      metricLogBatches.reduce((sum, body) => sum + body.metrics.length, 0) >
        1000,
      true,
    );
  });

  it("normalizes overlong MLflow keys and param/tag values before log-batch upload", async () => {
    const { requests, fetchImpl } = createMlflowFetchRecorder();
    const exporter = createEvalReportMlflowExporter({
      trackingUri: "http://mlflow.test",
      experimentName: "support-agent-classification",
    }, fetchImpl);
    const longSegment = "verylongcategory".repeat(500);
    const baseReport = createReport();
    const report: EvalReport = {
      ...baseReport,
      metadata: { ...baseReport.metadata, model: `model-${longSegment}` },
      summary: {
        ...baseReport.summary,
        metrics: [
          ...baseReport.summary.metrics,
          {
            name: `classification.${longSegment}`,
            family: "judge",
            severity: "soft",
            passed: 1,
            failed: 0,
            skipped: 0,
            passRate: 1,
          },
        ],
      },
      records: baseReport.records.map((record) => ({
        ...record,
        metrics: [
          ...(record.metrics ?? []),
          {
            name: `classification.${longSegment}`,
            family: "judge",
            severity: "soft",
            pass: true,
            score: 1,
            evidence: {
              expectedCategory: `expected-${longSegment}`,
              predictedCategory: `predicted-${longSegment}`,
              confidence: 0.9,
            },
          },
        ],
      })),
    };

    await exporter.export(report, {
      projectReference: "customer-support-agent",
      sourcePath: `evals/${longSegment}.eval.ts`,
      tags: [`tag-${longSegment}`],
    });

    const logBatches = requests
      .filter((request) => request.url.endsWith("/api/2.0/mlflow/runs/log-batch"))
      .map((request) => JSON.parse(String(request.body)));
    assertEquals(logBatches.length > 0, true);
    const params = logBatches.flatMap((body) =>
      body.params as Array<{ key: string; value: string }>
    );
    const createRun = requests.find((request) =>
      request.url.endsWith("/api/2.0/mlflow/runs/create")
    );
    assertExists(createRun);
    const tags = [
      ...JSON.parse(String(createRun.body)).tags as Array<{ key: string; value: string }>,
      ...logBatches.flatMap((body) => body.tags as Array<{ key: string; value: string }>),
    ];
    const metrics = logBatches.flatMap((body) => body.metrics as Array<{ key: string }>);

    assertEquals(
      params.every((entry) => entry.key.length <= 250 && entry.value.length <= 6_000),
      true,
    );
    assertEquals(
      tags.every((entry) => entry.key.length <= 250 && entry.value.length <= 5_000),
      true,
    );
    assertEquals(metrics.every((entry) => entry.key.length <= 250), true);
    assertEquals(
      params.some((entry) => entry.value.length === 6_000 && /_[0-9a-f]{8}$/.test(entry.value)),
      true,
    );
    assertEquals(
      tags.some((entry) => entry.value.length === 5_000 && /_[0-9a-f]{8}$/.test(entry.value)),
      true,
    );
    assertEquals(
      metrics.some((entry) => entry.key.length === 250 && /_[0-9a-f]{8}/.test(entry.key)),
      true,
    );
  });

  it("fails clearly and marks the run FAILED for unsupported artifact roots", async () => {
    const { requests, fetchImpl } = createMlflowFetchRecorder({
      artifactUri: "file:///tmp/mlruns/exp-1/run-1/artifacts",
    });
    const exporter = createEvalReportMlflowExporter({
      trackingUri: "http://mlflow.test",
      experimentName: "support-agent-classification",
    }, fetchImpl);

    const error = await assertRejects(
      () =>
        exporter.export(createReport(), {
          projectReference: "customer-support-agent",
          sourcePath: "evals/service-now-classification.eval.ts",
        }),
      Error,
      "Unsupported MLflow artifact URI: file:///tmp/mlruns/exp-1/run-1/artifacts",
    );
    assertEquals(
      error.message,
      "Unsupported MLflow artifact URI: file:///tmp/mlruns/exp-1/run-1/artifacts. Supported proxied artifact roots: mlflow-artifacts:/, s3://",
    );

    const updates = requests.filter((request) =>
      request.url.endsWith("/api/2.0/mlflow/runs/update")
    );
    assertEquals(updates.length, 1);
    assertEquals(JSON.parse(String(updates[0]!.body)).status, "FAILED");
  });

  it("uses registry default redaction before uploading report artifacts", async () => {
    const registry = createEvalReportExporterRegistry();
    const { requests, fetchImpl } = createMlflowFetchRecorder();
    registry.register(createEvalReportMlflowExporter({
      trackingUri: "http://mlflow.test",
      experimentName: "support-agent-classification",
    }, fetchImpl));

    const results = await registry.export(createSensitiveReport(), {
      projectReference: "customer-support-agent",
      sourcePath: "evals/service-now-classification.eval.ts",
    });

    assertEquals(results[0]?.ok, true);
    const reportUpload = requests.find((request) =>
      request.method === "PUT" &&
      request.url.endsWith("/veryfront-eval/report.json")
    );
    assertExists(reportUpload);
    const uploadedReport = JSON.parse(String(reportUpload.body)) as EvalReport;
    const record = uploadedReport.records[0];
    assertExists(record);
    assertEquals(record.input, "[redacted]");
    assertEquals(record.output, "[redacted]");
    assertEquals(record.reference, "[redacted]");
    assertEquals(record.metadata, {});
    assertEquals(record.trace, { events: [], toolCalls: [] });
    assertEquals(record.metrics?.[0]?.explanation, undefined);
    assertEquals(record.metrics?.[0]?.evidence, undefined);
  });
});
