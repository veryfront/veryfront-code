/**
 * Isolated workspaces for commands and files.
 *
 * @example
 * ```ts
 * import { Sandbox } from "veryfront/sandbox";
 *
 * const sandbox = await Sandbox.create();
 * const result = await sandbox.runCommand("echo hello");
 * console.log(result.stdout); // "hello\n"
 * await sandbox.close();
 * ```
 *
 * @module
 */

export {
  type BackgroundCommand,
  type BackgroundCommandHeartbeatStatus,
  type BackgroundCommandOutput,
  type BackgroundCommandStatus,
  type CommandOptions,
  type CommandResult,
  type CommandStreamEvent,
  Sandbox,
  type SandboxAccessScope,
  type SandboxAttachment,
  type SandboxCapabilities,
  type SandboxClientOptions,
  type SandboxDetails,
  type SandboxEnvironment,
  type SandboxFileEntry,
  type SandboxFileListOptions,
  type SandboxFileListResult,
  type SandboxLifetimeInput,
  type SandboxLifetimeMode,
  type SandboxListOptions,
  type SandboxListResult,
  type SandboxOptions,
  type SandboxRuntimeCheck,
  type SandboxStatus,
  type SandboxWorkspaceStorage,
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
  type AgentServiceSandboxBackgroundCommandClient,
  type AgentServiceSandboxClient,
  type AgentServiceSandboxClientOptions,
  type AgentServiceSandboxToolsOptions,
  type AgentServiceSandboxToolsResult,
  createAgentServiceSandboxClient,
  createAgentServiceSandboxTools,
  createHostedSandboxClient,
  createHostedSandboxTools,
  type HostedSandboxBackgroundCommandClient,
  type HostedSandboxClient,
  type HostedSandboxClientOptions,
  type HostedSandboxToolsOptions,
  type HostedSandboxToolsResult,
  unwrapSandboxWorkingDirectoryCommand,
} from "./agent-service-tools.ts";
