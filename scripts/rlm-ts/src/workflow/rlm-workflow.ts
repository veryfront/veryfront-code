/**
 * RLM Workflow Integration
 *
 * Integrates RLM with veryfront's durable workflow system for:
 * - Durable execution (survives crashes)
 * - Checkpointing between iterations
 * - Batch API cost optimization
 * - Serverless deployment
 */

import type {
  RLMConfig,
  RLMContext,
  RLMCompletionResult,
  RLMIteration,
  ConversationMessage,
  LLMCompletion,
  UsageSummary,
  ContextMetadata,
} from "../types.ts";
import { RLMError } from "../types.ts";
import { createLLMClient } from "../clients/base.ts";
import { LocalEnvironment } from "../environments/local.ts";
import { ResponseParser } from "../core/parser.ts";

// ============================================================================
// Types for Workflow Integration
// ============================================================================

/**
 * RLM job submitted to the workflow system
 */
export interface RLMJob {
  /** Unique job ID */
  jobId: string;
  /** Query to process */
  query: string;
  /** Context data */
  context?: RLMContext;
  /** RLM configuration */
  config: RLMConfig;
  /** Priority (higher = more urgent) */
  priority?: number;
  /** Whether to use batch API */
  useBatch?: boolean;
  /** Webhook URL for completion notification */
  webhookUrl?: string;
  /** Metadata for tracking */
  metadata?: Record<string, unknown>;
}

/**
 * State persisted between iterations
 */
export interface RLMWorkflowState {
  /** Current iteration index */
  iteration: number;
  /** Conversation messages */
  messages: ConversationMessage[];
  /** Completed iterations */
  iterations: RLMIteration[];
  /** Accumulated usage */
  usage: UsageSummary;
  /** Last response */
  lastResponse: string;
  /** Final answer if found */
  finalAnswer?: string;
  /** Context metadata */
  contextMetadata?: ContextMetadata;
  /** Start time (ms since epoch) */
  startTime: number;
  /** Trace ID */
  traceId: string;
}

/**
 * Result of a single iteration step
 */
export interface IterationResult {
  /** Whether to continue iterating */
  continue: boolean;
  /** Updated state */
  state: RLMWorkflowState;
  /** This iteration's data */
  iteration?: RLMIteration;
  /** Error if failed */
  error?: RLMError;
}

/**
 * Batch job for OpenAI/Anthropic Batch APIs
 */
export interface BatchJob {
  /** Custom ID for tracking */
  custom_id: string;
  /** HTTP method */
  method: "POST";
  /** API endpoint */
  url: string;
  /** Request body */
  body: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    max_tokens?: number;
    temperature?: number;
  };
}

// ============================================================================
// RLM Workflow Step Executor
// ============================================================================

/**
 * Execute a single RLM iteration
 *
 * This is designed to be called from a durable workflow step,
 * with state checkpointed between calls.
 */
