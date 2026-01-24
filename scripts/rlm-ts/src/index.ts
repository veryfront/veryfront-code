/**
 * RLM - Recursive Language Model
 *
 * A TypeScript implementation of Recursive Language Models for
 * agentic AI applications with code execution capabilities.
 *
 * @module rlm-ts
 */

// Core RLM
export { RLM, createRLM } from "./core/rlm.ts";
export { ResponseParser, parseResponse, extractExecutableCode } from "./core/parser.ts";
export { Logger, createLogger, silentLogger, defaultLogger } from "./core/logger.ts";

// Clients
export { BaseLLMClient, createLLMClient } from "./clients/base.ts";
export { OpenAIClient } from "./clients/openai.ts";
export { AnthropicClient } from "./clients/anthropic.ts";
export { GeminiClient } from "./clients/gemini.ts";
export { OllamaClient } from "./clients/ollama.ts";
export { AzureOpenAIClient } from "./clients/azure.ts";

// Environments
export { LocalEnvironment } from "./environments/local.ts";

// Workflow Integration
export {
  type RLMJob,
  type RLMWorkflowState,
  type IterationResult,
  type BatchJob,
  type RLMWorkflowOptions,
  type RLMHandlerConfig,
  initializeState,
  executeIteration,
  buildResult,
  prepareBatchJobs,
  batchJobsToJsonl,
  createRLMWorkflowConfig,
  createRLMHandlers,
} from "./workflow/index.ts";

// Types
export type {
  // Core types
  RLMConfig,
  RLMContext,
  RLMCompletionOptions,
  RLMCompletionResult,
  RLMIteration,
  RLMStream,
  RLMStreamChunk,
  // LLM types
  LLMClient,
  LLMClientConfig,
  LLMCompletion,
  ClientBackend,
  ConversationMessage,
  TokenUsage,
  // Environment types
  RLMEnvironment,
  EnvironmentType,
  EnvironmentConfig,
  REPLResult,
  ExecutionError,
  LoadedContext,
  ContextMetadata,
  // Parsing types
  ParsedResponse,
  CodeBlock,
  // Nested call types
  NestedRLMCall,
  NestedLLMHandler,
  // Usage tracking
  UsageSummary,
  ModelUsage,
  // Error types
  RLMErrorCode,
} from "./types.ts";

export { RLMError } from "./types.ts";
