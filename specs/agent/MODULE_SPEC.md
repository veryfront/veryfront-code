# NLSpec: src/agent/

## Purpose

The `src/agent/` module is the AI agent framework for the Veryfront platform. It provides a complete agent lifecycle: configuration, multi-step reasoning with tool calling, streaming responses via SSE, conversation memory management, middleware pipelines (rate limiting, caching, cost tracking, security), multi-agent composition (workflows and agent-as-tool), and client-side React hooks (`useChat`, `useAgent`, `useCompletion`, `useStreaming`, `useVoiceInput`). It supports cloud providers (OpenAI, Anthropic, Google), server-local inference via ONNX, and browser-side fallback inference via a Web Worker running HuggingFace transformers.

## Public API

### Exports (from `index.ts`)

| Export | Type | Description |
|--------|------|-------------|
| `agent` | `(config: AgentConfig) => Agent` | Factory function to create an agent instance |
| `createChatHandler` | `(agentId, options?) => POST handler` | Creates an HTTP POST handler for chat API routes |
| `AgentRuntime` | `class` | Core execution engine for agent loops |
| `registerAgent` | `(id, agent) => void` | Register an agent in the project-scoped registry |
| `getAgent` | `(id) => Agent \| undefined` | Retrieve a registered agent by ID |
| `getAllAgentIds` | `() => string[]` | List all registered agent IDs |
| `getAgentsAsTools` | `(descriptions?) => Record<string, Tool>` | Convert all registered agents into tools |
| `agentAsTool` | `(agent, description) => Tool` | Convert a single agent into a tool |
| `createWorkflow` | `(config) => { execute }` | Create a sequential workflow from agent steps |
| `createMemory` | `(config) => Memory` | Factory for memory implementations (conversation, buffer, summary) |
| `createRedisMemory` | `(agentId, config) => RedisMemory` | Create a Redis-backed memory |
| `BufferMemory` | `class` | Fixed-size sliding window memory |
| `ConversationMemory` | `class` | Token/message-limited conversation memory |
| `SummaryMemory` | `class` | Auto-summarizing memory with threshold |
| `RedisMemory` | `class` | Redis-backed distributed memory |
| `Agent` | `interface` | Agent instance with generate/stream/respond methods |
| `AgentConfig` | `interface` | Configuration for creating agents |
| `AgentStreamResult` | `interface` | Streaming result with `toDataStreamResponse()` |
| `Message` / `AgentMessage` | `type` | Message type with id, role, parts |
| `MessagePart` | `type` | Union of text, tool-call, tool-result parts |
| `ToolCall` | `type` | Tool call with status, args, result |
| `getTextFromParts` | `(parts) => string` | Extract text content from message parts |
| `getToolArguments` | `(part) => Record` | Extract args/input from a tool call part |
| `hasArgs` / `hasInput` | `(part) => boolean` | Type guards for tool call part variants |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `Tool`, `executeTool`, `toolRegistry` | `#veryfront/tool` | Tool registration, execution, and type definitions |
| `resolveModel`, `ensureModelReady`, `findAvailableCloudModel` | `#veryfront/provider` | Model resolution and cloud/local auto-upgrade |
| `detectPlatform`, `getPlatformCapabilities`, `validatePlatformCompatibility` | `#veryfront/platform` | Platform detection and capability validation |
| `skillRegistry`, `buildSkillManifestPrompt`, skill tools | `#veryfront/skill` | Skill discovery, prompt augmentation, tool creation |
| `registerTool`, `getMCPRegistry`, `getMCPStats` | `#veryfront/mcp` | MCP tool registration and registry inspection |
| `withSpan`, `setSpanAttributes`, `addSpanEvent` | `#veryfront/observability` | Distributed tracing |
| `createError`, `toError`, `fromError`, `ensureError` | `#veryfront/errors` | Structured error handling |
| `serverLogger`, `agentLogger` | `#veryfront/utils` | Logging |
| `generateId` | `#veryfront/utils/id.ts` | ID generation |
| `generateText`, `streamText`, `tool`, `jsonSchema` | `ai` | Vercel AI SDK for LLM interaction |
| `z` (zod) | `zod` | Schema validation for request/response types |
| `ProjectScopedRegistryManager`, `ScopedRegistryFacade` | `#veryfront/ai` | Project-scoped agent registry isolation |
| `react` | `react` | React hooks (useState, useCallback, useRef, useEffect) |