export async function executeIteration(
  state: RLMWorkflowState,
  config: RLMConfig
): Promise<IterationResult> {
  const parser = new ResponseParser();

  // Check timeout
  const elapsed = Date.now() - state.startTime;
  if (elapsed > (config.maxExecutionTimeMs ?? 300000)) {
    return {
      continue: false,
      state,
      error: new RLMError("Execution timeout exceeded", "TIMEOUT", {
        elapsed,
        maxMs: config.maxExecutionTimeMs,
      }),
    };
  }

  // Check max iterations
  if (state.iteration >= (config.maxIterations ?? 10)) {
    return {
      continue: false,
      state: {
        ...state,
        finalAnswer: state.lastResponse,
      },
    };
  }

  try {
    // Create LLM client for this iteration
    const client = await createLLMClient(config.backend, config.backendConfig);

    const iterationStart = performance.now();

    // Get LLM completion
    const completion = await client.complete(state.messages);
    updateUsage(state.usage, completion);

    state.lastResponse = completion.content;

    // Parse response
    const parsed = parser.parse(completion.content);

    // Execute code blocks if any
    const executionResults = [];
    const executableBlocks = parser.getExecutableBlocks(parsed.codeBlocks);

    if (executableBlocks.length > 0) {
      const env = new LocalEnvironment();
      await env.setup();

      for (const block of executableBlocks) {
        const result = await env.execute(block.code);
        executionResults.push(result);

        // Add execution result to messages
        state.messages.push({
          role: "assistant",
          content: completion.content,
        });

        const outputMsg = formatExecutionOutput(result);
        state.messages.push({
          role: "user",
          content: `Code execution result:\n${outputMsg}`,
        });
      }

      await env.teardown();
    }

    // Build iteration record
    const iteration: RLMIteration = {
      index: state.iteration,
      prompt: state.messages[state.messages.length - 2]?.content ?? "",
      response: completion.content,
      parsedResponse: parsed,
      executionResults,
      iterationTimeMs: performance.now() - iterationStart,
      tokens: completion.tokens,
    };

    state.iterations.push(iteration);
    state.iteration++;

    // Check for final answer
    if (parsed.hasFinalAnswer) {
      return {
        continue: false,
        state: {
          ...state,
          finalAnswer: parsed.finalAnswer,
        },
        iteration,
      };
    }

    // If no code blocks, check if response looks complete
    if (executionResults.length === 0) {
      state.messages.push({
        role: "assistant",
        content: completion.content,
      });

      if (looksLikeCompletion(completion.content)) {
        return {
          continue: false,
          state: {
            ...state,
            finalAnswer: completion.content,
          },
          iteration,
        };
      }

      state.messages.push({
        role: "user",
        content:
          "Please continue. If you have the answer, state it with 'FINAL ANSWER:'",
      });
    }

    return {
      continue: true,
      state,
      iteration,
    };
  } catch (error) {
    return {
      continue: false,
      state,
      error:
        error instanceof RLMError
          ? error
          : new RLMError(
              error instanceof Error ? error.message : String(error),
              "UNKNOWN",
              undefined,
              error instanceof Error ? error : undefined
            ),
    };
  }
}

/**
 * Initialize RLM workflow state
 */
export async function initializeState(
  job: RLMJob
): Promise<RLMWorkflowState> {
  const config = job.config;
  const traceId = config.traceId ?? crypto.randomUUID();

  const messages: ConversationMessage[] = [];

  // System prompt
  messages.push({
    role: "system",
    content: config.systemPrompt ?? getDefaultSystemPrompt(),
  });

  // Context description
  let contextMetadata: ContextMetadata | undefined;
  if (job.context) {
    const contextDesc = describeContext(job.context);
    messages.push({
      role: "user",
      content: `Context available:\n${contextDesc}`,
    });

    contextMetadata = analyzeContext(job.context);
  }

  // Main query
  messages.push({
    role: "user",
    content: job.query,
  });

  return {
    iteration: 0,
    messages,
    iterations: [],
    usage: createEmptyUsage(),
    lastResponse: "",
    contextMetadata,
    startTime: Date.now(),
    traceId,
  };
}

/**
 * Build final result from workflow state
 */
export function buildResult(
  state: RLMWorkflowState,
  config: RLMConfig,
  error?: RLMError
): RLMCompletionResult {
  return {
    success: !error,
    response: state.lastResponse,
    finalAnswer: state.finalAnswer,
    iterations: state.iterations,
    iterationCount: state.iterations.length,
    contextMetadata: state.contextMetadata ?? {
      type: "object",
      totalSize: 0,
      estimatedTokens: 0,
    },
    usage: state.usage,
    totalTimeMs: Date.now() - state.startTime,
    traceId: state.traceId,
    config,
    error,
    warnings: [],
  };
}

// ============================================================================
// Batch API Integration
// ============================================================================

/**
 * Prepare RLM iterations for batch processing
 *
 * This creates JSONL jobs for OpenAI/Anthropic Batch APIs
 */
