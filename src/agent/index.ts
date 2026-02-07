/**
 * Agent module - First-class agent runtime
 *
 * @module veryfront/agent
 */

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
  /** @deprecated Use `AgentMessage` instead to avoid collision with chat `Message` component. */
  Message,
  Message as AgentMessage,
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

export { getTextFromParts, getToolArguments, hasArgs, hasInput } from "./types.ts";

export {
  BufferMemory,
  ConversationMemory,
  createMemory,
  createRedisMemory,
  type Memory,
  type MemoryPersistence,
  type MemoryStats,
  type RedisClient,
  RedisMemory,
  type RedisMemoryConfig,
  SummaryMemory,
} from "./memory/index.ts";

export {
  agentAsTool,
  createWorkflow,
  getAgent,
  getAgentsAsTools,
  getAllAgentIds,
  registerAgent,
  type WorkflowConfig,
  type WorkflowResult,
  type WorkflowStep,
} from "./composition/index.ts";

export { agent } from "./factory.ts";
export { AgentRuntime } from "./runtime/index.ts";
