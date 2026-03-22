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
  type SandboxListOptions,
  type SandboxListResult,
  type SandboxOptions,
  type SandboxSession,
} from "./sandbox.ts";
