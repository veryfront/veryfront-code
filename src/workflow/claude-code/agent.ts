/**
 * Claude Agent SDK integration.
 *
 * The SDK runs Claude Code as a trusted local process. Callers are responsible
 * for choosing an appropriate working directory and tool policy.
 */

import { cwd } from "#veryfront/compat/process.ts";
import { getErrorMessage, INVALID_ARGUMENT } from "#veryfront/errors";
import { sanitizeErrorText } from "#veryfront/errors/sanitization.ts";
import { importClaudeAgentSDK } from "#veryfront/compat/opaque-deps.ts";
import { logger as baseLogger } from "#veryfront/utils";
import type { ClaudeCodeMode, ClaudeCodeResult } from "./types.ts";

const logger = baseLogger.component("agent-sdk");

/** Agent configuration. */
export interface AgentConfig {
  /** Model to use. */
  model?: string;

  /** Tool mode mapped to an SDK permission mode. */
  mode?: ClaudeCodeMode;

  /**
   * Explicitly opt in to unrestricted filesystem and shell access without
   * interactive permission prompts.
   *
   * Trusted server configuration must be the only source of this value.
   * User-facing tool schemas do not expose it.
   *
   * @default false
   */
  bypassPermissions?: boolean;

  /** Maximum conversation turns before stopping. */
  maxTurns?: number;

  /** Maximum SDK budget in USD. */
  maxBudgetUsd?: number;

  /** System prompt override. */
  systemPrompt?: string;

  /** Working directory for local file operations. */
  cwd?: string;

  /** SDK tools available to the agent. Omit to use the SDK default set. */
  tools?: string[];

  /** Available SDK tools that may run without an interactive approval prompt. */
  allowedTools?: string[];

  /** Additional directories the SDK may access. */
  additionalDirectories?: string[];

  /** Abort the SDK query when this signal is aborted. */
  abortSignal?: AbortSignal;

  /** Enable metadata-only debug logging. */
  debug?: boolean;

  /**
   * Observe the final result.
   *
   * Execution awaits this callback exactly once. A callback failure is logged
   * without its payload and does not replace the agent result.
   */
  onComplete?: (result: ClaudeCodeResult) => void | Promise<void>;
}

export const CLAUDE_CODE_DEFAULT_MAX_TURNS = 20;
export const CLAUDE_CODE_MIN_MAX_TURNS = 1;
export const CLAUDE_CODE_MAX_MAX_TURNS = 100;
const STREAM_ENDED_WITHOUT_RESULT = "Claude Agent SDK stream ended without a result message";
const UNSUCCESSFUL_RESULT = "Claude Agent SDK returned an unsuccessful result";
const MAX_ERROR_DIAGNOSTICS = 32;
const MAX_AGENT_ERROR_LENGTH = 4_096;

export type ClaudeCodePermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan";

/**
 * Minimal SDK surface used by the integration.
 *
 * @internal
 */
export interface ClaudeCodeSDKQueryArguments {
  prompt: string;
  options: Record<string, unknown>;
}

/** @internal */
export interface ClaudeCodeSDKQuery extends AsyncIterable<unknown> {
  close(): void | Promise<void>;
}

/** @internal */
export interface ClaudeCodeSDKModule {
  query(arguments_: ClaudeCodeSDKQueryArguments): ClaudeCodeSDKQuery;
}

/** @internal */
export type ClaudeCodeSDKImporter = () => Promise<ClaudeCodeSDKModule>;

/**
 * Resolve the SDK permission mode under the Claude Code privilege policy.
 *
 * `bypassPermissions` is only available through an exact boolean opt-in. An
 * unknown runtime mode fails closed instead of inheriting write access.
 *
 * @internal
 */
export function resolveClaudeCodePermissionMode(
  config: Pick<AgentConfig, "mode" | "bypassPermissions">,
): ClaudeCodePermissionMode {
  if (config.bypassPermissions === true) {
    return "bypassPermissions";
  }

  switch (config.mode) {
    case undefined:
    case "code":
      return "acceptEdits";
    case "analysis":
      return "plan";
    case "custom":
      return "default";
    default:
      throw INVALID_ARGUMENT.create({
        detail: `Unsupported Claude Code mode: ${String(config.mode)}`,
      });
  }
}

/**
 * Merge per-call overrides while preserving server control of bypass mode.
 *
 * @internal
 */
