/**
 * RLM TypeScript - Production Types
 *
 * Complete type definitions for Recursive Language Models
 * Based on https://github.com/alexzhang13/rlm
 */

// ============== Backend Types ==============

export type ClientBackend =
  | "openai"
  | "anthropic"
  | "azure_openai"
  | "gemini"
  | "openrouter"
  | "ollama"
  | "groq"
  | "together"
  | "fireworks";

export type EnvironmentType =
  | "local"        // Same process, sandboxed eval
  | "worker"       // Deno/Node worker thread
  | "container"    // Docker container
  | "remote";      // Remote execution service

// ============== Usage & Metrics ==============

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ModelUsage {
  model: string;
  calls: number;
  tokens: TokenUsage;
  latencyMs: number[];
  cost?: number;
}

export interface UsageSummary {
  models: Map<string, ModelUsage>;
  totalCalls: number;
  totalTokens: TokenUsage;
  totalLatencyMs: number;
  totalCost?: number;
}

// ============== Execution Results ==============

export interface ExecutionOutput {
  stdout: string;
  stderr: string;
  returnValue?: unknown;
}

export interface REPLResult {
  success: boolean;
  output: ExecutionOutput;
  locals: Record<string, unknown>;
  executionTimeMs: number;
  nestedRLMCalls: NestedRLMCall[];
  error?: ExecutionError;
}

export interface ExecutionError {
  name: string;
  message: string;
  stack?: string;
  line?: number;
  column?: number;
}

export interface NestedRLMCall {
  depth: number;
  query: string;
  response: string;
  model: string;
  tokens: TokenUsage;
  executionTimeMs: number;
}

// ============== Code Extraction ==============

export interface CodeBlock {
  code: string;
  language: string;
  startLine: number;
  endLine: number;
}

export interface ParsedResponse {
  rawResponse: string;
  codeBlocks: CodeBlock[];
  textSegments: string[];
  finalAnswer?: string;
  hasFinalAnswer: boolean;
}

// ============== Iteration & History ==============

export interface RLMIteration {
  index: number;
  prompt: string;
  response: string;
  parsedResponse: ParsedResponse;
  executionResults: REPLResult[];
  iterationTimeMs: number;
  tokens: TokenUsage;
}

export interface ConversationMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface ConversationHistory {
  messages: ConversationMessage[];
  tokenCount: number;
}

// ============== Configuration ==============

export interface LLMClientConfig {
  model: string;
  apiKey?: string;
  baseUrl?: string;
  organization?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

export interface EnvironmentConfig {
  type: EnvironmentType;
  persistent?: boolean;
  timeout?: number;
  memoryLimit?: number;
  allowedGlobals?: string[];
  blockedGlobals?: string[];
  preloadModules?: string[];
  workingDirectory?: string;
}

export interface LoggerConfig {
  level: "debug" | "info" | "warn" | "error" | "silent";
  logDir?: string;
  includeTimestamps?: boolean;
  includeMetadata?: boolean;
  format?: "json" | "text";
}

export interface RLMConfig {
  // Required
  backend: ClientBackend;
  backendConfig: LLMClientConfig;

  // Environment
  environment?: EnvironmentConfig;

  // Execution limits
  maxIterations?: number;
  maxDepth?: number;
  maxExecutionTimeMs?: number;
  maxTokensPerIteration?: number;

  // Prompts
  systemPrompt?: string;
  codeBlockDelimiters?: { start: string; end: string };
  finalAnswerPattern?: RegExp;

  // Logging & Observability
  logger?: LoggerConfig;
  onIteration?: (iteration: RLMIteration) => void | Promise<void>;
  onCodeExecution?: (code: string, result: REPLResult) => void | Promise<void>;
  onNestedCall?: (call: NestedRLMCall) => void | Promise<void>;

  // Advanced
  verbose?: boolean;
  traceId?: string;
  metadata?: Record<string, unknown>;
}

// ============== Completion ==============

export interface RLMCompletionOptions {
  query: string;
  context?: RLMContext;
  conversationHistory?: ConversationHistory;
  overrides?: Partial<RLMConfig>;
}

export interface RLMCompletionResult {
  // Core result
  success: boolean;
  response: string;
  finalAnswer?: string;

