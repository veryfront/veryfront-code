/**
 * Claude Code SDK Integration
 *
 * Provides Claude Code agentic capabilities within Veryfront workflows.
 *
 * @example
 * ```typescript
 * import { workflow, step } from "veryfront/ai/workflow";
 * import { claudeCodeTool } from "veryfront/ai/workflow/claude-code";
 *
 * export const migration = workflow({
 *   id: "migration",
 *   steps: [
 *     step("migrate", {
 *       tool: "claude-code",
 *       input: {
 *         task: "Migrate from React 17 to React 19",
 *         mode: "code",
 *       },
 *     }),
 *   ],
 * });
 * ```
 */

// Agent
export { claudeCodeAgent, defaultClaudeCodeAgent } from "./agent.ts";

// Tools
export {
  bugFixTool,
  claudeCodeTool,
  codeReviewTool,
  createClaudeCodeTool,
  docsTool,
  refactorTool,
} from "./tool.ts";

// Types
export type {
  AnthropicToolDefinition,
  BashToolInput,
  ClaudeCodeAgentConfig,
  ClaudeCodeContext,
  ClaudeCodeMode,
  ClaudeCodeResult,
  ClaudeCodeToolInput,
  ClaudeToolCall,
  ClaudeToolResult,
  CommandExecution,
  ComputerToolInput,
  FileOperation,
  IterationResult,
  SandboxMode,
  TextEditorToolInput,
} from "./types.ts";
