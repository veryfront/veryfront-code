/**************************
 * Agent type definitions
 **************************/
import * as dntShim from "../../_dnt.shims.js";
import type { Tool } from "../tool/index.js";
import type { Platform } from "../platform/core-platform.js";
import type { Memory } from "./memory/memory-interface.js";
export type ModelProvider = "openai" | "anthropic" | "google" | "local";
/**
 * Model configuration string format: "provider/model-name"
 * Examples: "openai/gpt-4", "anthropic/claude-3-5-sonnet"
 */
export type ModelString = string;
export interface MemoryConfig {
    type: "conversation" | "buffer" | "summary" | "redis";
    maxTokens?: number;
    maxMessages?: number;
}
export type AgentStatus = "idle" | "thinking" | "tool_execution" | "streaming" | "completed" | "error";
export interface AgentConfig {
    id?: string;
    model: ModelString;
    system: string | (() => string) | (() => Promise<string>);
    tools?: true | Record<string, Tool | boolean>;
    maxSteps?: number;
    streaming?: boolean;
    memory?: MemoryConfig;
    middleware?: AgentMiddleware[];
    edge?: EdgeConfig;
    multimodal?: {
        vision?: boolean;
        audio?: boolean;
    };
}
export interface EdgeConfig {
    enabled: boolean;
    maxSteps?: number;
    timeoutMs?: number;
    streaming?: boolean;
}
export type AgentMiddleware = (context: AgentContext, next: () => Promise<AgentResponse>) => Promise<AgentResponse>;
export interface AgentContext {
    agentId: string;
    model?: string;
    input: string | Message[];
    data?: Record<string, unknown>;
    platform: Platform;
    metadata?: Record<string, unknown>;
}
export interface ToolCallPartWithArgs {
    type: `tool-${string}`;
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
}
export interface ToolCallPartWithInput {
    type: `tool-${string}`;
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
}
export type ToolCallPart = ToolCallPartWithArgs | ToolCallPartWithInput;
export interface ToolResultPart {
    type: "tool-result";
    toolCallId: string;
    toolName: string;
    result: unknown;
}
export type MessagePart = {
    type: "text";
    text: string;
} | ToolCallPart | {
    type: "tool-call";
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
} | ToolResultPart;
export interface Message {
    id: string;
    role: "user" | "assistant" | "system" | "tool";
    parts: MessagePart[];
    timestamp?: number;
    metadata?: Record<string, unknown>;
}
export declare function getTextFromParts(parts: MessagePart[]): string;
export declare function hasArgs(part: ToolCallPart): part is ToolCallPartWithArgs;
export declare function hasInput(part: ToolCallPart): part is ToolCallPartWithInput;
export declare function getToolArguments(part: ToolCallPart): Record<string, unknown>;
export interface StreamToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}
export interface ToolCall {
    id: string;
    name: string;
    args: Record<string, unknown>;
    status: "pending" | "executing" | "completed" | "error";
    result?: unknown;
    error?: string;
    executionTime?: number;
}
export interface AgentResponse {
    text: string;
    messages: Message[];
    toolCalls: ToolCall[];
    status: AgentStatus;
    thinking?: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    metadata?: Record<string, unknown>;
}
export interface AgentStreamResult {
    toDataStreamResponse(options?: {
        headers?: Record<string, string>;
        status?: number;
        statusText?: string;
    }): dntShim.Response;
}
export interface Agent {
    id: string;
    config: AgentConfig;
    generate(input: {
        input: string | Message[];
        context?: Record<string, unknown>;
    }): Promise<AgentResponse>;
    stream(input: {
        input?: string;
        messages?: Message[];
        context?: Record<string, unknown>;
        onToolCall?: (toolCall: ToolCall) => void;
        onChunk?: (chunk: string) => void;
    }): Promise<AgentStreamResult>;
    respond(request: dntShim.Request): Promise<dntShim.Response>;
    getMemory(): Memory<Message>;
    getMemoryStats(): Promise<{
        totalMessages: number;
        estimatedTokens: number;
        type: string;
    }>;
    clearMemory(): Promise<void>;
}
//# sourceMappingURL=types.d.ts.map