export function applyClaudeCodeAgentOverridePolicy(
  defaults: AgentConfig,
  overrides: AgentConfig,
): AgentConfig {
  const { bypassPermissions: _ignoredByPolicy, ...safeOverrides } = overrides;
  return { ...defaults, ...safeOverrides };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sanitizeAgentError(value: string, fallback = UNSUCCESSFUL_RESULT): string {
  return sanitizeErrorText(value, MAX_AGENT_ERROR_LENGTH) || fallback;
}

function getResultError(message: Record<string, unknown>): string {
  const errors = message.errors;
  if (Array.isArray(errors)) {
    const diagnostics: string[] = [];
    for (let index = 0; index < errors.length && index < MAX_ERROR_DIAGNOSTICS; index++) {
      const error = errors[index];
      if (typeof error === "string") diagnostics.push(error);
    }
    if (diagnostics.length > 0) return sanitizeAgentError(diagnostics.join("\n"));
  }

  const subtype = getString(message.subtype);
  return subtype === undefined
    ? UNSUCCESSFUL_RESULT
    : sanitizeAgentError(`Claude Agent SDK returned an unsuccessful result: ${subtype}`);
}

function validateAgentRequest(task: unknown, config: AgentConfig): number {
  if (typeof task !== "string" || task.length === 0) {
    throw INVALID_ARGUMENT.create({ detail: "Claude Code task must be a non-empty string" });
  }

  const maxTurns = config.maxTurns ?? CLAUDE_CODE_DEFAULT_MAX_TURNS;
  if (
    !Number.isSafeInteger(maxTurns) || maxTurns < CLAUDE_CODE_MIN_MAX_TURNS ||
    maxTurns > CLAUDE_CODE_MAX_MAX_TURNS
  ) {
    throw INVALID_ARGUMENT.create({
      detail:
        `Claude Code maxTurns must be an integer from ${CLAUDE_CODE_MIN_MAX_TURNS} through ${CLAUDE_CODE_MAX_MAX_TURNS}`,
    });
  }

  if (
    config.maxBudgetUsd !== undefined &&
    (!Number.isFinite(config.maxBudgetUsd) || config.maxBudgetUsd <= 0)
  ) {
    throw INVALID_ARGUMENT.create({
      detail: "Claude Code maxBudgetUsd must be a positive finite number",
    });
  }

  return maxTurns;
}

function createResult(
  startTime: number,
  values: {
    success: boolean;
    iterations: number;
    response?: string;
    error?: string;
    filesTargeted: string[];
    commandsRequested: string[];
  },
): ClaudeCodeResult {
  return {
    success: values.success,
    iterations: values.iterations,
    response: values.response,
    error: values.error,
    filesTargeted: [...values.filesTargeted],
    commandsRequested: [...values.commandsRequested],
    // Preserve the historical fields while documenting their observed semantics.
    filesModified: [...values.filesTargeted],
    commandsExecuted: [...values.commandsRequested],
    executionTime: Date.now() - startTime,
  };
}

function observeAssistantMessage(
  message: Record<string, unknown>,
  text: string[],
  filesTargeted: string[],
  commandsRequested: string[],
): number {
  const assistantMessage = message.message;
  if (!isRecord(assistantMessage) || !Array.isArray(assistantMessage.content)) return 0;

  let toolCallCount = 0;
  for (const contentBlock of assistantMessage.content) {
    if (!isRecord(contentBlock)) continue;

    if (contentBlock.type === "text") {
      const content = getString(contentBlock.text);
      if (content !== undefined) text.push(content);
      continue;
    }

    if (contentBlock.type !== "tool_use") continue;
    toolCallCount++;
    const input = contentBlock.input;
    if (!isRecord(input)) continue;

    if (contentBlock.name === "Bash") {
      const command = getString(input.command);
      if (command !== undefined) commandsRequested.push(command);
      continue;
    }

    if (contentBlock.name === "Write" || contentBlock.name === "Edit") {
      const filePath = getString(input.file_path);
      if (filePath !== undefined && !filesTargeted.includes(filePath)) {
        filesTargeted.push(filePath);
      }
    }
  }

  return toolCallCount;
}

function linkAbortSignal(source: AbortSignal | undefined): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  if (source === undefined) return { controller, cleanup: () => undefined };

  const forwardAbort = () => controller.abort(source.reason);
  if (source.aborted) {
    forwardAbort();
    return { controller, cleanup: () => undefined };
  }

  source.addEventListener("abort", forwardAbort, { once: true });
  return {
    controller,
    cleanup: () => source.removeEventListener("abort", forwardAbort),
  };
}

