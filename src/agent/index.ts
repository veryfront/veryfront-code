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
 * const researcher = agent({ system: "Research topics thoroughly." });
 * const writer = agent({ system: "Write clear prose." });
 *
 * registerAgent(researcher);
 * registerAgent(writer);
 *
 * const orchestrator = agent({
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
  AgentSuggestion,
  AgentSuggestions,
  EdgeConfig,
  MemoryConfig,
  Message as AgentMessage,
  MessagePart,
  ModelProvider,
  ModelString,
  ModelTransportRequest,
  ModelTransportResolver,
  ResolvedAgentConfig,
  ResolvedModelTransport,
  ResolvedRuntimeState,
  RuntimeStateRequest,
  RuntimeStateResolver,
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
export {
  type AgUiRuntimeHandlerConfig,
  type AgUiRuntimeHandlerConfigWithAgent,
  type AgUiRuntimeHandlerExecute,
  type AgUiRuntimeHandlerExecuteInput,
  type AgUiRuntimeHandlerOptions,
  type AgUiRuntimeLifecycleContext,
  createAgUiRuntimeHandler,
} from "./ag-ui-runtime-handler.ts";
export {
  type AgUiRuntimeContextItem,
  AgUiRuntimeContextItemSchema,
  type AgUiRuntimeInjectedTool,
  AgUiRuntimeInjectedToolSchema,
  type AgUiRuntimeMessage,
  AgUiRuntimeMessageSchema,
  type AgUiRuntimeRequest,
  AgUiRuntimeRequestSchema,
  parseAgUiRuntimeRequest,
  parseAgUiRuntimeRequestOrError,
} from "./runtime-ag-ui-contract.ts";
export { normalizeAgUiRuntimeMessages } from "./ag-ui-runtime-support.ts";
export {
  type AgUiBrowserEncodedEvent,
  type AgUiBrowserEncoderState,
  type AgUiBrowserRunFinishedMetadata,
  type AgUiRuntimeStreamEvent,
  createAgUiBrowserEncoderState,
  finalizeAgUiBrowserEvents,
  mapRuntimeStreamEventToAgUiBrowserEvents,
} from "./ag-ui-browser-encoder.ts";
export {
  type AgUiBrowserResponseEncoder,
  type AgUiBrowserResponseExecution,
  type AgUiBrowserResponseRequestState,
  createAgUiBrowserResponseStream,
  type CreateAgUiBrowserResponseStreamInput,
} from "./ag-ui-browser-response-stream.ts";
export {
  mergeToolCallInput,
  mergeToolInputDelta,
  parseDataStreamSseEvents,
  parseToolInputObject,
  streamDataStreamEvents,
  stripLeadingEmptyObjectPlaceholder,
} from "./data-stream.ts";
export {
  expandAllowedRemoteToolNames,
  getProviderNativeToolNames,
  type ProviderNativeToolInventoryOptions,
} from "./provider-native-tool-inventory.ts";
export {
  type AgUiDetachedStartAccepted,
  AgUiDetachedStartAcceptedSchema,
  type AgUiDetachedStartHandlerOptions,
  type AgUiDetachedStartRequest,
  AgUiDetachedStartRequestSchema,
  createAgUiDetachedStartHandler,
  executeAgUiDetachedStart,
  type ExecuteAgUiDetachedStartInput,
} from "./ag-ui-detached-start.ts";
export {
  type AgUiCancelHandlerOptions,
  type AgUiResumeHandlerOptions,
  type AgUiResumeSignal,
  AgUiResumeSignalSchema,
  createAgUiCancelHandler,
  createAgUiResumeHandler,
} from "./ag-ui-run-control.ts";
export {
  type AgUiSseEvent,
  createAgUiRunErrorEvent,
  createAgUiSseErrorResponse,
  normalizeAgUiMessages,
  parseAgUiRequest,
  parseAgUiRequestOrError,
} from "./ag-ui-host-support.ts";
export {
  type AgUiContextItem,
  type AgUiHandlerConfigWithAgent,
  type AgUiHandlerOptions,
  type AgUiInjectedTool,
  type AgUiRequest,
  AgUiRequestSchema,
  createAgUiHandler,
} from "./ag-ui-handler.ts";
export {
  type HumanInputField,
  type HumanInputFieldInput,
  HumanInputFieldSchema,
  type HumanInputOption,
  HumanInputOptionSchema,
  type HumanInputPendingRequest,
  HumanInputPendingRequestSchema,
  type HumanInputRequest,
  type HumanInputRequestInput,
  HumanInputRequestSchema,
  type HumanInputResult,
  HumanInputResultSchema,
  HumanInputResumeError,
  InvalidHumanInputResultError,
  waitForHumanInput,
  type WaitForHumanInputOptions,
} from "./human-input.ts";
export {
  type ChatHandlerBeforeStream,
  type ChatHandlerBeforeStreamContext,
  type ChatHandlerBeforeStreamResult,
  type ChatHandlerConfigWithAgent,
  type ChatHandlerMessageInput,
  type ChatHandlerOptions,
  createChatHandler,
} from "./chat-handler.ts";
export {
  AgentRuntime,
  RunAlreadyExistsError,
  RunCancelledError,
  RunNotActiveError,
  RunResumeSessionManager,
  type RunResumeSessionManagerOptions,
  type RunSessionStatus,
  type SubmitResumeValueOutcome,
  WaitConflictError,
  WaitNotPendingError,
} from "./runtime/index.ts";
