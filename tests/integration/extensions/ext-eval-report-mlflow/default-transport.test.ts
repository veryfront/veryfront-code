import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { withEnv } from "#veryfront/testing/deno-compat.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import type { EvalReport } from "veryfront/eval";
import type { ExtensionContext } from "veryfront/extensions";
import {
  createEvalReportExporterRegistry,
  type EvalReportExporterRegistry,
  EvalReportExporterRegistryName,
} from "veryfront/extensions/eval";
import factory from "../../../../extensions/ext-eval-report-mlflow/src/index.ts";

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
      metrics: [],
      duration: { totalMs: 1, minMs: 1, maxMs: 1, meanMs: 1, p50Ms: 1, p95Ms: 1 },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 },
    },
    records: [],
  };
}

it("treats an empty configured OAuth token URL as unset on the default transport", async () => {
  const requests: Array<{ method: string; headers: Headers }> = [];
  const fetchImpl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    requests.push({ method: init?.method ?? "GET", headers: new Headers(init?.headers) });
    if (url.includes("/experiments/get-by-name")) {
      return Promise.resolve(Response.json({ error_code: "RESOURCE_DOES_NOT_EXIST" }, {
        status: 404,
      }));
    }
    if (url.endsWith("/experiments/create")) {
      return Promise.resolve(Response.json({ experiment_id: "exp-1" }));
    }
    if (url.endsWith("/runs/create")) {
      return Promise.resolve(Response.json({
        run: { info: { run_id: "run-1", artifact_uri: "https://artifacts.test/root" } },
      }));
    }
    if (url.includes("/artifacts/list")) {
      return Promise.resolve(Response.json({ root_uri: "https://artifacts.test/root", files: [] }));
    }
    return Promise.resolve(Response.json({}));
  };

  await withEnv({
    MLFLOW_TRACKING_URI: "https://mlflow.test",
    MLFLOW_TRACKING_TOKEN: "host-token",
    MLFLOW_OAUTH_TOKEN_URL: "",
    MLFLOW_OAUTH_CLIENT_ID: "",
    MLFLOW_OAUTH_CLIENT_SECRET: "",
    MLFLOW_EXPORT_ARTIFACTS: "false",
  }, async () => {
    const registry = createEvalReportExporterRegistry();
    const extension = factory({ oauthTokenUrl: "", fetch: undefined });
    const results = await withMockFetch(fetchImpl, async () => {
      await extension.setup?.(createContext(registry));
      return await registry.export(createReport(), {});
    });

    assertEquals(results[0]?.ok, true);
    assertEquals(requests.length > 0, true);
    assertEquals(
      requests.filter(({ method }) => method !== "PUT").every(({ headers }) =>
        headers.get("authorization") === "Bearer host-token"
      ),
      true,
    );
  });
});