async function executeAgentCore(
  task: string,
  config: AgentConfig,
  importSDK: ClaudeCodeSDKImporter,
): Promise<ClaudeCodeResult> {
  const startTime = Date.now();
  const filesTargeted: string[] = [];
  const commandsRequested: string[] = [];
  const observedText: string[] = [];
  let totalTurns = 0;
  let conversation: ClaudeCodeSDKQuery | undefined;
  const { controller: abortController, cleanup: cleanupAbortListener } = linkAbortSignal(
    config.abortSignal,
  );

  try {
    const maxTurns = validateAgentRequest(task, config);
    abortController.signal.throwIfAborted();
    const { query } = await importSDK();
    abortController.signal.throwIfAborted();

    const permissionMode = resolveClaudeCodePermissionMode(config);
    if (permissionMode === "bypassPermissions") {
      logger.warn(
        "Claude Code is running with unrestricted filesystem and shell access",
      );
    }

    if (config.debug === true) {
      logger.debug("Starting Claude Code task", {
        model: config.model ?? "sdk-default",
        mode: config.mode ?? "code",
        maxTurns,
        availableToolCount: config.tools?.length,
        autoApprovedToolCount: config.allowedTools?.length,
      });
    }

    conversation = query({
      prompt: task,
      options: {
        ...(config.model === undefined ? {} : { model: config.model }),
        cwd: config.cwd ?? cwd(),
        maxTurns,
        maxBudgetUsd: config.maxBudgetUsd,
        permissionMode,
        ...(permissionMode === "bypassPermissions"
          ? { allowDangerouslySkipPermissions: true }
          : {}),
        tools: config.tools,
        allowedTools: config.allowedTools,
        additionalDirectories: config.additionalDirectories,
        abortController,
        systemPrompt: config.systemPrompt ?? { type: "preset", preset: "claude_code" },
      },
    });

    for await (const value of conversation) {
      if (!isRecord(value)) continue;

      if (value.type === "assistant") {
        totalTurns++;
        const toolCallCount = observeAssistantMessage(
          value,
          observedText,
          filesTargeted,
          commandsRequested,
        );
        if (config.debug === true) {
          logger.debug("Observed Claude Code turn", {
            turn: totalTurns,
            toolCallCount,
          });
        }
        continue;
      }

      if (value.type !== "result") continue;

      const isSuccess = value.subtype === "success";
      const reportedTurns = getFiniteNumber(value.num_turns) ?? totalTurns;
      if (config.debug === true) {
        logger.debug("Claude Code task completed", {
          success: isSuccess,
          turns: reportedTurns,
          costUsd: getFiniteNumber(value.total_cost_usd),
          durationMs: getFiniteNumber(value.duration_ms),
        });
      }

      return createResult(startTime, {
        success: isSuccess,
        iterations: reportedTurns,
        response: isSuccess ? getString(value.result) : undefined,
        error: isSuccess ? undefined : getResultError(value),
        filesTargeted,
        commandsRequested,
      });
    }

    return createResult(startTime, {
      success: false,
      iterations: totalTurns,
      response: observedText.length > 0 ? observedText.join("") : undefined,
      error: STREAM_ENDED_WITHOUT_RESULT,
      filesTargeted,
      commandsRequested,
    });
  } catch (error) {
    if (config.debug === true) {
      logger.debug("Claude Code task failed", {
        aborted: abortController.signal.aborted,
        turns: totalTurns,
      });
    }
    return createResult(startTime, {
      success: false,
      iterations: totalTurns,
      response: observedText.length > 0 ? observedText.join("") : undefined,
      error: sanitizeAgentError(getErrorMessage(error), "Claude Code task failed"),
      filesTargeted,
      commandsRequested,
    });
  } finally {
    if (conversation && typeof conversation.close === "function") {
      try {
        await conversation.close();
      } catch {
        logger.error("Claude Code SDK query cleanup failed");
      }
    }
    cleanupAbortListener();
  }
}

async function notifyCompletion(
  observer: AgentConfig["onComplete"],
  result: ClaudeCodeResult,
): Promise<void> {
  if (observer === undefined) return;
  try {
    await observer(result);
  } catch {
    logger.error("Claude Code completion observer failed");
  }
}

async function executeAgentWithImporter(
  task: string,
  config: AgentConfig,
  importSDK: ClaudeCodeSDKImporter,
): Promise<ClaudeCodeResult> {
  const result = await executeAgentCore(task, config, importSDK);
  await notifyCompletion(config.onComplete, result);
  return result;
}

const defaultSDKImporter: ClaudeCodeSDKImporter = async () => {
  return await importClaudeAgentSDK() as ClaudeCodeSDKModule;
};

/**
 * Execute a task using the locally configured Claude Agent SDK.
 */
export function executeAgent(
  task: string,
  config: AgentConfig = {},
): Promise<ClaudeCodeResult> {
  return executeAgentWithImporter(task, config, defaultSDKImporter);
}

/**
 * Execute against an injected SDK importer without changing production-global
 * state. This seam is intentionally excluded from the package entrypoint.
 *
 * @internal
 */
export function __executeAgentForTests(
  task: string,
  config: AgentConfig,
  importSDK: ClaudeCodeSDKImporter,
): Promise<ClaudeCodeResult> {
  return executeAgentWithImporter(task, config, importSDK);
}

/**
 * Create a reusable agent function with preset configuration.
 *
 * Per-call overrides cannot enable or disable `bypassPermissions`. Only the
 * trusted defaults passed here control that privilege.
 */
export function createAgent(
  defaults: AgentConfig = {},
): (task: string, overrides?: AgentConfig) => Promise<ClaudeCodeResult> {
  return (task: string, overrides: AgentConfig = {}) => {
    return executeAgent(task, applyClaudeCodeAgentOverridePolicy(defaults, overrides));
  };
}