export function prepareBatchJobs(
  jobs: RLMJob[],
  options: {
    batchSize?: number;
    model?: string;
  } = {}
): BatchJob[] {
  const { model = "gpt-4o" } = options;
  const batchJobs: BatchJob[] = [];

  for (const job of jobs) {
    const messages: Array<{ role: string; content: string }> = [];

    // System prompt
    messages.push({
      role: "system",
      content: job.config.systemPrompt ?? getDefaultSystemPrompt(),
    });

    // Context
    if (job.context) {
      messages.push({
        role: "user",
        content: `Context available:\n${describeContext(job.context)}`,
      });
    }

    // Query
    messages.push({
      role: "user",
      content: job.query,
    });

    batchJobs.push({
      custom_id: job.jobId,
      method: "POST",
      url: "/v1/chat/completions",
      body: {
        model,
        messages,
        max_completion_tokens: job.config.backendConfig.maxTokens ?? 4096,
        temperature: job.config.backendConfig.temperature,
      },
    });
  }

  return batchJobs;
}

/**
 * Convert batch jobs to JSONL format for submission
 */
export function batchJobsToJsonl(jobs: BatchJob[]): string {
  return jobs.map((job) => JSON.stringify(job)).join("\n");
}

// ============================================================================
// Veryfront Workflow Definition Helper
// ============================================================================

/**
 * Create an RLM workflow definition compatible with veryfront workflow system
 *
 * @example
 * ```typescript
 * import { createRLMWorkflow } from "./rlm-workflow.ts";
 * import { workflow, step, loop } from "veryfront/workflow";
 *
 * // Option 1: Use the helper
 * export default createRLMWorkflow({
 *   id: "rlm-processor",
 *   backend: "openai",
 *   backendConfig: {
 *     apiKey: process.env.OPENAI_API_KEY,
 *     model: "gpt-4o",
 *   },
 * });
 *
 * // Option 2: Manual workflow with RLM steps
 * export default workflow({
 *   id: "custom-rlm-workflow",
 *   inputSchema: z.object({
 *     query: z.string(),
 *     context: z.any().optional(),
 *   }),
 *   steps: ({ input }) => [
 *     step("init", {
 *       tool: "rlm-init",
 *       input: { query: input.query, context: input.context },
 *     }),
 *     loop("rlm-iterations", {
 *       while: (ctx) => ctx["iterate"]?.continue === true,
 *       maxIterations: 10,
 *       steps: [
 *         step("iterate", {
 *           tool: "rlm-iterate",
 *           input: (ctx) => ctx["init"] || ctx["iterate"]?.state,
 *         }),
 *       ],
 *     }),
 *     step("finalize", {
 *       tool: "rlm-finalize",
 *       input: (ctx) => ctx["iterate"]?.state,
 *     }),
 *   ],
 * });
 * ```
 */
export interface RLMWorkflowOptions {
  /** Workflow ID */
  id: string;
  /** LLM backend */
  backend: RLMConfig["backend"];
  /** Backend configuration */
  backendConfig: RLMConfig["backendConfig"];
  /** Max iterations (default: 10) */
  maxIterations?: number;
  /** Timeout (default: 5 minutes) */
  timeout?: string | number;
  /** Custom system prompt */
  systemPrompt?: string;
  /** Enable batch mode for cost optimization */
  enableBatch?: boolean;
}

/**
 * Creates workflow-compatible RLM execution configuration
 */
export function createRLMWorkflowConfig(options: RLMWorkflowOptions): {
  config: RLMConfig;
  tools: {
    init: (input: { query: string; context?: RLMContext }) => Promise<RLMWorkflowState>;
    iterate: (state: RLMWorkflowState) => Promise<IterationResult>;
    finalize: (state: RLMWorkflowState) => Promise<RLMCompletionResult>;
  };
} {
  const config: RLMConfig = {
    backend: options.backend,
    backendConfig: options.backendConfig,
    maxIterations: options.maxIterations ?? 10,
    maxExecutionTimeMs: parseTimeout(options.timeout ?? "5m"),
    systemPrompt: options.systemPrompt,
  };

  return {
    config,
    tools: {
      init: async (input) => {
        return initializeState({
          jobId: crypto.randomUUID(),
          query: input.query,
          context: input.context,
          config,
        });
      },
      iterate: async (state) => {
        return executeIteration(state, config);
      },
      finalize: async (state) => {
        return buildResult(state, config);
      },
    },
  };
}