## Behaviors

### Behavior 1: Agent Creation (`agent()`)
- **Given**: An `AgentConfig` with model, system prompt, and optional tools/skills/middleware
- **When**: `agent(config)` is called
- **Then**: Creates an `Agent` instance, registers tools in the tool registry, augments system prompt with skill manifest if skills are configured, validates platform compatibility, creates `AgentRuntime`, registers the agent in `agentRegistry`, and sets `globalThis.__vfAgentFactory`
- **Edge cases**: Empty string ID throws; platform incompatibility throws; skills auto-register `load-skill`, `load-skill-reference`, `execute-skill-script` tools as shared

### Behavior 2: Non-Streaming Generation (`agent.generate()`)
- **Given**: A configured agent and user input (string or messages)
- **When**: `agent.generate({ input })` is called
- **Then**: Normalizes input to messages, adds to memory, resolves system prompt, runs middleware chain, executes the agent loop (multi-step with tool calling), returns `AgentResponse` with text, messages, toolCalls, status, and usage
- **Edge cases**: Local models skip tool calling; max steps reached adds warning metadata; model override validated against `allowedModels`

### Behavior 3: Streaming Response (`agent.stream()`)
- **Given**: A configured agent and messages
- **When**: `agent.stream({ messages })` is called
- **Then**: Returns `AgentStreamResult` wrapping a `ReadableStream<Uint8Array>` that emits SSE events (message-start, text-start, text-delta, text-end, step-start/end, tool-input-start/delta/available, tool-output-available/error, message-finish)
- **Edge cases**: `local/` models auto-upgrade to cloud when API keys available; model readiness checked eagerly (before stream creation) so `no_ai_available` errors propagate to caller

### Behavior 4: HTTP Chat Handler (`createChatHandler()`)
- **Given**: An agent ID and optional hooks
- **When**: A POST request arrives with `{ messages, model? }`
- **Then**: Validates request body with Zod, transforms UI messages (extracting tool results from assistant parts into separate tool-role messages), runs `beforeStream` hook, clears server-side memory, calls `agent.stream()`, returns SSE response
- **Edge cases**: `beforeStream` can return a `Response` to short-circuit; `beforeStream` can prepend/append/replace messages and override context; 503 response with `NO_AI_AVAILABLE` code triggers browser fallback; request extraction uses duck-typing (not `instanceof`) for cross-runtime compatibility

### Behavior 5: Skill Policy Enforcement
- **Given**: An agent with skills configured
- **When**: Tool calls are made during the agent loop
- **Then**: Before any skill tools run, `load-skill` must be called first (`mustLoadSkillFirst`); after `load-skill` succeeds, its `allowedTools` response becomes the active skill policy; subsequent tool calls are validated against this policy both at planning-time (tool filtering) and execution-time (per-call check)
- **Edge cases**: Invalid `allowedTools` shape fails closed (empty policy = no tools allowed); `undefined` means no restrictions; skill system tools (`load-skill`, `load-skill-reference`, `execute-skill-script`) are always allowed regardless of policy

### Behavior 6: Memory Management
- **Given**: A memory configuration (`conversation`, `buffer`, `summary`, or `redis`)
- **When**: Messages are added via `memory.add()`
- **Then**: Messages are stored with token/count limits enforced; `getMessages()` returns the current window; `getStats()` returns count and estimated tokens
- **Edge cases**: `ConversationMemory` trims by both `maxMessages` and `maxTokens`; `SummaryMemory` auto-summarizes when threshold reached; `BufferMemory` uses fixed sliding window; `RedisMemory` supports TTL expiration

### Behavior 7: Client-Side Chat (`useChat`)
- **Given**: A React component using `useChat({ api, ... })`
- **When**: User sends a message
- **Then**: Sends POST to API, consumes SSE stream, builds `UIMessage` parts in order (text, tool, reasoning, step markers), supports message editing with branching, model override, and inference mode detection
- **Edge cases**: 503 `NO_AI_AVAILABLE` triggers browser fallback via Web Worker; browser inference uses `@huggingface/transformers` loaded from CDN; `editMessage` creates branches; `switchBranch` navigates between edit branches

