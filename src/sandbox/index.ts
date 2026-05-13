/**
 * Sandbox module for ephemeral compute environments.
 *
 * Provides the `Sandbox` class for creating and interacting with
 * isolated execution environments.
 *
 * @example
 * ```ts
 * import { Sandbox } from "veryfront/sandbox";
 *
 * const sandbox = await Sandbox.create();
 * const result = await sandbox.executeCommand("echo hello");
 * console.log(result.stdout); // "hello\n"
 * await sandbox.close();
 * ```
 *
 * @module
 */

export {
  type CommandJob,
  type CommandJobHeartbeatStatus,
  type CommandJobOutput,
  type CommandJobStatus,
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
  normalizeBashToolSet,
  renameSandboxFileTools,
  type SandboxShellToolDefinition,
  type SandboxShellToolSet,
} from "./shell-tools.ts";
export {
  type AgentServiceSandboxClient,
  type AgentServiceSandboxClientOptions,
  type AgentServiceSandboxJobClient,
  type AgentServiceSandboxToolsOptions,
  type AgentServiceSandboxToolsResult,
  createAgentServiceSandboxClient,
  createAgentServiceSandboxTools,
  createHostedSandboxClient,
  createHostedSandboxTools,
  createProjectScopedExecOptions,
  type HostedSandboxClient,
  type HostedSandboxClientOptions,
  type HostedSandboxJobClient,
  type HostedSandboxToolsOptions,
  type HostedSandboxToolsResult,
  unwrapSandboxWorkingDirectoryCommand,
} from "./agent-service-tools.ts";
