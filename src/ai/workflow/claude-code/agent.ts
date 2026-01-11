/**
 * Claude Code Agent
 *
 * Wraps Anthropic's Claude Code SDK for use in Veryfront workflows.
 * Provides agentic coding capabilities with tenant-aware file operations.
 *
 * Architecture:
 * 1. Downloads project files to local workspace before execution
 * 2. Bash and text_editor operate on local files
 * 3. Changes are detected and can be synced back to Veryfront API
 */

import { logger } from "@veryfront/utils";
import { getWorkflowTenant } from "../executor/step-executor.ts";
import type {
  AnthropicToolDefinition,
  BashToolInput,
  ClaudeCodeAgentConfig,
  ClaudeCodeContext,
  ClaudeCodeMode,
  ClaudeCodeResult,
  ClaudeToolCall,
  ClaudeToolResult,
  FileChange,
  IterationResult,
  TextEditorToolInput,
} from "./types.ts";
import { createWorkspaceSync } from "./workspace-sync.ts";

/**
 * Claude Code Agent interface (simplified from Agent for agentic tool use)
 */
export interface ClaudeCodeAgentInstance {
  /** Agent ID */
  id: string;
  /** Model used */
  model: string;
  /** Generate a response */
  generate(params: { input: string }): Promise<ClaudeCodeAgentResponse>;
}

/**
 * Claude Code Agent response
 */
