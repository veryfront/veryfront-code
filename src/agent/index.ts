/**
 * Agent module - First-class agent runtime
 *
 * @module veryfront/agent
 */

// Types
export type {
  Agent,
  AgentConfig,
  AgentContext,
  AgentMiddleware,
  AgentResponse,
  AgentStatus,
  AgentStreamResult,
  EdgeConfig,
  MemoryConfig,
  Message,
  MessagePart,
  ModelProvider,
  ModelString,
  StreamToolCall,
  ToolCall,
  ToolCallPart,
  ToolCallPartWithArgs,
  ToolCallPartWithInput,
  ToolResultPart,
} from "./types.ts";

// Type guards and helpers
export {
  getTextFromParts,
  getToolArguments,
  hasArgs,
  hasInput,
} from "./types.ts";

// Memory
export {
  BufferMemory,
  ConversationMemory,
  createMemory,
  createRedisMemory,
  estimateTokens,
  type Memory,
  type MemoryPersistence,
  type MemoryStats,
  type RedisClient,
  RedisMemory,
  type RedisMemoryConfig,
  SummaryMemory,
} from "./memory/index.ts";

// Composition
export {
  agentAsTool,
  AgentRegistryClass,
  agentRegistry,
  createWorkflow,
  getAgent,
  getAgentsAsTools,
  getAllAgentIds,
  registerAgent,
  type WorkflowConfig,
  type WorkflowResult,
  type WorkflowStep,
} from "./composition/index.ts";

// Re-export agent factory from old location for now
// Will be updated once the full runtime is migrated
export { agent } from "../ai/agent/factory.ts";
export { AgentRuntime } from "../ai/agent/runtime/index.ts";
