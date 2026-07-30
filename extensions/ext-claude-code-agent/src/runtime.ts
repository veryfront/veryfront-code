/** Anthropic Claude Agent SDK implementation of Veryfront's agent runtime. */

import {
  type Options,
  query as anthropicQuery,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ExtensionLogger } from "veryfront/extensions";
import type {
  ClaudeCodeAgentExecutionConfig,
  ClaudeCodeAgentRuntime,
  ClaudeCodeResult,
} from "veryfront/workflow/claude-code/runtime";

export type ClaudeAgentQuery = (params: {
  prompt: string;
  options?: Options;
}) => AsyncIterable<SDKMessage>;

export interface AnthropicClaudeCodeAgentRuntimeDependencies {
  readonly query?: ClaudeAgentQuery;
  readonly now?: () => number;
  readonly logger?: Pick<ExtensionLogger, "debug" | "error" | "info" | "warn">;
}

type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan";

/** Map provider-neutral modes to the SDK permission policy. */
export function resolvePermissionMode(
  config: ClaudeCodeAgentExecutionConfig,
): PermissionMode {
  if (typeof config.bypassPermissions !== "boolean" && config.bypassPermissions !== undefined) {
    throw new TypeError("bypassPermissions must be a boolean");
  }
  if (config.bypassPermissions === true) return "bypassPermissions";

  switch (config.mode) {
    case undefined:
    case "analysis":
      return "plan";
    case "code":
      return "acceptEdits";
    case "custom":
      return "default";
    default:
      throw new TypeError("Claude Code agent mode must be analysis, code, or custom");
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  const rendered = String(error);
  return rendered.trim().length > 0 ? rendered : "Claude Agent SDK failed without an error message";
}

/** SDK-backed runtime kept entirely inside the optional extension boundary. */
export class AnthropicClaudeCodeAgentRuntime implements ClaudeCodeAgentRuntime {
  readonly #query: ClaudeAgentQuery;
  readonly #now: () => number;
  readonly #logger?: AnthropicClaudeCodeAgentRuntimeDependencies["logger"];

  constructor(dependencies: AnthropicClaudeCodeAgentRuntimeDependencies = {}) {
    this.#query = dependencies.query ?? anthropicQuery;
    this.#now = dependencies.now ?? Date.now;
    this.#logger = dependencies.logger;
  }

  #elapsed(startedAt: number): number {
    const finishedAt = this.#now();
    if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) {
      throw new Error("Claude Code agent runtime clock returned an invalid timestamp");
    }
    return finishedAt - startedAt;
  }

  #log(
    level: "debug" | "error" | "info" | "warn",
    message: string,
    details?: unknown,
  ): void {
    try {
      if (details === undefined) this.#logger?.[level](message);
      else this.#logger?.[level](message, details);
    } catch {
      // Diagnostics must not change the provider result.
    }
  }

  async execute(
    task: string,
    config: ClaudeCodeAgentExecutionConfig,
  ): Promise<ClaudeCodeResult> {
    if (
      config.abortSignal !== undefined &&
      !(config.abortSignal instanceof AbortSignal)
    ) {
      throw new TypeError("Claude Code agent abortSignal must be an AbortSignal");
    }
    const abortSignal = config.abortSignal;
    abortSignal?.throwIfAborted();
    const permissionMode = resolvePermissionMode(config);
    const startedAt = this.#now();
    const filesModified = new Set<string>();
    const commandsExecuted: string[] = [];
    let assistantTurns = 0;
    const abortController = abortSignal ? new AbortController() : undefined;
    const onAbort = abortController ? () => abortController.abort(abortSignal?.reason) : undefined;
    if (onAbort) abortSignal?.addEventListener("abort", onAbort, { once: true });

    const options: Options = {
      abortController,
      permissionMode,
      allowDangerouslySkipPermissions: permissionMode === "bypassPermissions" ? true : undefined,
      model: config.model,
      cwd: config.cwd,
      maxTurns: config.maxTurns,
      maxBudgetUsd: config.maxBudgetUsd,
      allowedTools: config.allowedTools ? [...config.allowedTools] : undefined,
      additionalDirectories: config.additionalDirectories
        ? [...config.additionalDirectories]
        : undefined,
      systemPrompt: config.systemPrompt ?? {
        type: "preset",
        preset: "claude_code",
      },
    };

    if (config.debug) {
      this.#log("info", "[ext-claude-code-agent] execution started", {
        mode: config.mode,
        model: config.model,
        cwd: config.cwd,
        maxTurns: config.maxTurns,
      });
    }

    try {
      for await (const message of this.#query({ prompt: task, options })) {
        abortSignal?.throwIfAborted();
        if (message.type === "assistant") {
          assistantTurns++;
          for (const block of message.message.content) {
            if (block.type !== "tool_use") continue;
            if (block.name === "Bash") {
              const command = (block.input as { command?: unknown }).command;
              if (typeof command === "string" && command.trim().length > 0) {
                commandsExecuted.push(command);
              }
            } else if (block.name === "Write" || block.name === "Edit") {
              const path = (block.input as { file_path?: unknown }).file_path;
              if (typeof path === "string" && path.trim().length > 0) {
                filesModified.add(path);
              }
            }
          }
          continue;
        }

        if (message.type !== "result") continue;
        const success = message.subtype === "success";
        let error: string | undefined;
        if (!success) {
          const providerError = message.errors
            .map((entry) => entry.trim())
            .filter(Boolean)
            .join("\n");
          error = providerError.length > 0
            ? providerError
            : `Claude Agent SDK ended with ${message.subtype}`;
        }
        const result: ClaudeCodeResult = {
          success,
          iterations: message.num_turns,
          filesModified: [...filesModified],
          commandsExecuted: [...commandsExecuted],
          executionTime: this.#elapsed(startedAt),
        };
        if (success) result.response = message.result;
        else result.error = error;
        if (config.debug) {
          this.#log("info", "[ext-claude-code-agent] execution completed", {
            success,
            turns: message.num_turns,
            costUsd: message.total_cost_usd,
            durationMs: message.duration_ms,
          });
        }
        return result;
      }

      abortSignal?.throwIfAborted();
      return {
        success: false,
        iterations: assistantTurns,
        filesModified: [...filesModified],
        commandsExecuted: [...commandsExecuted],
        error: "Claude Agent SDK stream ended without a result message",
        executionTime: this.#elapsed(startedAt),
      };
    } catch (error) {
      if (abortSignal?.aborted) throw abortSignal.reason ?? error;
      const message = errorMessage(error);
      this.#log("error", "[ext-claude-code-agent] execution failed", { error: message });
      return {
        success: false,
        iterations: assistantTurns,
        filesModified: [...filesModified],
        commandsExecuted: [...commandsExecuted],
        error: message,
        executionTime: this.#elapsed(startedAt),
      };
    } finally {
      if (onAbort) abortSignal?.removeEventListener("abort", onAbort);
    }
  }
}