// ============================================================================
// HTTP API Handlers
// ============================================================================

/**
 * Create HTTP handlers for RLM API endpoints
 *
 * @example
 * ```typescript
 * import { Hono } from "hono";
 * import { createRLMHandlers } from "./rlm-workflow.ts";
 *
 * const app = new Hono();
 * const rlm = createRLMHandlers({
 *   backend: "openai",
 *   backendConfig: { apiKey: process.env.OPENAI_API_KEY, model: "gpt-4o" },
 * });
 *
 * // Sync endpoint (immediate response)
 * app.post("/api/rlm/completion", rlm.completion);
 *
 * // Async endpoint (returns job ID, processes in background)
 * app.post("/api/rlm/jobs", rlm.submitJob);
 * app.get("/api/rlm/jobs/:id", rlm.getJob);
 * app.get("/api/rlm/jobs/:id/stream", rlm.streamJob);
 *
 * // Batch endpoint (for cost optimization)
 * app.post("/api/rlm/batch", rlm.submitBatch);
 * app.get("/api/rlm/batch/:id", rlm.getBatch);
 * ```
 */
export interface RLMHandlerConfig {
  backend: RLMConfig["backend"];
  backendConfig: RLMConfig["backendConfig"];
  /** Workflow backend for durable execution */
  workflowBackend?: unknown; // WorkflowBackend from veryfront
  /** Max concurrent jobs */
  maxConcurrency?: number;
  /** Default timeout */
  defaultTimeout?: string | number;
}

