import { createAgUiHandler } from "#veryfront/agent/ag-ui/handler.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import type { AgentServiceEvalAdapterConfig } from "#veryfront/eval/agent-service.ts";
import type {
  EvalDefinition,
  EvalMetricResult,
  EvalRecord,
  EvalReport,
} from "#veryfront/eval/types.ts";
import { INPUT_VALIDATION_FAILED, INVALID_ARGUMENT, NOT_SUPPORTED } from "#veryfront/errors";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import type { SerializedProjectRunResult } from "#veryfront/security/sandbox/worker-types.ts";
import { parseProjectDomain } from "#veryfront/server/utils/domain-parser.ts";
import type { HandlerContext } from "../types.ts";
import {
  getProjectRunPositiveIntConfig,
  getProjectRunStringArrayConfig,
  getProjectRunStringConfig,
} from "./project-run-config.ts";
import { isProjectRunRecord, projectRunErrorMessage } from "./project-run-http-policy.ts";
import { getProjectRunRuntimeApiToken } from "./project-run-runtime-api.ts";
import type {
  ProjectRunExecuteHandlerDeps,
  ProjectRunExecuteRequest,
  ProjectRunExecuteResponse,
} from "./project-run-types.ts";

const DEFAULT_LOCAL_AG_UI_PORT = 3001;

function sanitizePathSegment(value: string, fallback: string): string {
  const normalized = value
    .replace(/^eval:/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return normalized || fallback;
}

function buildEvalReportPath(report: EvalReport, request: ProjectRunExecuteRequest): string {
  const evalId = sanitizePathSegment(report.definitionId || request.target, "eval");
  const runId = sanitizePathSegment(request.runId, "run");
  return `evals/reports/${evalId}/${runId}.json`;
}

function createEvalReportArtifact(path: string): Record<string, string> {
  return { kind: "eval-report", path, contentType: "application/json" };
}

function getHeaderFirstValue(value: string | null): string | undefined {
  return value?.split(",")[0]?.trim() || undefined;
}

function parseAgUiEndpoint(endpoint: string): URL | null {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.pathname !== "/api/ag-ui") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

function isLocalAgUiEndpoint(endpoint: string): boolean {
  const endpointUrl = parseAgUiEndpoint(endpoint);
  return endpointUrl !== null && isLocalHostname(endpointUrl.hostname);
}

function isRequestSiblingAgUiEndpoint(endpoint: string, req: Request): boolean {
  const endpointUrl = parseAgUiEndpoint(endpoint);
  return endpointUrl?.protocol === "https:" && endpointUrl.origin === new URL(req.url).origin;
}

interface ManagedProjectAgUiEndpointContext {
  forwardedHost: string;
  forwardedProto: string;
  environment: "preview" | "production";
}

function getManagedProjectAgUiEndpointContext(
  endpoint?: string,
  projectSlug?: string,
): ManagedProjectAgUiEndpointContext | null {
  if (!endpoint || !projectSlug) return null;
  const endpointUrl = parseAgUiEndpoint(endpoint);
  if (!endpointUrl || endpointUrl.protocol !== "https:") return null;
  const parsed = parseProjectDomain(endpointUrl.host);
  if (!parsed.isVeryfrontDomain || parsed.slug !== projectSlug) return null;
  return {
    forwardedHost: endpointUrl.host,
    forwardedProto: endpointUrl.protocol.replace(/:$/, ""),
    environment: parsed.environment === "preview" ? "preview" : "production",
  };
}

function getRuntimeLocalPort(req: Request): number {
  const url = new URL(req.url);
  const requestPort = isLocalHostname(url.hostname) ? url.port : "";
  for (const value of [getHostEnv("PORT"), getHostEnv("VERYFRONT_PORT"), requestPort]) {
    if (!value) continue;
    const port = Number.parseInt(value, 10);
    if (Number.isInteger(port) && port > 0 && port <= 65_535) return port;
  }
  return DEFAULT_LOCAL_AG_UI_PORT;
}

function getLocalAgUiEndpoint(req: Request): string {
  return `http://127.0.0.1:${getRuntimeLocalPort(req)}/api/ag-ui`;
}

function resolveEvalAgUiEndpoint(
  req: Request,
  endpoint?: string,
  projectSlug?: string,
): string {
  if (!endpoint) return getLocalAgUiEndpoint(req);
  if (
    !isRequestSiblingAgUiEndpoint(endpoint, req) &&
    !getManagedProjectAgUiEndpointContext(endpoint, projectSlug) &&
    !isLocalAgUiEndpoint(endpoint)
  ) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "runtimeAgUiEndpoint must target this project runtime",
    });
  }
  return getLocalAgUiEndpoint(req);
}

