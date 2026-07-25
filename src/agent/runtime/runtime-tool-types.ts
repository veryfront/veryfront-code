/**
 * Runtime Tool Types
 *
 * Framework-owned types for the current tool-calling and streaming runtime
 * boundary. These cover only the shapes the framework consumes today.
 */

import type { RuntimeUsage } from "#veryfront/provider/runtime-usage.ts";
import type { TextGenerationRuntimeMessage } from "./text-generation-runtime-message-types.ts";

export type RuntimeToolSet = Record<string, unknown>;

export interface RuntimeGenerateToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
  providerExecuted?: boolean;
  dynamic?: boolean;
  supportsDeferredResults?: boolean;
}

export interface RuntimeGenerateToolResult {
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
  providerExecuted?: boolean;
  dynamic?: boolean;
  supportsDeferredResults?: boolean;
}

export interface RuntimeQuarantinedToolResult {
  toolCallId: string;
  toolName: string;
}

export interface RuntimeGenerateUsage extends RuntimeUsage {
  /** Compatibility alias for {@link RuntimeUsage.cacheReadInputTokens}. */
  cachedInputTokens?: number;
}

export interface RuntimeGenerateTextResult {
  text: string;
  toolCalls?: RuntimeGenerateToolCall[];
  toolResults?: RuntimeGenerateToolResult[];
  quarantinedToolResults?: RuntimeQuarantinedToolResult[];
  usage?: RuntimeGenerateUsage;
  finishReason?: string | null;
  providerMetadata?: Record<string, unknown>;
}

export interface RuntimeRepairToolCall {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: unknown;
  providerExecuted?: boolean;
  dynamic?: boolean;
  supportsDeferredResults?: boolean;
}

export interface RuntimeToolCallRepairContext {
  error: unknown;
  inputSchema: (...args: unknown[]) => unknown;
  messages: TextGenerationRuntimeMessage[];
  system?: string;
  toolCall: RuntimeRepairToolCall;
  tools: RuntimeToolSet;
}

export type RuntimeToolCallRepairFunction = (
  context: RuntimeToolCallRepairContext,
) => Promise<RuntimeRepairToolCall | null> | RuntimeRepairToolCall | null;

export type RuntimeStreamPart =
  | { type: "stream-start"; warnings?: unknown[] }
  | {
    type: "response-metadata";
    id?: string;
    timestamp?: Date;
    modelId?: string;
  }
  | { type: "text-start"; id: string }
  | { type: "text-delta"; text: string }
  | { type: "text-end"; id: string }
  | { type: "reasoning-start"; id: string }
  | { type: "reasoning-delta"; id: string; delta: string }
  | { type: "reasoning-end"; id: string; signature?: string; redactedData?: string }
  | {
    type: `data-${string}`;
    data: unknown;
  }
  | {
    /**
     * Deeply owned, bounded JSON emitted when a model runtime receives
     * `includeRawChunks: true`.
     */
    type: "raw";
    rawValue: unknown;
  }
  | {
    type: "tool-input-start";
    id: string;
    toolName: string;
    providerExecuted?: boolean;
    dynamic?: boolean;
    supportsDeferredResults?: boolean;
  }
  | { type: "tool-input-delta"; id: string; delta: string }
  | { type: "tool-input-end"; id: string }
  | {
    type: "tool-input-available";
    toolCallId?: string;
    id?: string;
    toolName: string;
    input: unknown;
    providerExecuted?: boolean;
    dynamic?: boolean;
    supportsDeferredResults?: boolean;
  }
  | {
    type: "tool-call";
    toolCallId: string;
    toolName: string;
    input: unknown;
    providerExecuted?: boolean;
    dynamic?: boolean;
    supportsDeferredResults?: boolean;
  }
  | {
    type: "tool-result";
    toolCallId: string;
    toolName: string;
    /**
     * Normalized tool result payload used by Veryfront-owned runtime code.
     * Some provider SDK stream parts call the same payload `result`; callers
     * should accept both names at stream boundaries.
     */
    output?: unknown;
    result?: unknown;
    error?: unknown;
    input?: unknown;
    providerExecuted?: boolean;
    dynamic?: boolean;
    supportsDeferredResults?: boolean;
    preliminary?: boolean;
    isError?: boolean;
  }
  | {
    type: "tool-error";
    toolCallId: string;
    toolName: string;
    error?: unknown;
    input?: unknown;
    providerExecuted?: boolean;
    dynamic?: boolean;
    supportsDeferredResults?: boolean;
    preliminary?: boolean;
    isError?: boolean;
  }
  | {
    type: "finish";
    finishReason?: string | null;
    providerMetadata?: Record<string, unknown>;
    totalUsage?: RuntimeGenerateUsage | null;
  }
  | { type: "error"; error: unknown };

export interface RuntimeStreamResult {
  fullStream: AsyncIterable<unknown>;
  textStream: AsyncIterable<string>;
}