export interface ClaudeCodeAgentResponse {
  /** Generated text */
  text: string;
  /** Agent status */
  status: "completed" | "error";
  /** Usage statistics */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/** Default model for Claude Code */
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

/** Default max iterations */
const DEFAULT_MAX_ITERATIONS = 20;

/** Default iteration timeout (5 minutes) - reserved for per-iteration limits */
const _DEFAULT_ITERATION_TIMEOUT = 5 * 60 * 1000;

/** Default total timeout (30 minutes) */
const DEFAULT_TOTAL_TIMEOUT = 30 * 60 * 1000;

/**
 * Validate bash command for dangerous patterns
 * SECURITY: Prevents high-risk operations that could harm the system or exfiltrate data
 */
function validateBashCommand(command: string): void {
  // Remove comments and normalize whitespace for analysis
  const normalized = command.replace(/#.*$/gm, "").replace(/\s+/g, " ").trim();

  const dangerousPatterns = [
    // Destructive operations
    { pattern: /\brm\s+.*-[rf].*\s+\//i, message: "Recursive delete of root or system directories" },
    { pattern: /\bdd\s+if=/i, message: "Direct disk operations with dd" },
    { pattern: /\bmkfs/i, message: "Filesystem formatting" },
    { pattern: /:\(\)\{.*:\|:&\};:/i, message: "Fork bomb detected" },

    // Network exfiltration - block curl/wget entirely (too many bypass techniques)
    { pattern: /\bcurl\b/i, message: "Network request via curl (blocked for security)" },
    { pattern: /\bwget\b/i, message: "Network request via wget (blocked for security)" },
    { pattern: /\bnc\b|\bnetcat\b/i, message: "Netcat network tool" },

    // Privilege escalation
    { pattern: /\bsudo\b/i, message: "Sudo command" },
    { pattern: /\bsu\s/i, message: "User switching" },
    { pattern: /\bdoas\b/i, message: "Doas command" },

    // System modification
    { pattern: /\bchroot\b/i, message: "Chroot operation" },
    { pattern: /\bmount\b/i, message: "Mount operation" },
    { pattern: /\biptables\b/i, message: "Firewall modification" },
    { pattern: /\bsystemctl\b/i, message: "System service control" },

    // Command substitution and chaining (to prevent bypasses)
    { pattern: /\$\(.*(?:curl|wget|nc)\b.*\)/i, message: "Command substitution with network tools" },
    { pattern: /`.*(?:curl|wget|nc)\b.*`/i, message: "Backtick substitution with network tools" },
  ];

  for (const { pattern, message } of dangerousPatterns) {
    if (pattern.test(normalized)) {
      throw new Error(`Blocked dangerous command: ${message}`);
    }
  }
}

/**
 * Safe environment variables to pass to bash commands.
 * SECURITY: Do NOT add sensitive vars like API keys, tokens, or secrets.
 */
const SAFE_ENV_VARS = [
  "PATH",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "USER",
  "LOGNAME",
  "TZ",
  "TMPDIR",
] as const;

/**
 * Get safe environment variables for bash execution.
 * Only includes allowlisted variables to prevent credential leakage.
 */
function getSafeEnv(workspaceDir: string): Record<string, string> {
  const safeEnv: Record<string, string> = {};

  for (const key of SAFE_ENV_VARS) {
    const value = Deno.env.get(key);
    if (value) {
      safeEnv[key] = value;
    }
  }

  // Override HOME to workspace directory
  safeEnv.HOME = workspaceDir;
  // Disable interactive prompts
  safeEnv.DEBIAN_FRONTEND = "noninteractive";

  return safeEnv;
}

/**
 * Default system prompt for Claude Code agent
 */
const DEFAULT_SYSTEM = `You are an expert software engineer working on a codebase.
You have access to tools for reading files, editing files, and running bash commands.
Always read relevant files before making changes to understand the existing code.
Make minimal, focused changes that solve the task.
After making changes, verify them by reading the file or running tests.
If you encounter errors, analyze them and try a different approach.`;

/**
 * Get tool definitions for a mode
 */
function getToolsForMode(mode: ClaudeCodeMode): AnthropicToolDefinition[] {
  switch (mode) {
    case "analysis":
      // Read-only mode - no bash or editor
      return [];

    case "code":
      return [
        { type: "bash_20250124", name: "bash" },
        { type: "text_editor_20250124", name: "str_replace_editor" },
      ];

    case "full":
      return [
        { type: "bash_20250124", name: "bash" },
        { type: "text_editor_20250124", name: "str_replace_editor" },
        {
          type: "computer_20250124",
          name: "computer",
          display_width_px: 1024,
          display_height_px: 768,
        },
      ];

    case "custom":
      return [];

    default:
      return [
        { type: "bash_20250124", name: "bash" },
        { type: "text_editor_20250124", name: "str_replace_editor" },
      ];
  }
}

/**
 * Execute bash tool against local workspace
 */
async function executeBash(
  input: BashToolInput,
  context: ClaudeCodeContext,
  config: ClaudeCodeAgentConfig,
): Promise<{ output: string; isError: boolean }> {
  config.onToolCall?.("bash", input);
  context.executedCommands.push(input.command);

  if (!context.workspace) {
    return {
      output: "Error: Workspace not initialized",
      isError: true,
    };
  }

  try {
    // SECURITY: Validate command for dangerous patterns
    validateBashCommand(input.command);

    // Execute command in workspace directory
    // SECURITY: Use allowlisted env vars only to prevent credential leakage
    const command = new Deno.Command("bash", {
      args: ["-c", input.command],
      cwd: context.workspace.workspaceDir,
      stdout: "piped",
      stderr: "piped",
      env: getSafeEnv(context.workspace.workspaceDir),
    });

    // Apply timeout if configured
    const timeout = input.timeout ?? 120000; // 2 minute default
    const process = command.spawn();

    // Create timeout promise with proper process cleanup
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(async () => {
        try {
          // First try graceful SIGTERM
          process.kill("SIGTERM");
          // Wait 2 seconds for graceful shutdown
          await new Promise((resolve) => setTimeout(resolve, 2000));
          // Force kill if still running
          try {
            process.kill("SIGKILL");
          } catch {
            // Process already exited from SIGTERM
          }
        } catch {
          // Process may have already exited
        }
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);
    });

    try {
      // Wait for process or timeout
      const output = await Promise.race([process.output(), timeoutPromise]);

      const stdout = new TextDecoder().decode(output.stdout);
      const stderr = new TextDecoder().decode(output.stderr);

      const isError = !output.success;
      const result = isError ? stderr || stdout : stdout || stderr;

      // Truncate if too long
      const maxLength = 50000;
      const truncated = result.length > maxLength
        ? result.slice(0, maxLength) + "\n... (output truncated)"
        : result;

      config.onToolResult?.("bash", truncated, isError);

      return { output: truncated, isError };
    } finally {
      // Clear timeout to prevent timer leak
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  } catch (error) {
    const output = `Error: ${error instanceof Error ? error.message : String(error)}`;
    config.onToolResult?.("bash", output, true);
    return { output, isError: true };
  }
}

/**
 * Execute text editor tool against local workspace
 */
async function executeTextEditor(
  input: TextEditorToolInput,
  context: ClaudeCodeContext,
  config: ClaudeCodeAgentConfig,
): Promise<{ output: string; isError: boolean }> {
  config.onToolCall?.("str_replace_editor", input);

  if (!context.workspace) {
    return {
      output: "Error: Workspace not initialized",
      isError: true,
    };
  }

  try {
    switch (input.command) {
      case "view": {
        // Read from local workspace
        const content = await context.workspace.readFile(input.path);
        const lines = content.split("\n");

        if (input.view_range) {
          const [start, end] = input.view_range;
          const selectedLines = lines.slice(start - 1, end);
          const output = selectedLines
            .map((line, i) => `${start + i}: ${line}`)
            .join("\n");
          config.onToolResult?.("str_replace_editor", output, false);
          return { output, isError: false };
        }

        const output = lines.map((line, i) => `${i + 1}: ${line}`).join("\n");
        config.onToolResult?.("str_replace_editor", output, false);
        return { output, isError: false };
      }

      case "create": {
        if (!input.file_text) {
          return { output: "Error: file_text required for create", isError: true };
        }

        // Write to local workspace
        await context.workspace.writeFile(input.path, input.file_text);
        context.modifiedFiles.add(input.path);

        const output = `Created file: ${input.path}`;
        config.onToolResult?.("str_replace_editor", output, false);
        return { output, isError: false };
      }

      case "str_replace": {
        if (!input.old_str || input.new_str === undefined) {
          return { output: "Error: old_str and new_str required for str_replace", isError: true };
        }

        // Read, replace, write to local workspace
        const content = await context.workspace.readFile(input.path);
        if (!content.includes(input.old_str)) {
          const output = `Error: old_str not found in ${input.path}`;
          config.onToolResult?.("str_replace_editor", output, true);
          return { output, isError: true };
        }

        const newContent = content.replace(input.old_str, input.new_str);
        await context.workspace.writeFile(input.path, newContent);
        context.modifiedFiles.add(input.path);

        const output = `Replaced in ${input.path}`;
        config.onToolResult?.("str_replace_editor", output, false);
        return { output, isError: false };
      }

      case "insert": {
        if (input.insert_line === undefined || input.new_str === undefined) {
          return { output: "Error: insert_line and new_str required for insert", isError: true };
        }

        // Read, insert, write to local workspace
        const content = await context.workspace.readFile(input.path);
        const lines = content.split("\n");
        lines.splice(input.insert_line, 0, input.new_str);
        const newContent = lines.join("\n");
        await context.workspace.writeFile(input.path, newContent);
        context.modifiedFiles.add(input.path);

        const output = `Inserted at line ${input.insert_line} in ${input.path}`;
        config.onToolResult?.("str_replace_editor", output, false);
        return { output, isError: false };
      }

      case "undo_edit": {
        // NOTE(#claude-code-undo): Implement undo tracking via workspace history
        return { output: "Undo not yet implemented", isError: true };
      }

      default:
        return { output: `Unknown command: ${input.command}`, isError: true };
    }
  } catch (error) {
    const output = `Error: ${error instanceof Error ? error.message : String(error)}`;
    config.onToolResult?.("str_replace_editor", output, true);
    return { output, isError: true };
  }
}

/**
 * Execute a tool call
 */
async function executeTool(
  toolCall: ClaudeToolCall,
  context: ClaudeCodeContext,
  config: ClaudeCodeAgentConfig,
): Promise<ClaudeToolResult> {
  let result: { output: string; isError: boolean };

  switch (toolCall.name) {
    case "bash":
      result = await executeBash(toolCall.input as unknown as BashToolInput, context, config);
      break;

    case "str_replace_editor":
      result = await executeTextEditor(
        toolCall.input as unknown as TextEditorToolInput,
        context,
        config,
      );
      break;

    case "computer":
      // NOTE(#claude-code-computer): Computer use to be implemented
      result = { output: "Computer use not yet implemented", isError: true };
      break;

    default:
      result = { output: `Unknown tool: ${toolCall.name}`, isError: true };
  }

  return {
    type: "tool_result",
    tool_use_id: toolCall.id,
    content: result.output,
    is_error: result.isError,
  };
}

/**
 * Run one iteration of the agentic loop
 */
async function runIteration(
  messages: Array<{ role: string; content: unknown }>,
  tools: AnthropicToolDefinition[],
  context: ClaudeCodeContext,
  config: ClaudeCodeAgentConfig,
): Promise<IterationResult> {
  // Dynamic import to avoid loading Anthropic SDK if not needed
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();

  const response = await client.messages.create({
    model: config.model || DEFAULT_MODEL,
    max_tokens: 16000,
    system: config.system || DEFAULT_SYSTEM,
    tools: tools as any,
    messages: messages as any,
  });

  const toolCalls: ClaudeToolCall[] = [];
  const toolResults: ClaudeToolResult[] = [];
  let text: string | undefined;

  // Process response content
  for (const block of response.content) {
    if (block.type === "text") {
      text = block.text;
    } else if (block.type === "tool_use") {
      const toolCall: ClaudeToolCall = {
        id: block.id,
        type: "tool_use",
        name: block.name,
        input: block.input as Record<string, unknown>,
      };
      toolCalls.push(toolCall);

      // Execute tool
      const result = await executeTool(toolCall, context, config);
      toolResults.push(result);
    }
  }

  const iterationResult: IterationResult = {
    iteration: context.iteration,
    toolCalls,
    toolResults,
    text,
    completed: response.stop_reason === "end_turn" && toolCalls.length === 0,
    stopReason: response.stop_reason || "unknown",
  };

  config.onIteration?.(context.iteration, iterationResult);

  return iterationResult;
}

/**
 * Create a Claude Code agent
 */
export function claudeCodeAgent(config: ClaudeCodeAgentConfig = {}): ClaudeCodeAgentInstance {
  const id = config.id || "claude-code";
  const mode = config.mode || "code";
  const maxIterations = config.maxIterations || DEFAULT_MAX_ITERATIONS;
  const totalTimeout = config.totalTimeout || DEFAULT_TOTAL_TIMEOUT;

  return {
    id,
    model: config.model || DEFAULT_MODEL,

    generate: async (params): Promise<ClaudeCodeAgentResponse> => {
      const startTime = Date.now();
      const runId = crypto.randomUUID();

      // Get tenant context
      const tenant = getWorkflowTenant();
      if (!tenant) {
        throw new Error(
          "Claude Code agent must run within a workflow step with tenant context. " +
            "Ensure the workflow was started within a request context.",
        );
      }

      // Initialize workspace sync to download project files
      const workspace = createWorkspaceSync({
        runId,
        tenant,
        debug: config.debug,
      });

      let workspaceInitialized = false;
      let detectedChanges: FileChange[] = [];

      try {
        // Download project files to local workspace
        if (config.debug) {
          logger.info("[ClaudeCode] Initializing workspace...");
        }

        const syncResult = await workspace.initialize();
        workspaceInitialized = true;

        if (config.debug) {
          logger.info("[ClaudeCode] Workspace initialized", {
            files: syncResult.filesDownloaded,
            bytes: syncResult.bytesDownloaded,
            dir: syncResult.workspaceDir,
          });
        }

        // Initialize execution context with workspace
        const context: ClaudeCodeContext = {
          projectSlug: tenant.projectSlug,
          projectId: tenant.projectId,
          workingDir: workspace.workspaceDir,
          workspace,
          modifiedFiles: new Set(),
          executedCommands: [],
          iteration: 0,
          startTime,
        };

        // Get tools for mode
        const tools = getToolsForMode(mode);

        // Build initial messages
        const messages: Array<{ role: string; content: unknown }> = [
          { role: "user", content: params.input },
        ];

        const iterationHistory: IterationResult[] = [];

        // Agentic loop
        while (context.iteration < maxIterations) {
          // Check total timeout
          if (Date.now() - startTime > totalTimeout) {
            throw new Error(`Total timeout exceeded (${totalTimeout}ms)`);
          }

          context.iteration++;

          if (config.debug) {
            logger.info(`[ClaudeCode] Iteration ${context.iteration}/${maxIterations}`);
          }

          // Run iteration
          const result = await runIteration(messages, tools, context, config);
          iterationHistory.push(result);

          // If completed (no tool calls), we're done
          if (result.completed) {
            // Detect changes in workspace
            detectedChanges = await workspace.detectChanges();

            if (config.debug) {
              logger.info("[ClaudeCode] Detected changes", {
                count: detectedChanges.length,
                created: detectedChanges.filter((c) => c.type === "created").length,
                modified: detectedChanges.filter((c) => c.type === "modified").length,
                deleted: detectedChanges.filter((c) => c.type === "deleted").length,
              });
            }

            const finalResult: ClaudeCodeResult = {
              success: true,
              iterations: context.iteration,
              response: result.text,
              filesModified: [...context.modifiedFiles],
              commandsExecuted: context.executedCommands,
              executionTime: Date.now() - startTime,
              iterationHistory,
              changes: detectedChanges,
            };

            config.onComplete?.(finalResult);

            return {
              text: result.text || JSON.stringify(finalResult),
              status: "completed",
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, // NOTE(#claude-code-usage): Token tracking to be added
            };
          }

          // Add assistant response and tool results to messages
          messages.push({
            role: "assistant",
            content: result.toolCalls.map((tc) => ({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: tc.input,
            })),
          });

          messages.push({
            role: "user",
            content: result.toolResults,
          });
        }

        // Max iterations reached - still detect changes
        detectedChanges = await workspace.detectChanges();

        const finalResult: ClaudeCodeResult = {
          success: false,
          iterations: context.iteration,
          error: `Max iterations (${maxIterations}) reached`,
          filesModified: [...context.modifiedFiles],
          commandsExecuted: context.executedCommands,
          executionTime: Date.now() - startTime,
          iterationHistory,
          changes: detectedChanges,
        };

        config.onComplete?.(finalResult);

        return {
          text: JSON.stringify(finalResult),
          status: "completed",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
      } catch (error) {
        // Try to detect changes even on error
        if (workspaceInitialized) {
          try {
            detectedChanges = await workspace.detectChanges();
          } catch {
            // Ignore change detection errors during error handling
          }
        }

        const finalResult: ClaudeCodeResult = {
          success: false,
          iterations: 0,
          error: error instanceof Error ? error.message : String(error),
          filesModified: [],
          commandsExecuted: [],
          executionTime: Date.now() - startTime,
          iterationHistory: [],
          changes: detectedChanges,
        };

        config.onComplete?.(finalResult);

        throw error;
      } finally {
        // Always try to cleanup workspace, even if initialization failed partially
        // This ensures we don't leave behind temp directories if initialize() created
        // the directory but then failed during file download
        try {
          await workspace.cleanup();
          if (config.debug) {
            logger.info("[ClaudeCode] Workspace cleaned up");
          }
        } catch (cleanupError) {
          // Only log if workspace was actually initialized - otherwise cleanup
          // failure is expected (directory doesn't exist)
          if (workspaceInitialized) {
            logger.error("[ClaudeCode] Workspace cleanup failed:", cleanupError);
          }
        }
      }
    },
  };
}

/**
 * Default Claude Code agent instance
 */
export const defaultClaudeCodeAgent = claudeCodeAgent();