function createLocalEvalAgentFetch(input: {
  endpoint: string;
  agentId?: string;
}): AgentServiceEvalAdapterConfig["fetch"] | undefined {
  if (!input.agentId || !isLocalAgUiEndpoint(input.endpoint)) return undefined;
  const agent = agentRegistry.get(input.agentId);
  if (!agent) return undefined;
  const handler = createAgUiHandler({ agent });
  return async (requestInput, init) => {
    const request = new Request(requestInput, init);
    if (!isLocalAgUiEndpoint(request.url)) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "Localized eval requests must target the local AG-UI endpoint",
      });
    }
    return await handler(request);
  };
}

function isBlockingEvalResult(result: EvalMetricResult): boolean {
  return !result.skipped && result.pass === false &&
    (result.severity === "gate" || result.severity === "budget");
}

function countFailedEvalRecords(report: EvalReport): number {
  return report.records.filter((record: EvalRecord) =>
    !record.completed || Boolean(record.error) ||
    [...(record.metrics ?? []), ...(record.checks ?? [])].some(isBlockingEvalResult)
  ).length;
}

function withEvalRunConfig(
  definition: EvalDefinition,
  config: Record<string, unknown>,
): EvalDefinition {
  const repetitions = getProjectRunPositiveIntConfig(config, [
    "repetitions",
    "repeat",
    "repetitionCount",
  ]);
  return repetitions === undefined || repetitions === definition.repetitions
    ? definition
    : { ...definition, repetitions };
}

function getEvalTargetAgentId(definition: EvalDefinition): string | undefined {
  if (definition.targetKind !== "agent") return undefined;
  const target = definition.target.startsWith("agent:")
    ? definition.target.slice("agent:".length)
    : definition.target;
  return target || undefined;
}

type EvalAdapterConfigInput = {
  request: ProjectRunExecuteRequest;
  req: Request;
  ctx: HandlerContext;
};

function createEvalAdapterConfigForAgent(
  input: EvalAdapterConfigInput & { agentId?: string },
): AgentServiceEvalAdapterConfig {
  const config = input.request.config ?? {};
  const runInput = input.request.input ?? {};
  const authToken = getProjectRunRuntimeApiToken(input.req, input.ctx);
  if (!authToken) {
    throw INVALID_ARGUMENT.create({ detail: "Missing project runtime API token" });
  }
  const managedEndpoint = getManagedProjectAgUiEndpointContext(
    input.request.runtimeAgUiEndpoint,
    input.ctx.projectSlug,
  );
  const endpoint = resolveEvalAgUiEndpoint(
    input.req,
    input.request.runtimeAgUiEndpoint,
    input.ctx.projectSlug,
  );
  return {
    endpoint,
    authToken,
    agentId: input.agentId,
    projectId: input.request.projectId,
    projectSlug: input.ctx.projectSlug,
    releaseId: input.req.headers.get("x-release-id") ?? input.ctx.releaseId,
    contentSourceId: input.req.headers.get("x-content-source-id"),
    branchId: getProjectRunStringConfig(config, ["branch_id", "branchId"]) ??
      getProjectRunStringConfig(runInput, ["branch_id", "branchId"]) ??
      input.req.headers.get("x-branch-id"),
    branchName: input.req.headers.get("x-branch-name"),
    environment: managedEndpoint?.environment ?? input.req.headers.get("x-environment") ??
      input.ctx.resolvedEnvironment,
    environmentId: input.req.headers.get("x-environment-id") ?? input.ctx.environmentId,
    forwardedHost: managedEndpoint?.forwardedHost ??
      getHeaderFirstValue(input.req.headers.get("x-forwarded-host")),
    forwardedProto: managedEndpoint?.forwardedProto ??
      getHeaderFirstValue(input.req.headers.get("x-forwarded-proto")),
    model: getProjectRunStringConfig(config, ["model"]),
    allowedTools: getProjectRunStringArrayConfig(config, ["allowed_tools", "allowedTools"]),
    maxSteps: getProjectRunPositiveIntConfig(config, ["max_steps", "maxSteps"]),
    fetch: createLocalEvalAgentFetch({ endpoint, agentId: input.agentId }),
  };
}

