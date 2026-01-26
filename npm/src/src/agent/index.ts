/**
 * Agent module - First-class agent runtime
 *
 * @module veryfront/agent
 */
import "../../_dnt.polyfills.js";


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
} from "./types.js";

export { getTextFromParts, getToolArguments, hasArgs, hasInput } from "./types.js";

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
} from "./memory/index.js";

export {
  agentAsTool,
  agentRegistry,
  AgentRegistryClass,
  createWorkflow,
  getAgent,
  getAgentsAsTools,
  getAllAgentIds,
  registerAgent,
  type WorkflowConfig,
  type WorkflowResult,
  type WorkflowStep,
} from "./composition/index.js";

export { agent } from "./factory.js";
export { AgentRuntime } from "./runtime/index.js";
