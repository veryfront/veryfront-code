import {
  buildRuntimeAgentControlPlaneStreamRequestFromInvocation,
  type RuntimeAgentProjectContext,
  RuntimeAgentRunInvocationSchema,
  type RuntimeAgentTargetSelectionInput,
} from "#veryfront/agent/runtime/agent-invocation-contract.ts";
import {
  getInternalAgentStreamRequestSchema,
  type InternalAgentStreamRequest,
  type RuntimeAgentSourceContext,
} from "#veryfront/internal-agents/schema.ts";
import {
  type AgentRunWorkerCoordinator,
  agentRunWorkerCoordinator,
  type AgentRunWorkerTransport,
} from "#veryfront/internal-agents/agent-run-worker-coordinator.ts";
import {
  resolveRuntimeOwnerInvokeUrl,
  RUNTIME_OWNER_INVOKE_URL_HEADER,
} from "#veryfront/internal-agents/runtime-owner.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { resolveVeryfrontApiBaseUrlFromHostEnv } from "#veryfront/platform/cloud/resolver.ts";
import { buildAgentRunExecutionBundle } from "#veryfront/security/sandbox/agent-run-bundle-builder.ts";
import { AgentRunWorkerClient } from "#veryfront/security/sandbox/agent-run-worker-client.ts";
import { createAgentRunSourceBindingKey } from "#veryfront/security/sandbox/agent-run-worker-contract.ts";
import type { HandlerContext } from "../types.ts";
import { buildAgentRunProjectEnvironment } from "./agent-stream-environment-service.ts";

type SourceContextFsWrapper = {
  isMultiProjectMode?: () => boolean;
  runWithContext?: <R>(
    slug: string,
    token: string,
    fn: () => Promise<R>,
    projectId?: string,
    options?: {
      productionMode?: boolean;
      releaseId?: string | null;
      branch?: string | null;
      environmentName?: string | null;
    },
  ) => Promise<R>;
};

export interface ParsedAgentStreamPayload {
  payload: InternalAgentStreamRequest;
  project: Pick<RuntimeAgentProjectContext, "projectId" | "projectSlug">;
  runtimeTarget: RuntimeAgentTargetSelectionInput;
}

export interface AgentStreamIsolationDeps {
  coordinator?: AgentRunWorkerCoordinator;
  resolveRuntimeOwnerInvokeUrl?: typeof resolveRuntimeOwnerInvokeUrl;
  createWorkerClient?: (
    bundle: ConstructorParameters<typeof AgentRunWorkerClient>[0],
    coordinator: AgentRunWorkerCoordinator,
  ) => IsolatedAgentRunClient;
  buildBundle?: typeof buildAgentRunExecutionBundle;
  buildProjectEnvironment?: typeof buildAgentRunProjectEnvironment;
}

export interface IsolatedAgentRunClient extends AgentRunWorkerTransport {
  start(): Promise<Response>;
}

export function parseAgentStreamPayload(rawPayload: unknown): ParsedAgentStreamPayload {
  const invocation = RuntimeAgentRunInvocationSchema.parse(rawPayload);
  return {
    payload: getInternalAgentStreamRequestSchema().parse(
      buildRuntimeAgentControlPlaneStreamRequestFromInvocation(invocation),
    ),
    project: {
      projectId: invocation.run.project.projectId,
      projectSlug: invocation.run.project.projectSlug,
    },
    runtimeTarget: {
      runtimeTargetKind: invocation.run.project.runtimeTargetKind,
      runtimeTargetEnvironmentId: invocation.run.project.runtimeTargetEnvironmentId,
      runtimeTargetBranchId: invocation.run.project.runtimeTargetBranchId,
    },
  };
}

function sourceRunOptions(source: RuntimeAgentSourceContext): {
  productionMode: boolean;
  releaseId?: string | null;
  branch?: string | null;
  environmentName?: string | null;
} {
  switch (source.type) {
    case "branch":
      return { productionMode: false, branch: source.branch };
    case "environment":
      return {
        productionMode: true,
        environmentName: source.environmentName,
        releaseId: source.releaseId,
      };
    case "release":
      return { productionMode: true, releaseId: source.releaseId };
  }
}