function createLocalEvalAdapterConfig(
  input: EvalAdapterConfigInput & { definition: EvalDefinition },
): AgentServiceEvalAdapterConfig {
  return createEvalAdapterConfigForAgent({
    ...input,
    agentId: getEvalTargetAgentId(input.definition),
  });
}

function createIsolatedEvalAdapterConfig(
  input: EvalAdapterConfigInput,
): AgentServiceEvalAdapterConfig {
  let endpoint = input.request.runtimeAgUiEndpoint;
  if (!endpoint) {
    const requestUrl = new URL(input.req.url);
    const requestDomain = parseProjectDomain(requestUrl.host);
    if (
      requestUrl.protocol === "https:" && requestDomain.isVeryfrontDomain &&
      requestDomain.slug === input.ctx.projectSlug
    ) {
      endpoint = new URL("/api/ag-ui", requestUrl).toString();
    }
  }
  if (!endpoint) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "runtimeAgUiEndpoint is required for remote eval execution",
    });
  }
  resolveEvalAgUiEndpoint(input.req, endpoint, input.ctx.projectSlug);
  const endpointUrl = parseAgUiEndpoint(endpoint);
  if (!endpointUrl || endpointUrl.protocol !== "https:") {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "runtimeAgUiEndpoint must use HTTPS for remote eval execution",
    });
  }
  if (isLocalHostname(endpointUrl.hostname)) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "runtimeAgUiEndpoint must target a public project runtime",
    });
  }

  const result = {
    ...createEvalAdapterConfigForAgent(input),
    endpoint: endpointUrl.toString(),
  };
  delete result.fetch;
  return result;
}

function fromIsolatedResult(result: SerializedProjectRunResult): ProjectRunExecuteResponse {
  return {
    success: result.success,
    ...(Object.hasOwn(result, "result") ? { result: result.result } : {}),
    ...(result.error === undefined ? {} : { error: result.error }),
    duration_ms: result.durationMs,
    logs: null,
  };
}

function parseIsolatedEvalReport(
  value: unknown,
  request: ProjectRunExecuteRequest,
): EvalReport {
  if (!isProjectRunRecord(value)) throw new TypeError("Isolated eval returned an invalid report");
  const summary = value.summary;
  const records = value.records;
  if (
    value.kind !== "eval-report" || value.runId !== request.runId ||
    value.definitionId !== request.target ||
    (value.targetKind !== "agent" && value.targetKind !== "tool") ||
    typeof value.target !== "string" || !isProjectRunRecord(summary) ||
    !Number.isSafeInteger(summary.failed) || (summary.failed as number) < 0 ||
    !Array.isArray(records) || records.length > 100_000
  ) {
    throw new TypeError("Isolated eval returned an invalid report");
  }
  return value as unknown as EvalReport;
}

