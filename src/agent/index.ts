/**
 * AI agents with memory, tools, and multi-agent composition.
 *
 * @module agent
 *
 * @example Basic agent
 * ```ts
 * import { agent } from "veryfront/agent";
 *
 * const assistant = agent({
 *   model: "openai/gpt-4o",
 *   system: "You are a helpful assistant.",
 * });
 * ```
 *
 * @example Agent with tools
 * ```ts
 * import { agent } from "veryfront/agent";
 * import { tool } from "veryfront/tool";
 * import { z } from "zod";
 *
 * const searchTool = tool({
 *   id: "search",
 *   description: "Search the knowledge base",
 *   inputSchema: z.object({ query: z.string() }),
 *   execute: async ({ query }) => ({ results: [] }),
 * });
 *
 * const assistant = agent({
 *   model: "openai/gpt-4o",
 *   system: "You are a helpful assistant.",
 *   tools: { search: searchTool },
 *   memory: { type: "conversation", maxMessages: 50 },
 * });
 * ```
 *
 * @example Agent with skills
 * ```ts
 * import { agent } from "veryfront/agent";
 *
 * const assistant = agent({
 *   model: "openai/gpt-4o",
 *   system: "You are a support engineer. Use skills when relevant.",
 *   skills: ["incident-response", "repo-maintainer"], // or `true` for all discovered skills
 *   tools: {
 *     Read: true,
 *     "github:list-issues": true,
 *   },
 * });
 * ```
 *
 * @example Streaming API route
 * ```ts
 * // app/api/chat/route.ts
 * import { agent } from "veryfront/agent";
 *
 * const assistant = agent({
 *   model: "openai/gpt-4o",
 *   system: "You are a helpful assistant.",
 * });
 *
 * export async function POST(req: Request) {
 *   const { messages } = await req.json();
 *   const result = await assistant.stream({ messages });
 *   return result.toDataStreamResponse();
 * }
 * ```
 *
 * @example Multi-agent composition
 * ```ts
 * import { agent, registerAgent, getAgentsAsTools } from "veryfront/agent";
 *
 * const researcher = agent({ model: "openai/gpt-4o", system: "Research topics thoroughly." });
 * const writer = agent({ model: "openai/gpt-4o", system: "Write clear prose." });
 *
 * registerAgent(researcher);
 * registerAgent(writer);
 *
 * const orchestrator = agent({
 *   model: "openai/gpt-4o",
 *   system: "Coordinate research and writing.",
 *   tools: getAgentsAsTools(["researcher", "writer"]),
 * });
 * ```
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
export { type ChatHandlerOptions, createChatHandler } from "./chat-handler.ts";
export { AgentRuntime } from "./runtime/index.ts";
