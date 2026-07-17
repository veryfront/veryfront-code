/****
 * Tool type definitions
 */

import type { JsonSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import type { BlobStorage } from "#veryfront/workflow/blob/types.ts";
import type { ToolAnnotations } from "#veryfront/mcp/annotations.ts";

/**
 * Tool configuration options
 */
// deno-lint-ignore no-explicit-any -- generic erasure: interface must accept any concrete ToolConfig instantiation
export interface ToolConfig<TInput = any, TOutput = any> {
  /** Tool identifier (optional, inferred from filename) */
  id?: string;

  /** Tool description for the AI model */
  description: string;

  /**
   * Native integration tools this local wrapper may call through the platform.
   * Hosts use this metadata for connection binding and least-privilege runtime
   * authorization. These dependencies are not exposed to the model as tools.
   */
  delegatedIntegrationTools?: readonly string[];

  /**
   * Input schema produced via `defineSchema((v) => …)` (or any
   * `SchemaValidator`-backed builder), or a raw JSON Schema object for
   * dynamic/project-authored tools. Schema validators parse before `execute`;
   * raw JSON Schema is passed through to providers without runtime parsing.
   */
  inputSchema: Schema<TInput> | JsonSchema;

  /**
   * Optional output schema. Hosts can use this to document or validate
   * structured tool results.
   */
  outputSchema?: Schema<TOutput> | JsonSchema;

  /**
   * Allow unknown/non-contract schemas to fall back to a permissive JSON
   * schema. Use only for truly dynamic tools; prefer `v.unknown()` or
   * `v.any()` from the SchemaValidator DSL instead.
   */
  allowUnknownSchema?: boolean;

  /**
   * Tool execution function
   */
  execute: (input: TInput, context?: ToolExecutionContext) => Promise<TOutput> | TOutput;

  /** MCP configuration */
  mcp?: {
    /** Expose via MCP */
    enabled?: boolean;

    /** Require authentication */
    requiresAuth?: boolean;

    /** Cache policy */
    cachePolicy?: "no-cache" | "cache" | "cache-first";

    /** Human-readable title for display */
    title?: string;
    /** Behavioral hints for clients (MCP 2025-11-25) */
    annotations?: ToolAnnotations;
  };
}

/**
 * Context passed to tool execution
 */
export interface ToolExecutionContext {
  /** ID of the agent calling the tool (if any) */
  agentId?: string;
  /** ID of the current agent run when the runtime is tracking run lifecycles */
  runId?: string;
  /** Stable ID for the current tool call when the runtime is tracking tool lifecycles */
  toolCallId?: string;
  /** Project identity used by integration token resolution */
  projectId?: string;
  /** Project slug/reference for project-local platform API tools */
  projectSlug?: string;
  /** Request-scoped Veryfront auth token for project-local platform API tools */
  authToken?: string;
  /** Whether the tool should read production release-backed project content */
  productionMode?: boolean;
  /** Release ID for production release-backed project content */
  releaseId?: string | null;
  /** Branch name or ID for preview project content */
  branch?: string | null;
  /** Environment name associated with project content */
  environmentName?: string | null;
  /** Canonical id of the active skill loaded by the current agent run step. */
  activeSkillId?: string;
  /**
   * File-backed capabilities advertised by the active loaded skill.
   *
   * Framework skill file tools use this to reject references/scripts that were
   * not listed by `load_skill`, even if the model guesses a valid path under a
   * skill directory.
   */
  activeSkillToolAvailability?: {
    hasActiveSkill?: boolean;
    references?: readonly string[];
    scripts?: readonly string[];
  };
  /** Abort signal for cooperative cancellation during long-running tool execution */
  abortSignal?: AbortSignal;
  /** Progress token for sending progress notifications (MCP 2025-11-25) */
  progressToken?: string | number;
  /**
   * Optional host-provided callback for publishing generic runtime data events.
   *
   * The payload intentionally stays framework-generic so hosts can surface
   * structured runtime signals without leaking product-specific event shapes
   * into the open-core contract.
   */
  publishDataEvent?: (event: ToolExecutionDataEvent) => void | Promise<void>;
  /** Additional context */
  [key: string]: unknown;
  /** Blob storage access (if configured in workflow) */
  blobStorage?: BlobStorage;
}

/** Event emitted for tool execution data. */
export interface ToolExecutionDataEvent {
  /** Host-defined event type */
  type: string;
  /** Optional structured event payload */
  data?: unknown;
  /** Additional host-defined fields */
  [key: string]: unknown;
}

/**
 * Tool type discriminator
 * - 'function': Standard tool with known input/output types (default)
 * - 'dynamic': Dynamic tool with unknown types (MCP tools, user-defined functions)
 */
type ToolType = "function" | "dynamic";

/**
 * Tool instance (returned by tool() function)
 */
// deno-lint-ignore no-explicit-any -- generic erasure: interface must accept any concrete Tool instantiation
export interface Tool<TInput = any, TOutput = any> {
  /** Tool ID */
  id: string;
  /** Internal marker used to distinguish autogenerated placeholder IDs from explicit IDs. */
  __veryfrontGeneratedId?: string;

  /**
   * Tool type discriminator
   * - 'function': Standard tool with known types (default)
   * - 'dynamic': Dynamic tool for MCP, user-defined functions, etc.
   */
  type: ToolType;

  /** Tool description */
  description: string;

  /** Native integration tools this local wrapper may call through the platform. */
  delegatedIntegrationTools?: readonly string[];

  /** Input schema produced by `defineSchema` (or any SchemaValidator-backed builder). */
  inputSchema: Schema<TInput>;

  /**
   * Pre-converted JSON Schema (for OpenAI/provider compatibility)
   * This is generated at tool creation time to avoid bundling issues
   */
  inputSchemaJson?: JsonSchema;

  /** Optional pre-converted JSON Schema for tool outputs. */
  outputSchemaJson?: JsonSchema;

  /** Optional output schema produced by `defineSchema`. */
  outputSchema?: Schema<TOutput>;

  /**
   * Execute the tool
   */
  execute: (input: TInput, context?: ToolExecutionContext) => Promise<TOutput>;

  /** MCP configuration */
  mcp?: ToolConfig["mcp"];

  /**
   * Owning agent id for agent-scoped tools. Unowned (undefined) tools are
   * project/global. Owned tools are invisible to other agents, excluded from
   * MCP `tools/list`, and rejected by registry execution unless the execution
   * context carries the owner's `agentId`.
   */
  ownerAgentId?: string;

  /** Short name used by the owning agent's `tools:` selector (e.g. "fetch"). */
  shortName?: string;
}

/**
 * Runtime tool map keyed by the tool name exposed to an agent.
 *
 * Hosts can use this for already-materialized framework tools, including
 * tools loaded from remote sources.
 */
export type ToolSet = Record<string, Tool<unknown, unknown>>;

/**
 * Provider-facing tool definition used for model/tool registration.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
  title?: string;
  annotations?: ToolAnnotations;
}

/**
 * Remote tool source loaded dynamically at runtime.
 * Hosts can provide these to expose tools from remote MCP-compatible systems
 * without registering those tools globally inside the framework.
 */
export interface RemoteToolSource {
  id: string;
  listTools(context?: ToolExecutionContext): Promise<ToolDefinition[]>;
  executeTool(
    toolName: string,
    args: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<unknown>;
}
