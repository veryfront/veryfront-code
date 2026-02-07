/**
 * Claude Agent SDK Integration
 *
 * Uses the official @anthropic-ai/claude-agent-sdk which runs through
 * your local Claude Code installation. No separate API key needed —
 * it uses whatever auth your `claude` binary is configured with
 * (Max subscription, API key, org key, etc.).
 */

import { logger } from "#veryfront/utils";
import type { ClaudeCodeMode, ClaudeCodeResult } from "./types.ts";

/**
 * Agent configuration
 */
export interface AgentConfig {
  /** Model to use (default: claude-sonnet-4-5-20250929) */
  model?: string;

  /** Tool mode — maps to SDK permission modes */
  mode?: ClaudeCodeMode;

  /** Maximum conversation turns before stopping */
  maxTurns?: number;

  /** Maximum budget in USD */
  maxBudgetUsd?: number;

  /** System prompt override */
  systemPrompt?: string;

  /** Working directory for file operations */
  cwd?: string;

  /** Allowed tools (default: all Claude Code tools) */
  allowedTools?: string[];

  /** Additional directories Claude can access */
  additionalDirectories?: string[];

  /** Enable debug logging */
  debug?: boolean;

  /** Callback when execution completes */
  onComplete?: (result: ClaudeCodeResult) => void | Promise<void>;
}

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

/**
 * Map tool mode to SDK permission mode
 */
function resolvePermissionMode(
  mode?: ClaudeCodeMode,
): "default" | "acceptEdits" | "bypassPermissions" | "plan" {
  switch (mode) {
    case "analysis":
      return "plan"; // read-only
    case "code":
      return "acceptEdits"; // can write files + run commands
    case "full":
      return "bypassPermissions"; // all tools, no prompts
    case "custom":
      return "default"; // user controls via allowedTools
    default:
      return "acceptEdits";
  }
}

/**
 * Execute a task using the Claude Agent SDK.
 *
 * Uses your local Claude Code installation — no ANTHROPIC_API_KEY needed.
 *
 * @example
 * ```typescript
 * const result = await executeAgent("Fix the failing tests in src/utils", {
 *   cwd: "/path/to/project",
 *   mode: "code",
 * });
 * ```
 */
export async function executeAgent(
  task: string,
  config: AgentConfig = {},
): Promise<ClaudeCodeResult> {
  const startTime = Date.now();
  const filesModified: string[] = [];
  const commandsExecuted: string[] = [];

  try {
    // Dynamic import — only loads SDK when actually used
    const { query } = await import("@anthropic-ai/claude-agent-sdk");

    if (config.debug) {
      logger.info("[AgentSDK] Starting task:", task);
      logger.info("[AgentSDK] Config:", {
        model: config.model || DEFAULT_MODEL,
        cwd: config.cwd || Deno.cwd(),
        maxTurns: config.maxTurns,
        mode: config.mode,
      });
    }

    const conversation = query({
      prompt: task,
      options: {
        model: config.model || DEFAULT_MODEL,
        cwd: config.cwd || Deno.cwd(),
        maxTurns: config.maxTurns,
        maxBudgetUsd: config.maxBudgetUsd,
        permissionMode: resolvePermissionMode(config.mode),
        allowedTools: config.allowedTools,
        additionalDirectories: config.additionalDirectories,
        systemPrompt: config.systemPrompt
          ? config.systemPrompt
          : { type: "preset", preset: "claude_code" },
      },
    });

    let finalText = "";
    let totalTurns = 0;

    for await (const message of conversation) {
      if (message.type === "assistant") {
        totalTurns++;

        for (const block of message.message.content) {
          if (block.type === "text") {
            finalText = block.text;
          } else if (block.type === "tool_use") {
            // Track tool usage for the result
            if (block.name === "Bash") {
              const input = block.input as { command?: string };
              if (input.command) {
                commandsExecuted.push(input.command);
              }
            } else if (block.name === "Write" || block.name === "Edit") {
              const input = block.input as { file_path?: string };
              if (input.file_path && !filesModified.includes(input.file_path)) {
                filesModified.push(input.file_path);
              }
            }
          }
        }

        if (config.debug) {
          logger.info(`[AgentSDK] Turn ${totalTurns}:`, {
            text: finalText?.slice(0, 100),
            toolCalls: message.message.content
              .filter((b: { type: string }) => b.type === "tool_use")
              .map((b: { name: string }) => b.name),
          });
        }
      }

      if (message.type === "result") {
        if (config.debug) {
          logger.info("[AgentSDK] Complete:", {
            turns: message.num_turns,
            cost: message.total_cost_usd,
            duration: message.duration_ms,
          });
        }

        const isSuccess = message.subtype === "success";

        const result: ClaudeCodeResult = {
          success: isSuccess,
          iterations: message.num_turns,
          response: isSuccess ? message.result : undefined,
          filesModified,
          commandsExecuted,
          error: !isSuccess && "errors" in message
            ? (message as { errors: string[] }).errors.join("\n")
            : undefined,
          executionTime: Date.now() - startTime,
        };

        config.onComplete?.(result);
        return result;
      }
    }

    // Shouldn't reach here, but handle gracefully
    const result: ClaudeCodeResult = {
      success: true,
      iterations: totalTurns,
      response: finalText,
      filesModified,
      commandsExecuted,
      executionTime: Date.now() - startTime,
    };

    config.onComplete?.(result);
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("[AgentSDK] Error:", errorMessage);

    const result: ClaudeCodeResult = {
      success: false,
      iterations: 0,
      error: errorMessage,
      filesModified,
      commandsExecuted,
      executionTime: Date.now() - startTime,
    };

    config.onComplete?.(result);
    return result;
  }
}

/**
 * Create a reusable agent function with preset configuration.
 *
 * @example
 * ```typescript
 * const reviewer = createAgent({
 *   mode: "analysis",
 *   systemPrompt: "You are an expert code reviewer.",
 * });
 *
 * const result = await reviewer("Review src/auth/ for security issues");
 * ```
 */
export function createAgent(
  defaults: AgentConfig = {},
): (task: string, overrides?: AgentConfig) => Promise<ClaudeCodeResult> {
  return (task: string, overrides: AgentConfig = {}) =>
    executeAgent(task, { ...defaults, ...overrides });
}