### Behavior 8: Middleware Pipeline
- **Given**: An agent with middleware configured
- **When**: `generate()` is called
- **Then**: Middleware chain executes in order; each middleware can modify context, short-circuit, or pass to next
- **Edge cases**: Rate limiter supports fixed-window, sliding-window, and token-bucket strategies; cache middleware includes project-scoped key isolation; security middleware validates input (length, blocked patterns, XSS) and filters output (PII redaction)

### Behavior 9: Multi-Agent Composition
- **Given**: Multiple registered agents
- **When**: `createWorkflow()` or `getAgentsAsTools()` is used
- **Then**: Workflows execute agents sequentially with optional step skipping and output transforms; `agentAsTool()` wraps an agent as a tool callable by other agents
- **Edge cases**: Agent registry is project-scoped via `ProjectScopedRegistryManager`; workflow steps can be conditionally skipped

### Behavior 10: Model Message Conversion
- **Given**: Internal `Message[]` with parts-based format
- **When**: Passed to AI SDK's `generateText()` or `streamText()`
- **Then**: Converts to `ModelMessage[]` format: user/system messages become flat text; assistant messages become arrays of text/tool-call content; tool messages become arrays of tool-result content
- **Edge cases**: Empty assistant parts get a placeholder empty text; tool-result parts in assistant messages are skipped; unknown roles fall back to user

## Constraints

- Public API signatures must not change (the `Agent` interface, `AgentConfig`, all exported types)
- The `any` in `createChatHandler` return type is intentional for Pages Router compatibility (duck-typed request argument)
- The `z.any()` for `platform` in `AgentContextSchema` is intentional (complex cross-module type)
- `globalThis` bridges (`__vfAgentFactory`, `__vfGetAgent`, `__vfRegisterAgent`, `__vfGetAllAgentIds`) are required for compiled-binary runtime shim

## Error Handling

- `agent()` throws `VeryFrontError` (type: "agent") for empty ID or platform incompatibility
- `createChatHandler` returns HTTP 400 for Zod validation failures, 404 for unknown agent, 403 for disallowed model override, 503 for `no_ai_available`, 500 for unexpected errors
- Tool execution errors are recorded as tool-result messages with `{ error }` and sent as SSE `tool-output-error` events
- Skill policy violations return error strings to the model as tool results (not thrown)
- Stream errors emit SSE `error` events and close the controller

## Side Effects

- `agent()` registers tools in `toolRegistry` and the agent in `agentRegistry`
- `agent()` sets `globalThis.__vfAgentFactory`
- `composition.ts` sets `globalThis.__vfGetAgent`, `__vfRegisterAgent`, `__vfGetAllAgentIds`
- `CostTracker` and `TTLCache` start periodic `setInterval` timers (cleaned up via `destroy()`)
- `RedisMemory` performs network I/O to Redis on every `add`/`getMessages`/`clear`/`getStats`/`touch`
- `BrowserInferenceClient` creates Web Workers and Blob URLs (cleaned up via `stop()`)

## Performance Constraints

- `MAX_STREAM_BUFFER_SIZE`: 1MB (from `STREAMING_DEFAULTS`)
- `DEFAULT_MAX_TOKENS`: 4096 output tokens per generation
- `DEFAULT_MAX_STEPS`: 20 agent loop iterations
- Memory token estimation uses `chars / 4` heuristic
- SSE events are encoded/flushed per-event (no batching)
- Tool argument parsing happens twice in streaming path (once for message parts, once for execution) -- acceptable for correctness
- Cache cleanup interval: 60 seconds for TTL cache; cost tracking reset check: 60 seconds

## Invariants

- Every agent has a unique ID (auto-generated if not provided)
- Memory is cleared before each `createChatHandler` request (client owns conversation history)
- Skill policy follows fail-closed semantics: invalid `allowedTools` shapes result in empty policy (no tools), not undefined (all tools)
- `AgentStreamResult.toDataStreamResponse()` always includes `x-vercel-ai-ui-message-stream: v1` header
- `convertToModelMessage` always produces non-empty assistant content (adds empty text if needed)
- Tool results from streaming tool calls include both an SSE event and a memory message
- Branch state is maintained per-edit-point; branch switching replays from the stable prefix
