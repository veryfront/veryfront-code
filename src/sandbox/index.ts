/**
 * Ephemeral compute environments for isolated execution.
 *
 * @example
 * ```ts
 * import { Sandbox } from "veryfront/sandbox";
 *
 * const sandbox = await Sandbox.create();
 * try {
 *   const result = await sandbox.executeCommand("echo hello");
 *   console.log(result.stdout); // "hello\n"
 * } finally {
 *   await sandbox.close();
 * }
 * ```
 *
 * @module
 */

export {
  type BackgroundCommand,
  type BackgroundCommandHeartbeatStatus,
  type BackgroundCommandOutput,
  type BackgroundCommandStatus,
  type ExecOptions,
  type ExecResult,
  type ExecStreamEvent,
  Sandbox,
  type SandboxAttachment,
  type SandboxListOptions,
  type SandboxListResult,
  type SandboxOptions,
  type SandboxSession,
} from "./sandbox.ts";
export {
  LazySandbox,
  type LazySandboxOptions,
  resolveDefaultSandboxRuntimeEndpoint,
} from "./lazy-sandbox.ts";
export {
  type BashToolSandboxLike,
  type CreateSandboxBashTool,
  createSandboxShellTools,
  type CreateSandboxShellToolsInput,
  normalizeBashToolSet,
  renameSandboxFileTools,
  type SandboxShellClient,
  type SandboxShellToolAnnotations,
  type SandboxShellToolDefinition,
  type SandboxShellToolExecute,
  type SandboxShellToolExecutionContext,
  type SandboxShellToolJsonSchema,
  type SandboxShellToolJsonSchemaTypeName,
  type SandboxShellToolMcpConfig,
  type SandboxShellToolSet,
  type SandboxShellToolsProvider,
  type SandboxShellToolType,
} from "./shell-tools.ts";
export {
  type AgentServiceSandboxBackgroundCommandClient,
  type AgentServiceSandboxClient,
  type AgentServiceSandboxClientOptions,
  type AgentServiceSandboxToolsOptions,
  type AgentServiceSandboxToolsResult,
  createAgentServiceSandboxClient,
  createAgentServiceSandboxTools,
  createHostedSandboxClient,
  createHostedSandboxTools,
  createProjectScopedExecOptions,
  type HostedSandboxBackgroundCommandClient,
  type HostedSandboxClient,
  type HostedSandboxClientOptions,
  type HostedSandboxToolsOptions,
  type HostedSandboxToolsResult,
  unwrapSandboxWorkingDirectoryCommand,
} from "./agent-service-tools.ts";
