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
  createHostedSandboxClient,
  createHostedSandboxClient as createAgentServiceSandboxClient,
  createHostedSandboxTools,
  createHostedSandboxTools as createAgentServiceSandboxTools,
  createProjectScopedExecOptions,
  type HostedSandboxClient,
  type HostedSandboxClient as AgentServiceSandboxClient,
  type HostedSandboxClientOptions,
  type HostedSandboxClientOptions as AgentServiceSandboxClientOptions,
  type HostedSandboxJobClient,
  type HostedSandboxJobClient as AgentServiceSandboxJobClient,
  type HostedSandboxToolsOptions,
  type HostedSandboxToolsOptions as AgentServiceSandboxToolsOptions,
  type HostedSandboxToolsResult,
  type HostedSandboxToolsResult as AgentServiceSandboxToolsResult,
  unwrapSandboxWorkingDirectoryCommand,
} from "./hosted-tools.ts";
