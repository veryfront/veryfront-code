/**
 * Sandbox module for ephemeral compute environments.
 *
 * Provides the `Sandbox` class for creating and interacting with
 * isolated execution environments, and re-exports `createBashTool`
 * for AI agent integration.
 *
 * @example
 * ```ts
 * import { Sandbox } from "veryfront/sandbox";
 *
 * const sandbox = await Sandbox.create({ authToken: userJwt });
 * const result = await sandbox.executeCommand("echo hello");
 * console.log(result.stdout); // "hello\n"
 * await sandbox.close();
 * ```
 *
 * @example With bash-tool for AI agents:
 * ```ts
 * import { Sandbox, createBashTool } from "veryfront/sandbox";
 *
 * const sandbox = await Sandbox.create({ authToken });
 * const { tools } = await createBashTool({ sandbox });
 * // Pass tools to agent...
 * ```
 *
 * @module
 */

export { type ExecResult, type ExecStreamEvent, Sandbox, type SandboxOptions } from "./sandbox.ts";
