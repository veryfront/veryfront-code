import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type {
  ProjectTraceProvider,
  TracingExporter,
} from "#veryfront/extensions/observability/tracing-exporter.ts";
import type { ProjectTraceConfigResult } from "#veryfront/server/project-env/telemetry-config.ts";
import { ProjectTraceRegistry } from "./project-trace-registry.ts";
import { createProjectOtlpTransport } from "./project-otlp-transport.ts";
import { runWithProjectTraceProvider } from "./project-trace-scope.ts";
import { type Context, type Span, trace, type Tracer } from "./api-shim.ts";
import { formatTraceparent } from "./traceparent.ts";

let owner: TracingExporter | undefined;
let registry: ProjectTraceRegistry<ProjectTraceProvider> | undefined;

function getRegistry(): ProjectTraceRegistry<ProjectTraceProvider> | undefined {
  const exporter = tryResolve<TracingExporter>("TracingExporter");
  if (exporter !== owner) {
    if (registry) void registry.shutdown();
    owner = exporter;
    registry = exporter?.createProjectProvider
      ? new ProjectTraceRegistry((config) =>
        exporter.createProjectProvider!({
          resource: {
            "service.name": config.serviceName,
            "service.version": config.serviceVersion,
            "deployment.environment.name": config.deploymentEnvironment,
            "project.id": config.projectId,
            "environment.id": config.environmentId,
          },
          createTransport: (suppress) =>
            createProjectOtlpTransport({
              endpoint: config.endpoint,
              headers: config.headers,
              withSuppressedTracing: suppress,
            }),
        })
      )
      : undefined;
  }
  return registry;
}

/** Test/runtime flush boundary; HTTP responses never wait for collector delivery. */
export async function flushProjectHttpTracing(): Promise<void> {
  // Registry entries own their normal batching; shutdown is the process flush boundary.
  await registry?.flush((session) => session.forceFlush());
}

export async function shutdownProjectHttpTracing(): Promise<void> {
  const previous = registry;
  registry = undefined;
  owner = undefined;
  await previous?.shutdown();
}

/** Enter only after authenticated project configuration has been resolved. */
export async function runProjectHttpTracing<T extends Response | undefined>(
  settings: ProjectTraceConfigResult,
  identity: { projectId?: string; environmentId?: string },
  request: Request,
  operation: () => Promise<T>,
): Promise<T> {
  const active = getRegistry();
  if (settings.status !== "enabled" || !active || request.signal.aborted) {
    if (active && settings.status !== "enabled" && identity.projectId && identity.environmentId) {
      void active.disable(identity.projectId, identity.environmentId);
    }
    return runWithProjectTraceProvider(undefined, operation);
  }
  const lease = await active.acquire(settings.config);
  if (!lease) return runWithProjectTraceProvider(undefined, operation);

  let span: Span;
  let parent: Context;
  try {
    const tracer = lease.session.getProvider().getTracer("veryfront.application.http") as Tracer;
    const platform = trace.getActiveSpan()?.spanContext();
    span = tracer.startSpan("http.server.request", {
      root: true,
      kind: 1,
      attributes: {
        "http.request.method": request.method,
        "url.path": new URL(request.url).pathname,
      },
      links: platform && formatTraceparent(platform)
        ? [{ context: platform, attributes: { "veryfront.link.type": "platform-request" } }]
        : undefined,
    });
    const api = lease.session.getTraceAPI();
    parent = api.setSpan(lease.session.getContextAPI().active(), span) as Context;
  } catch {
    lease.release();
    return runWithProjectTraceProvider(undefined, operation);
  }

  try {
    const response = await runWithProjectTraceProvider(
      lease.session,
      () => lease.session.getContextAPI().with(parent, operation),
    );
    try {
      span.setAttribute("http.response.status_code", response?.status ?? 404);
      if (response && response.status >= 500) {
        span.setStatus({ code: 2, message: "Application request failed" });
      }
    } catch { /* Telemetry must not change the response. */ }
    return response;
  } catch (error) {
    try {
      span.setStatus({ code: 2, message: "Application request failed" });
    } catch { /* Preserve the application's original error. */ }
    throw error;
  } finally {
    try {
      span.end();
    } catch { /* Release even if a third-party provider fails. */ }
    lease.release();
  }
}
