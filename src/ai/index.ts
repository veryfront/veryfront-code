/**
 * Veryfront AI Module
 *
 * This is the 16th module of Veryfront, providing AI-native capabilities:
 * - Agent runtime with tool execution
 * - MCP (Model Context Protocol) server integration
 * - Provider integrations (OpenAI, Anthropic, etc.)
 * - Multi-runtime support (Deno, Node.js, Bun, Cloudflare Workers)
 *
 * @module veryfront/ai
 * @example
 * ```typescript
 * // Create an agent
 * import { agent, tool } from 'veryfront/ai';
 * import { z } from 'zod';
 *
 * // Define a tool
 * export const searchTool = tool({
 *   description: 'Search the web',
 *   inputSchema: z.object({
 *     query: z.string(),
 *   }),
 *   execute: async ({ query }) => {
 *     return await searchWeb(query);
 *   },
 * });
 *
 * // Define an agent
 * export const myAgent = agent({
 *   model: 'openai/gpt-4',
 *   system: 'You are a helpful assistant',
 *   tools: {
 *     searchWeb: searchTool,
 *   },
 * });
 *
 * // Use the agent
 * const response = await myAgent.generate({
 *   input: 'What is the weather today?',
 * });
 * ```
 */

// ============================================================================
// Public API - Factory Functions
// ============================================================================

/**
 * Create an agent
 */
export { agent } from "./agent/factory.ts";

/**
 * Create a tool
 */
export { tool } from "./utils/tool.ts";

/**
 * Re-export zod for schema definitions
 * This allows users to import z from 'veryfront/ai' without needing separate zod import
 * which ensures compatibility across Deno, Node.js, and other runtimes
 */
export { z } from "zod";

/**
 * Create an MCP resource
 */
export { resource } from "./mcp/resource.ts";

/**
 * Create an MCP prompt template
 */
export { prompt } from "./mcp/prompt.ts";

// ============================================================================
// Public API - Provider Management
// ============================================================================

export { getProvider, getProviderFromModel, initializeProviders } from "./providers/factory.ts";

// ============================================================================
// Public API - Platform Detection
// ============================================================================

export {
  detectPlatform,
  getPlatformCapabilities,
  getPlatformWarnings,
  supportsCapability,
  validatePlatformCompatibility,
} from "./runtime/platform.ts";

// ============================================================================
// Public API - Registries
// ============================================================================

export {
  getMCPRegistry,
  getMCPStats,
  registerPrompt,
  registerResource,
  registerTool,
} from "./mcp/registry.ts";

export { toolRegistry } from "./utils/tool.ts";
export { resourceRegistry } from "./mcp/resource.ts";
export { promptRegistry } from "./mcp/prompt.ts";
export { agentRegistry, getAgent, getAllAgentIds, registerAgent } from "./agent/composition.ts";

// ============================================================================
// Public API - Agent Composition
// ============================================================================

export { agentAsTool, createWorkflow, getAgentsAsTools } from "./agent/composition.ts";

export type { WorkflowConfig, WorkflowResult, WorkflowStep } from "./agent/composition.ts";

// ============================================================================
// Public API - Memory
// ============================================================================

export { BufferMemory, ConversationMemory, createMemory, SummaryMemory } from "./agent/memory.ts";

export type { Memory, MemoryPersistence, MemoryStats } from "./agent/memory.ts";

// ============================================================================
// Public API - Auto-Discovery & Setup
// ============================================================================

export { discoverAll } from "./utils/discovery.ts";
export type { DiscoveryConfig, DiscoveryResult } from "./utils/discovery.ts";

export { setupAI, type SetupAIOptions, type SetupAIResult } from "./utils/setup.ts";

// ============================================================================
// Public API - MCP Server
// ============================================================================

export { createMCPServer, MCPServer } from "./mcp/server.ts";

// ============================================================================
// Public API - AI SDK Integration (Recommended)
// ============================================================================

// Client-only exports (useChat, useCompletion, etc.) are now available at:
// import { useChat, useCompletion } from "veryfront/ai/client";
// This prevents server-side bundling issues

// Re-export AI SDK core
export { generateObject, generateText, streamText } from "ai";

// Re-export AI SDK providers (30+ providers available)
export { openai } from "@ai-sdk/openai";
export { anthropic } from "@ai-sdk/anthropic";

// AI SDK adapter utilities
export {
  aiSDKModel,
  isAISDKModel,
  toAISDKTool,
  toAISDKTools,
  useAISDK,
} from "./adapters/ai-sdk.ts";

// ============================================================================
// Public API - Custom Providers (Advanced - For Special Cases)
// ============================================================================

// For users who want to implement custom providers:
// - Internal/proprietary APIs
// - OpenAI-compatible endpoints (Ollama, vLLM)
// - Custom authentication flows
// - Educational purposes

export { BaseProvider } from "./providers/base.ts";
export { OpenAIProvider } from "./providers/openai.ts";
export { AnthropicProvider } from "./providers/anthropic.ts";
export { GoogleProvider } from "./providers/google.ts";

// ============================================================================
// Public API - Production Features
// ============================================================================

export {
  cacheMiddleware,
  COMMON_BLOCKED_PATTERNS,
  costTrackingMiddleware,
  // Caching
  createCache,
  // Cost tracking
  createCostTracker,
  // Rate limiting
  createRateLimiter,
  InputValidator,
  OutputFilter,
  rateLimitMiddleware,
  // Security
  securityMiddleware,
} from "./production/index.ts";

export type {
  CacheConfig,
  CacheEntry,
  CostConfig,
  RateLimitConfig,
  RateLimitResult,
  SecurityConfig,
  SecurityViolation,
  UsageRecord,
  UsageSummary,
} from "./production/index.ts";

// ============================================================================
// Public API - Durable Workflows
// ============================================================================

// Re-export workflow module
// Full workflow API available at: import { ... } from "veryfront/ai/workflow";
export {
  branch,
  createWorkflowClient,
  // Backend
  MemoryBackend,
  parallel,
  step,
  waitForApproval,
  // DSL builders
  workflow,
  // Client
  WorkflowClient,
} from "./workflow/index.ts";

export type {
  Checkpoint,
  PendingApproval,
  // Backend
  WorkflowBackend,
  // Client
  WorkflowClientConfig,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowHandle,
  WorkflowNode,
  WorkflowRun,
  // Core types
  WorkflowStatus,
} from "./workflow/index.ts";

// ============================================================================
// Public API - Types
// ============================================================================

export type {
  // Agent types
  Agent,
  AgentConfig,
  AgentContext,
  AgentMiddleware,
  AgentResponse,
  AgentStatus,
  AnthropicConfig,
  CompletionRequest,
  CompletionResponse,
  EdgeConfig,
  GoogleConfig,
  MCPRegistry,
  MCPServerConfig,
  MemoryConfig,
  Message,
  ModelProvider,
  ModelString,
  OpenAIConfig,
  // Platform types
  Platform,
  PlatformCapabilities,
  Prompt,
  PromptConfig,
  // Provider types
  Provider,
  ProviderConfig,
  ProvidersConfig,
  // MCP types
  Resource,
  ResourceConfig,
  // Tool types
  Tool,
  ToolCall,
  ToolConfig,
  ToolExecutionContext,
} from "./types/index.ts";