  // Execution details
  iterations: RLMIteration[];
  iterationCount: number;

  // Context info
  contextMetadata: ContextMetadata;

  // Usage & performance
  usage: UsageSummary;
  totalTimeMs: number;

  // Metadata
  traceId: string;
  config: RLMConfig;

  // Error handling
  error?: RLMError;
  warnings: string[];
}

export interface RLMStreamChunk {
  type: "text" | "code_start" | "code_end" | "execution" | "final_answer" | "error" | "done";
  content?: string;
  codeBlock?: CodeBlock;
  executionResult?: REPLResult;
  iteration?: number;
  metadata?: Record<string, unknown>;
}

export type RLMStream = AsyncIterable<RLMStreamChunk>;

// ============== Context ==============

export type RLMContext =
  | Record<string, unknown>
  | string
  | unknown[]
  | Map<string, unknown>;

export interface ContextMetadata {
  type: "object" | "string" | "array" | "map";
  keys?: string[];
  totalSize: number;
  estimatedTokens: number;
}

export interface LoadedContext {
  variables: Record<string, unknown>;
  metadata: ContextMetadata;
}

// ============== Errors ==============

export class RLMError extends Error {
  constructor(
    message: string,
    public code: RLMErrorCode,
    public details?: Record<string, unknown>,
    public override cause?: Error
  ) {
    super(message);
    this.name = "RLMError";
  }
}

export type RLMErrorCode =
  | "INVALID_CONFIG"
  | "BACKEND_ERROR"
  | "ENVIRONMENT_ERROR"
  | "EXECUTION_ERROR"
  | "TIMEOUT"
  | "MAX_ITERATIONS"
  | "MAX_DEPTH"
  | "CONTEXT_TOO_LARGE"
  | "RATE_LIMIT"
  | "AUTHENTICATION"
  | "NETWORK"
  | "UNKNOWN";

// ============== Client Interface ==============

export interface LLMClient {
  readonly backend: ClientBackend;
  readonly model: string;

  complete(
    messages: ConversationMessage[],
    options?: Partial<LLMClientConfig>
  ): Promise<LLMCompletion>;

  stream(
    messages: ConversationMessage[],
    options?: Partial<LLMClientConfig>
  ): AsyncIterable<string>;

  countTokens(text: string): number;
}

export interface LLMCompletion {
  content: string;
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | "error";
  tokens: TokenUsage;
  latencyMs: number;
  model: string;
}

// ============== Environment Interface ==============

export interface RLMEnvironment {
  readonly type: EnvironmentType;
  readonly persistent: boolean;

  setup(): Promise<void>;
  teardown(): Promise<void>;

  loadContext(context: RLMContext): Promise<LoadedContext>;
  execute(code: string): Promise<REPLResult>;
  getLocals(): Record<string, unknown>;
  clearLocals(): void;

  // For nested RLM calls
  registerLLMHandler(handler: NestedLLMHandler): void;
}

export type NestedLLMHandler = (
  query: string,
  depth: number
) => Promise<NestedRLMCall>;

// ============== Logger Interface ==============

export interface RLMLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, error?: Error, data?: Record<string, unknown>): void;

  logIteration(iteration: RLMIteration): void;
  logExecution(code: string, result: REPLResult): void;
  logCompletion(result: RLMCompletionResult): void;

  getTrajectory(): RLMIteration[];
  exportTrajectory(format: "json" | "html"): string;
}

// ============== API Types (for veryfront-api) ==============

export interface RLMAPIRequest {
  query: string;
  context?: RLMContext;
  config?: Partial<RLMConfig>;
  stream?: boolean;
  webhookUrl?: string;
}

export interface RLMAPIResponse {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: RLMCompletionResult;
  stream?: ReadableStream<RLMStreamChunk>;
  createdAt: string;
  completedAt?: string;
}

export interface RLMAPIError {
  code: RLMErrorCode;
  message: string;
  details?: Record<string, unknown>;
  requestId: string;
}
