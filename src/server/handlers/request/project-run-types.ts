import type { AgentServiceEvalAdapterConfig } from "#veryfront/eval/agent-service.ts";
import type {
  EvalAgentAdapter,
  EvalDefinition,
  EvalReport,
  RunEvalOptions,
} from "#veryfront/eval/types.ts";
import type { DiscoveryResult } from "#veryfront/discovery";
import type { DiscoveredEval } from "#veryfront/eval/discovery.ts";
import type { RuntimeAdapter } from "#veryfront/platform";
import type { VeryfrontConfig } from "#veryfront/config";
import type { SerializedProjectRunResult } from "#veryfront/security/sandbox/worker-types.ts";
import type { RunTaskOptions, TaskRunResult } from "#veryfront/task/runner.ts";
import type { DiscoveredWorkflow } from "#veryfront/workflow/discovery";
import type { WorkflowClientConfig } from "#veryfront/workflow";
import type { HandlerContext } from "../types.ts";

export interface ProjectRunExecuteRequest {
  runId: string;
  kind: "task" | "workflow" | "eval";
  target: string;
  projectId: string;
  runtimeAgUiEndpoint?: string;
  runtimeTargetKind?: "main_branch" | "environment" | "preview_branch";
  runtimeTargetEnvironmentId?: string | null;
  runtimeTargetBranchId?: string | null;
  config?: Record<string, unknown>;
  input?: Record<string, unknown>;
}

export interface ProjectRunExecuteResponse {
  success: boolean;
  result?: unknown;
  logs?: string | null;
  error?: string | null;
  duration_ms?: number;
  artifacts?: unknown[];
}

export interface ExecuteIsolatedProjectRunInput {
  request: ProjectRunExecuteRequest;
  ctx: HandlerContext;
  req: Request;
  evalAgentAdapter?: AgentServiceEvalAdapterConfig;
}

export interface EvalReportUploadInput {
  request: ProjectRunExecuteRequest;
  ctx: HandlerContext;
  req: Request;
  report: EvalReport;
  projectReference: string;
  reportPath: string;
}

export interface WorkflowRunView {
  status: string;
  output?: unknown;
  error?: { message?: string } | null;
}

export interface WorkflowStartHandle {
  runId: string;
  settled?(): Promise<void>;
}

export interface WorkflowClientView {
  readonly statePersistence?: "durable" | "ephemeral";
  register(workflow: unknown): void;
  start(
    workflowId: string,
    input: unknown,
    options?: { runId?: string },
  ): Promise<WorkflowStartHandle>;
  getRun(runId: string): Promise<WorkflowRunView | null>;
  destroy(): Promise<void>;
}

export interface ProjectRunExecuteHandlerDeps {
  runTask(options: RunTaskOptions): Promise<TaskRunResult>;
  findWorkflowById(
    workflowId: string,
    options: {
      projectDir: string;
      adapter: RuntimeAdapter;
      config?: VeryfrontConfig;
      debug?: boolean;
    },
  ): Promise<DiscoveredWorkflow | null>;
  findEvalById(
    evalId: string,
    options: {
      projectDir: string;
      adapter: RuntimeAdapter;
      config?: VeryfrontConfig;
      debug?: boolean;
    },
  ): Promise<DiscoveredEval | null>;
  createWorkflowClient(
    config?: WorkflowClientConfig,
  ): WorkflowClientView | Promise<WorkflowClientView>;
  runEval(definition: EvalDefinition, options: RunEvalOptions): Promise<EvalReport>;
  createEvalAgentAdapter(config: AgentServiceEvalAdapterConfig): EvalAgentAdapter;
  uploadEvalReport(input: EvalReportUploadInput): Promise<string | null>;
  executeIsolatedProjectRun(
    input: ExecuteIsolatedProjectRunInput,
  ): Promise<SerializedProjectRunResult>;
  ensureProjectDiscovery(ctx: HandlerContext): Promise<DiscoveryResult>;
  executeKnowledgeIngest(input: ProjectRunExecutorInput): Promise<ProjectRunExecuteResponse>;
  executeReleaseAssetBuild(input: ProjectRunExecutorInput): Promise<ProjectRunExecuteResponse>;
  executeStyleArtifactBuild(input: ProjectRunExecutorInput): Promise<ProjectRunExecuteResponse>;
  /**
   * Compatibility seam for remote workflows. The production default preserves
   * the current host executor until workflow isolation is decided separately.
   */
  executeRemoteWorkflow?: (
    input: ProjectRunExecutorInput,
    deps: ProjectRunExecuteHandlerDeps,
  ) => Promise<ProjectRunExecuteResponse>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export interface ProjectRunExecutorInput {
  request: ProjectRunExecuteRequest;
  ctx: HandlerContext;
  req: Request;
}