export function withAgentSourceContext<T>(
  ctx: HandlerContext,
  source: RuntimeAgentSourceContext,
  token: string,
  operation: () => Promise<T>,
): Promise<T> {
  const fs = ctx.adapter.fs as SourceContextFsWrapper;
  if (!ctx.projectSlug || !fs.isMultiProjectMode?.() || !fs.runWithContext) {
    throw new TypeError("Alternate agent source requires a multi-project runtime context");
  }
  return fs.runWithContext(
    ctx.projectSlug,
    token,
    operation,
    ctx.projectId,
    sourceRunOptions(source),
  );
}

function setResponseHeader(response: Response, key: string, value: string): Response {
  const headers = new Headers(response.headers);
  headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function createAgentRunWorkerClient(
  bundle: ConstructorParameters<typeof AgentRunWorkerClient>[0],
  coordinator: AgentRunWorkerCoordinator,
): IsolatedAgentRunClient {
  return new AgentRunWorkerClient(bundle, {
    onTerminal: (status) => coordinator.releaseRun(bundle.run.runId, status),
  });
}

/** Build and execute one exact-source agent run without importing project code in the host. */
export async function executeIsolatedAgentStream(input: {
  req: Request;
  ctx: HandlerContext;
  parsed: ParsedAgentStreamPayload;
  apiAuthToken: string;
  deps?: AgentStreamIsolationDeps;
}): Promise<Response> {
  const deps = input.deps ?? {};
  const coordinator = deps.coordinator ?? agentRunWorkerCoordinator;
  const buildProjectEnvironment = deps.buildProjectEnvironment ?? buildAgentRunProjectEnvironment;
  const buildBundle = deps.buildBundle ?? buildAgentRunExecutionBundle;
  const createWorker = deps.createWorkerClient ?? createAgentRunWorkerClient;
  const ownerUrl = await (deps.resolveRuntimeOwnerInvokeUrl ?? resolveRuntimeOwnerInvokeUrl)(
    input.req,
  );
  const projectEnv = await buildProjectEnvironment({
    projectSlug: input.ctx.projectSlug,
    token: input.apiAuthToken,
    contextEnvironmentId: input.ctx.environmentId,
    runtimeTarget: input.parsed.runtimeTarget,
  });
  const projectId = input.parsed.project.projectId;
  const projectSlug = input.parsed.project.projectSlug;
  const configuredStudioMcpUrl = getHostEnv("VERYFRONT_STUDIO_MCP_URL")?.trim();
  const bundle = await buildBundle({
    projectDir: input.ctx.projectDir,
    adapter: input.ctx.adapter,
    run: {
      runId: input.parsed.payload.runId,
      agentId: input.parsed.payload.agentId,
      projectId,
      projectSlug,
      runtimeTarget: input.parsed.runtimeTarget,
    },
    request: input.parsed.payload,
    projectEnv,
    framework: {
      apiUrl: resolveVeryfrontApiBaseUrlFromHostEnv(),
      ...(input.apiAuthToken ? { authToken: input.apiAuthToken } : {}),
      projectId,
      ...(configuredStudioMcpUrl ? { studioMcpUrl: configuredStudioMcpUrl } : {}),
    },
    signal: input.req.signal,
  });
  const client = createWorker(bundle, coordinator);
  try {
    coordinator.registerRun({
      runId: bundle.run.runId,
      binding: { projectId, projectSlug },
      sourceBindingKey: createAgentRunSourceBindingKey(bundle),
      transport: client,
    });
  } catch (error) {
    client.terminate("registration-failed");
    throw error;
  }

  let response: Response;
  try {
    response = await client.start();
  } catch (error) {
    await coordinator.releaseRun(bundle.run.runId, "failed");
    throw error;
  }
  return ownerUrl
    ? setResponseHeader(response, RUNTIME_OWNER_INVOKE_URL_HEADER, ownerUrl)
    : response;
}
