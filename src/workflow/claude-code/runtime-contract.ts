/**
 * Provider-neutral execution contract for Claude Code workflow agents.
 *
 * The core workflow module owns this contract but does not import an agent SDK.
 * A configured extension, such as `@veryfront/ext-claude-code-agent`, provides
 * the implementation at runtime.
 *
 * @module workflow/claude-code/runtime-contract
 */

import type { ClaudeCodeMode, ClaudeCodeResult } from "./types.ts";

export type { ClaudeCodeMode, ClaudeCodeResult } from "./types.ts";

/** Extension contract name used to resolve a Claude Code agent runtime. */
export const ClaudeCodeAgentRuntimeName = "ClaudeCodeAgentRuntime" as const;

/** Immutable configuration passed from core to an agent runtime extension. */
export interface ClaudeCodeAgentExecutionConfig {
  /** Model selected by the caller. Omitted values are resolved by the provider. */
  readonly model?: string;
  /** Execution mode. Core normalizes an omitted mode to read-only `analysis`. */
  readonly mode: ClaudeCodeMode;
  /** Explicit server-controlled permission bypass. */
  readonly bypassPermissions?: boolean;
  /** Maximum conversation turns before stopping. */
  readonly maxTurns?: number;
  /** Maximum provider budget in USD. */
  readonly maxBudgetUsd?: number;
  /** System prompt override. */
  readonly systemPrompt?: string;
  /** Working directory for file operations. */
  readonly cwd?: string;
  /** Tools that the provider may auto-allow. */
  readonly allowedTools?: readonly string[];
  /** Additional directories the provider may access. */
  readonly additionalDirectories?: readonly string[];
  /** Enable diagnostic logging without changing execution semantics. */
  readonly debug?: boolean;
  /** Cooperative cancellation signal for the provider execution. */
  readonly abortSignal?: AbortSignal;
}

/** Extension-provided Claude Code execution capability. */
export interface ClaudeCodeAgentRuntime {
  execute(
    task: string,
    config: ClaudeCodeAgentExecutionConfig,
  ): Promise<ClaudeCodeResult>;
}