async function uploadEvalReport(
  request: ProjectRunExecuteRequest,
  ctx: HandlerContext,
  req: Request,
  report: EvalReport,
  deps: ProjectRunExecuteHandlerDeps,
): Promise<{ reportPath: string | null; uploadError: string | null }> {
  const projectReference = ctx.projectSlug ?? request.projectId;
  const requestedReportPath = buildEvalReportPath(report, request);
  try {
    return {
      reportPath: await deps.uploadEvalReport({
        request,
        ctx,
        req,
        report,
        projectReference,
        reportPath: requestedReportPath,
      }),
      uploadError: null,
    };
  } catch (error) {
    return {
      reportPath: null,
      uploadError: `Eval report upload failed: ${projectRunErrorMessage(error)}`,
    };
  }
}

export async function executeRemoteTaskRun(
  request: ProjectRunExecuteRequest,
  ctx: HandlerContext,
  req: Request,
  deps: ProjectRunExecuteHandlerDeps,
): Promise<ProjectRunExecuteResponse> {
  if (!deps.executeIsolatedProjectRun) {
    throw NOT_SUPPORTED.create({ detail: "Remote project run isolation is unavailable" });
  }
  return fromIsolatedResult(await deps.executeIsolatedProjectRun({ request, ctx, req }));
}

export async function executeRemoteEvalRun(
  request: ProjectRunExecuteRequest,
  ctx: HandlerContext,
  req: Request,
  deps: ProjectRunExecuteHandlerDeps,
): Promise<ProjectRunExecuteResponse> {
  if (!deps.executeIsolatedProjectRun) {
    throw NOT_SUPPORTED.create({ detail: "Remote project run isolation is unavailable" });
  }
  const isolated = await deps.executeIsolatedProjectRun({
    request,
    ctx,
    req,
    evalAgentAdapter: createIsolatedEvalAdapterConfig({ request, req, ctx }),
  });
  const response = fromIsolatedResult(isolated);
  if (!Object.hasOwn(isolated, "result")) return response;

  const report = parseIsolatedEvalReport(isolated.result, request);
  const { reportPath, uploadError } = await uploadEvalReport(request, ctx, req, report, deps);
  return {
    ...response,
    result: reportPath ? { ...report, reportPath } : report,
    ...(reportPath ? { artifacts: [createEvalReportArtifact(reportPath)] } : {}),
    logs: uploadError,
  };
}

export async function executeLocalEvalRun(
  request: ProjectRunExecuteRequest,
  ctx: HandlerContext,
  req: Request,
  deps: ProjectRunExecuteHandlerDeps,
): Promise<ProjectRunExecuteResponse> {
  const startedAt = deps.now();
  await deps.ensureProjectDiscovery(ctx);
  const evalItem = await deps.findEvalById(request.target, {
    projectDir: ctx.projectDir,
    adapter: ctx.adapter,
    config: ctx.config,
    debug: ctx.debug,
  });
  if (!evalItem) {
    return {
      success: false,
      error: `Eval not found: ${request.target}`,
      logs: null,
      duration_ms: 0,
    };
  }

  const report = await deps.runEval(
    withEvalRunConfig(evalItem.definition, request.config ?? {}),
    {
      adapters: {
        agent: deps.createEvalAgentAdapter(
          createLocalEvalAdapterConfig({ request, definition: evalItem.definition, req, ctx }),
        ),
      },
      baseDir: ctx.projectDir,
      runId: request.runId,
    },
  );
  const failed = Math.max(report.summary.failed, countFailedEvalRecords(report));
  const { reportPath, uploadError } = await uploadEvalReport(request, ctx, req, report, deps);
  return {
    success: failed === 0,
    result: reportPath ? { ...report, reportPath } : report,
    ...(reportPath ? { artifacts: [createEvalReportArtifact(reportPath)] } : {}),
    ...(failed > 0 ? { error: `${failed} eval record${failed === 1 ? "" : "s"} failed` } : {}),
    logs: uploadError,
    duration_ms: Math.max(0, deps.now() - startedAt),
  };
}
