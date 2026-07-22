import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { ApiRouteMissInput } from "#veryfront/routing/api/handler.ts";
import { VeryfrontError } from "#veryfront/errors";
import type { AgentServiceRuntimeBundle } from "#veryfront/agent/service/runtime.ts";
import type {
  NodeVeryfrontCloudAgentServiceOptions,
  NodeVeryfrontCloudAgentServicePreparedExecution,
} from "#veryfront/agent/hosted/veryfront-cloud-agent-service.ts";
import { serverLogger } from "#veryfront/utils";

const AG_UI_PATH = "/api/ag-ui";
const AGENT_SELECTION_REQUIRED = "AGENT_SELECTION_REQUIRED";

type DevAgentRuntimeBundle = Pick<
  AgentServiceRuntimeBundle<NodeVeryfrontCloudAgentServicePreparedExecution>,
  "routeSet" | "lifecycle"
>;

type DevAgentRuntimeFactory = (
  options: NodeVeryfrontCloudAgentServiceOptions,
) => Promise<DevAgentRuntimeBundle>;

export interface DevAgentAgUiFallbackOptions {
  projectDir: string;
  adapter: RuntimeAdapter;
  createRuntime?: DevAgentRuntimeFactory;
}

interface AgentSelectionFailure {
  agents: string[];
}

const logger = serverLogger.component("dev-agent-ag-ui-fallback");

async function createDefaultRuntime(
  options: NodeVeryfrontCloudAgentServiceOptions,
): Promise<DevAgentRuntimeBundle> {
  const { createNodeVeryfrontCloudAgentServiceRuntime } = await import(
    "#veryfront/agent/hosted/veryfront-cloud-agent-service.ts"
  );
  return createNodeVeryfrontCloudAgentServiceRuntime(options);
}

function parseAgentSelectionFailure(error: unknown): AgentSelectionFailure | null {
  if (!(error instanceof VeryfrontError) || error.slug !== "config-invalid") {
    return null;
  }

  const detail = error.detail ?? error.message;
  const match = detail.match(/Discovered agents:\s*([^.]*)\./);
  if (!match) return null;

  const discovered = match[1]?.trim() ?? "";
  if (!discovered || discovered === "none") {
    return { agents: [] };
  }

  const agents = discovered.split(",").map((agent) => agent.trim()).filter(Boolean);
  return agents.length > 1 ? { agents } : null;
}

function agentSelectionRequiredResponse(failure: AgentSelectionFailure): Response {
  return Response.json(
    {
      error: AGENT_SELECTION_REQUIRED,
      errorCode: AGENT_SELECTION_REQUIRED,
      message: "Select an agent for /api/ag-ui when multiple project agents are discovered.",
      agents: failure.agents,
    },
    { status: 400 },
  );
}

export class DevAgentAgUiFallback {
  private runtimePromise: Promise<DevAgentRuntimeBundle> | null = null;
  private readonly createRuntime: DevAgentRuntimeFactory;

  constructor(private readonly options: DevAgentAgUiFallbackOptions) {
    this.createRuntime = options.createRuntime ?? createDefaultRuntime;
  }

  async handle(input: ApiRouteMissInput): Promise<Response | null> {
    if (!this.shouldHandle(input)) return null;

    try {
      const runtime = await this.getRuntime();
      return await runtime.routeSet.handleAgUiRequest(input.request);
    } catch (error) {
      const selectionFailure = parseAgentSelectionFailure(error);
      if (!selectionFailure) throw error;
      if (selectionFailure.agents.length === 0) return null;
      return agentSelectionRequiredResponse(selectionFailure);
    }
  }

  invalidate(): void {
    const runtimePromise = this.runtimePromise;
    this.runtimePromise = null;
    if (!runtimePromise) return;

    void runtimePromise
      .then((runtime) => runtime.lifecycle.stop())
      .catch((error) => {
        logger.debug("Failed to stop dev AG-UI fallback runtime", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  private shouldHandle(input: ApiRouteMissInput): boolean {
    return input.ctx?.isLocalProject === true &&
      input.pathname === AG_UI_PATH &&
      input.request.method.toUpperCase() === "POST";
  }

  private getRuntime(): Promise<DevAgentRuntimeBundle> {
    this.runtimePromise ??= this.createRuntime({
      projectDir: this.options.projectDir,
      baseDir: this.options.projectDir,
      env: this.options.adapter.env.toObject(),
    });
    return this.runtimePromise;
  }
}