export function createRLMHandlers(_config: RLMHandlerConfig) {
  // This would be implemented with Hono/Express handlers
  // integrating with the veryfront workflow system

  return {
    // Sync completion - immediate response
    completion: async (_req: Request): Promise<Response> => {
      // Implementation would:
      // 1. Parse request body
      // 2. Run RLM iterations synchronously
      // 3. Return result
      throw new Error("Not implemented - use veryfront workflow integration");
    },

    // Async job submission - returns immediately with job ID
    submitJob: async (_req: Request): Promise<Response> => {
      // Implementation would:
      // 1. Parse request body
      // 2. Create workflow run with job
      // 3. Return job ID immediately
      throw new Error("Not implemented - use veryfront workflow integration");
    },

    // Get job status/result
    getJob: async (_req: Request): Promise<Response> => {
      // Implementation would:
      // 1. Get workflow run by ID
      // 2. Return current status/result
      throw new Error("Not implemented - use veryfront workflow integration");
    },

    // Stream job progress
    streamJob: async (_req: Request): Promise<Response> => {
      // Implementation would:
      // 1. Get workflow run
      // 2. Return SSE stream of progress
      throw new Error("Not implemented - use veryfront workflow integration");
    },

    // Batch submission for cost optimization
    submitBatch: async (_req: Request): Promise<Response> => {
      // Implementation would:
      // 1. Parse batch request
      // 2. Create batch jobs
      // 3. Submit to OpenAI/Anthropic Batch API
      // 4. Return batch ID
      throw new Error("Not implemented - use veryfront workflow integration");
    },

    // Get batch status
    getBatch: async (_req: Request): Promise<Response> => {
      // Implementation would:
      // 1. Check batch status with provider
      // 2. Return results if complete
      throw new Error("Not implemented - use veryfront workflow integration");
    },
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

function getDefaultSystemPrompt(): string {
  return `You are an AI assistant with access to a JavaScript REPL environment.

You can write and execute JavaScript code to help answer questions. The code runs in a sandboxed environment with access to:
- Standard JavaScript built-ins (Array, Object, Map, Set, etc.)
- JSON parsing/stringifying
- Math operations
- Console logging (captured as output)
- Context variables provided by the user

To execute code, wrap it in triple backticks with 'javascript' or 'js':

\`\`\`javascript
// Your code here
console.log("Hello");
\`\`\`

When you have the final answer, clearly state it with "FINAL ANSWER:" followed by your response.

Guidelines:
- Break complex problems into steps
- Use code to process data, perform calculations, or explore context
- Explain your reasoning before and after code execution
- If code fails, analyze the error and try a different approach
- Always provide a clear FINAL ANSWER when done`;
}

function describeContext(context: RLMContext): string {
  if (typeof context === "string") {
    return `A string variable \`context\` is available with ${context.length} characters.`;
  }
  if (Array.isArray(context)) {
    return `An array variable \`context\` is available with ${context.length} items.`;
  }
  if (context instanceof Map) {
    const keys = Array.from(context.keys());
    return `The following variables are available: ${keys.join(", ")}`;
  }
  const keys = Object.keys(context);
  return `The following variables are available: ${keys.join(", ")}`;
}

function analyzeContext(context: RLMContext): ContextMetadata {
  let type: ContextMetadata["type"];
  let keys: string[] | undefined;
  let totalSize: number;

  if (typeof context === "string") {
    type = "string";
    totalSize = context.length;
  } else if (Array.isArray(context)) {
    type = "array";
    totalSize = JSON.stringify(context).length;
  } else if (context instanceof Map) {
    type = "map";
    keys = Array.from(context.keys());
    totalSize = JSON.stringify(Object.fromEntries(context)).length;
  } else {
    type = "object";
    keys = Object.keys(context);
    totalSize = JSON.stringify(context).length;
  }

  return { type, keys, totalSize, estimatedTokens: Math.ceil(totalSize / 4) };
}

interface ExecutionOutput {
  stdout?: string;
  stderr?: string;
  returnValue?: unknown;
}

interface ExecutionResult {
  success: boolean;
  output: ExecutionOutput;
  error?: { name: string; message: string };
}

function formatExecutionOutput(result: ExecutionResult): string {
  const parts: string[] = [];
  if (result.output.stdout) {
    parts.push(`stdout:\n${result.output.stdout}`);
  }
  if (result.output.stderr) {
    parts.push(`stderr:\n${result.output.stderr}`);
  }
  if (result.error) {
    parts.push(`error: ${result.error.name}: ${result.error.message}`);
  }
  if (result.output.returnValue !== undefined) {
    parts.push(`return value: ${JSON.stringify(result.output.returnValue)}`);
  }
  return parts.join("\n\n") || "(no output)";
}

function looksLikeCompletion(response: string): boolean {
  const lower = response.toLowerCase();
  return (
    lower.includes("the answer is") ||
    lower.includes("in conclusion") ||
    lower.includes("to summarize") ||
    lower.includes("therefore") ||
    (response.endsWith(".") && response.length > 100)
  );
}

function createEmptyUsage(): UsageSummary {
  return {
    models: new Map(),
    totalCalls: 0,
    totalTokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    totalLatencyMs: 0,
  };
}

function updateUsage(usage: UsageSummary, completion: LLMCompletion): void {
  usage.totalCalls++;
  usage.totalTokens.inputTokens += completion.tokens.inputTokens;
  usage.totalTokens.outputTokens += completion.tokens.outputTokens;
  usage.totalTokens.totalTokens += completion.tokens.totalTokens;
  usage.totalLatencyMs += completion.latencyMs;

  let modelUsage = usage.models.get(completion.model);
  if (!modelUsage) {
    modelUsage = {
      model: completion.model,
      calls: 0,
      tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      latencyMs: [],
    };
    usage.models.set(completion.model, modelUsage);
  }

  modelUsage.calls++;
  modelUsage.tokens.inputTokens += completion.tokens.inputTokens;
  modelUsage.tokens.outputTokens += completion.tokens.outputTokens;
  modelUsage.tokens.totalTokens += completion.tokens.totalTokens;
  modelUsage.latencyMs.push(completion.latencyMs);
}

function parseTimeout(timeout: string | number): number {
  if (typeof timeout === "number") return timeout;
  const match = timeout.match(/^(\d+)(ms|s|m|h)$/);
  if (!match) return 300000;
  const value = parseInt(match[1]!, 10);
  const unit = match[2];
  switch (unit) {
    case "ms":
      return value;
    case "s":
      return value * 1000;
    case "m":
      return value * 60 * 1000;
    case "h":
      return value * 60 * 60 * 1000;
    default:
      return 300000;
  }
}
