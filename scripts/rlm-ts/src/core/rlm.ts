/**
 * RLM - Recursive Language Model
 *
 * Main orchestration class that coordinates:
 * - LLM completions
 * - Code execution in sandboxed environment
 * - Recursive sub-calls
 * - Iteration management
 */

import type {
  ConversationMessage,
  ContextMetadata,
  LLMClient,
  LLMCompletion,
  NestedRLMCall,
  REPLResult,
  RLMCompletionOptions,
  RLMCompletionResult,
  RLMConfig,
  RLMContext,
  RLMEnvironment,
  RLMIteration,
  RLMStream,
  UsageSummary,
} from "../types.ts";
import { RLMError } from "../types.ts";
import { createLLMClient } from "../clients/base.ts";
import { LocalEnvironment } from "../environments/local.ts";
import { ResponseParser } from "./parser.ts";

// Default system prompt for RLM
const DEFAULT_SYSTEM_PROMPT = `You are an AI assistant with access to a JavaScript REPL environment.

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

For nested LLM queries within code, use:
\`\`\`javascript
const answer = await llm_query("Your question here");
\`\`\`

When you have the final answer, clearly state it with "FINAL ANSWER:" followed by your response.

Guidelines:
- Break complex problems into steps
- Use code to process data, perform calculations, or explore context
- Explain your reasoning before and after code execution
- If code fails, analyze the error and try a different approach
- Always provide a clear FINAL ANSWER when done`;

export class RLM {
  private config: RLMConfig;
  private client: LLMClient | null = null;
  private environment: RLMEnvironment | null = null;
  private parser: ResponseParser;

  constructor(config: RLMConfig) {
    this.config = {
      maxIterations: 10,
      maxDepth: 5,
      maxExecutionTimeMs: 300000, // 5 minutes
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      verbose: false,
      ...config,
    };
    this.parser = new ResponseParser();
  }

  /**
   * Execute a completion with the RLM
   */
  async completion(options: RLMCompletionOptions): Promise<RLMCompletionResult> {
    const startTime = performance.now();
    const traceId = this.config.traceId ?? crypto.randomUUID();

    const iterations: RLMIteration[] = [];
    const warnings: string[] = [];
    let finalAnswer: string | undefined;
    let lastResponse = "";

    // Initialize resources
    await this.initializeResources();

    // Load context
    let contextMetadata: ContextMetadata = {
      type: "object",
      totalSize: 0,
      estimatedTokens: 0,
    };

    if (options.context) {
      const loaded = await this.environment!.loadContext(options.context);
      contextMetadata = loaded.metadata;
    }

    // Build initial messages
    const messages: ConversationMessage[] = this.buildInitialMessages(
      options.query,
      options.context,
      options.conversationHistory?.messages
    );

    // Usage tracking
    const usage = this.createEmptyUsage();

    try {
      // Main iteration loop
      for (let i = 0; i < this.config.maxIterations!; i++) {
        // Check timeout
        if (performance.now() - startTime > this.config.maxExecutionTimeMs!) {
          throw new RLMError(
            "Execution timeout exceeded",
            "TIMEOUT",
            { maxMs: this.config.maxExecutionTimeMs }
          );
        }

        const iterationStart = performance.now();

        // Get LLM completion
        const completion = await this.client!.complete(messages);
        this.updateUsage(usage, completion);

        lastResponse = completion.content;

        // Parse response
        const parsed = this.parser.parse(completion.content);

        // Execute code blocks
        const executionResults: REPLResult[] = [];

        for (const block of this.parser.getExecutableBlocks(parsed.codeBlocks)) {
          if (this.config.verbose) {
            console.log(`[RLM] Executing code block (${block.language})...`);
          }

          const result = await this.environment!.execute(block.code);
          executionResults.push(result);

          // Callback
          if (this.config.onCodeExecution) {
            await this.config.onCodeExecution(block.code, result);
          }

          // Track nested calls
          for (const nestedCall of result.nestedRLMCalls) {
            if (this.config.onNestedCall) {
              await this.config.onNestedCall(nestedCall);
            }
          }

          // Add execution result to messages
          messages.push({
            role: "assistant",
            content: completion.content,
          });

          const outputMsg = this.formatExecutionOutput(result);
          messages.push({
            role: "user",
            content: `Code execution result:\n${outputMsg}`,
          });
        }

        // Build iteration record
        const iteration: RLMIteration = {
          index: i,
          prompt: messages[messages.length - 2]?.content ?? "",
          response: completion.content,
          parsedResponse: parsed,
          executionResults,
          iterationTimeMs: performance.now() - iterationStart,
          tokens: completion.tokens,
        };

        iterations.push(iteration);

        // Callback
        if (this.config.onIteration) {
          await this.config.onIteration(iteration);
        }

        // Check for final answer
        if (parsed.hasFinalAnswer) {
          finalAnswer = parsed.finalAnswer;
          break;
        }

        // If no code blocks were executed, check if we should continue
        if (executionResults.length === 0) {
          // Add assistant message and prompt for continuation
          messages.push({
            role: "assistant",
            content: completion.content,
          });

          // Check if response seems complete
          if (this.looksLikeCompletion(completion.content)) {
            finalAnswer = completion.content;
            break;
          }

          messages.push({
            role: "user",
            content: "Please continue. If you have the answer, state it with 'FINAL ANSWER:'",
          });
        }
      }

      // Check if we hit max iterations without final answer
      if (!finalAnswer && iterations.length >= this.config.maxIterations!) {
        warnings.push("Max iterations reached without explicit final answer");
        finalAnswer = lastResponse;
      }

      return {
        success: true,
        response: lastResponse,
        finalAnswer,
        iterations,
        iterationCount: iterations.length,
        contextMetadata,
        usage,
        totalTimeMs: performance.now() - startTime,
        traceId,
        config: this.config,
        warnings,
      };
    } catch (error) {
      const rlmError =
        error instanceof RLMError
          ? error
          : new RLMError(
              error instanceof Error ? error.message : String(error),
              "UNKNOWN",
              undefined,
              error instanceof Error ? error : undefined
            );

      return {
        success: false,
        response: lastResponse,
        finalAnswer: undefined,
        iterations,
        iterationCount: iterations.length,
        contextMetadata,
        usage,
        totalTimeMs: performance.now() - startTime,
        traceId,
        config: this.config,
        error: rlmError,
        warnings,
      };
    } finally {
      await this.cleanupResources();
    }
  }

  /**
   * Stream completion chunks
   */
  async *stream(options: RLMCompletionOptions): RLMStream {
    // For now, implement basic streaming by wrapping completion
    // Full streaming implementation would stream LLM responses and emit execution events

    const startTime = performance.now();
    let iterationIndex = 0;

    await this.initializeResources();

    if (options.context) {
      await this.environment!.loadContext(options.context);
    }

    const messages: ConversationMessage[] = this.buildInitialMessages(
      options.query,
      options.context
    );

    try {
      for (let i = 0; i < this.config.maxIterations!; i++) {
        iterationIndex = i;

        // Stream LLM response
        let fullResponse = "";
        for await (const chunk of this.client!.stream(messages)) {
          fullResponse += chunk;
          yield {
            type: "text",
            content: chunk,
            iteration: i,
          };
        }

        // Parse and execute
        const parsed = this.parser.parse(fullResponse);

        for (const block of this.parser.getExecutableBlocks(parsed.codeBlocks)) {
          yield {
            type: "code_start",
            codeBlock: block,
            iteration: i,
          };

          const result = await this.environment!.execute(block.code);

          yield {
            type: "execution",
            executionResult: result,
            codeBlock: block,
            iteration: i,
          };

          yield {
            type: "code_end",
            codeBlock: block,
            iteration: i,
          };

          // Update messages for next iteration
          messages.push({ role: "assistant", content: fullResponse });
          messages.push({
            role: "user",
            content: `Code execution result:\n${this.formatExecutionOutput(result)}`,
          });
        }

        // Check for final answer
        if (parsed.hasFinalAnswer) {
          yield {
            type: "final_answer",
            content: parsed.finalAnswer,
            iteration: i,
          };
          break;
        }

        if (parsed.codeBlocks.length === 0) {
          messages.push({ role: "assistant", content: fullResponse });

          if (this.looksLikeCompletion(fullResponse)) {
            yield {
              type: "final_answer",
              content: fullResponse,
              iteration: i,
            };
            break;
          }

          messages.push({
            role: "user",
            content: "Please continue. If you have the answer, state it with 'FINAL ANSWER:'",
          });
        }
      }

      yield {
        type: "done",
        metadata: {
          iterations: iterationIndex + 1,
          totalTimeMs: performance.now() - startTime,
        },
      };
    } catch (error) {
      yield {
        type: "error",
        content: error instanceof Error ? error.message : String(error),
        metadata: { error },
      };
    } finally {
      await this.cleanupResources();
    }
  }

  /**
   * Initialize LLM client and environment
   */
  private async initializeResources(): Promise<void> {
    // Create LLM client
    this.client = await createLLMClient(
      this.config.backend,
      this.config.backendConfig
    );

    // Create environment
    this.environment = new LocalEnvironment(
      this.config.environment ?? { type: "local" }
    );

    await this.environment.setup();

    // Register nested LLM handler
    this.environment.registerLLMHandler(this.handleNestedQuery.bind(this));
  }

  /**
   * Cleanup resources
   */
  private async cleanupResources(): Promise<void> {
    if (this.environment && !this.config.environment?.persistent) {
      await this.environment.teardown();
    }
  }

  /**
   * Handle nested LLM query from code execution
   */
  private async handleNestedQuery(
    query: string,
    depth: number
  ): Promise<NestedRLMCall> {
    if (depth > this.config.maxDepth!) {
      throw new RLMError(
        `Max recursion depth (${this.config.maxDepth}) exceeded`,
        "MAX_DEPTH"
      );
    }

    const startTime = performance.now();

    const completion = await this.client!.complete([
      {
        role: "system",
        content: "You are a helpful assistant answering a sub-query. Be concise.",
      },
      { role: "user", content: query },
    ]);

    return {
      depth,
      query,
      response: completion.content,
      model: completion.model,
      tokens: completion.tokens,
      executionTimeMs: performance.now() - startTime,
    };
  }

  /**
   * Build initial conversation messages
   */
  private buildInitialMessages(
    query: string,
    context?: RLMContext,
    history?: ConversationMessage[]
  ): ConversationMessage[] {
    const messages: ConversationMessage[] = [];

    // System prompt
    messages.push({
      role: "system",
      content: this.config.systemPrompt!,
    });

    // History
    if (history) {
      messages.push(...history);
    }

    // Context description
    if (context) {
      const contextDesc = this.describeContext(context);
      messages.push({
        role: "user",
        content: `Context available:\n${contextDesc}`,
      });
    }

    // Main query
    messages.push({
      role: "user",
      content: query,
    });

    return messages;
  }

  /**
   * Describe context for LLM
   */
  private describeContext(context: RLMContext): string {
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

  /**
   * Format execution output for messages
   */
  private formatExecutionOutput(result: REPLResult): string {
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

  /**
   * Check if response looks like a completion
   */
  private looksLikeCompletion(response: string): boolean {
    const lower = response.toLowerCase();
    return (
      lower.includes("the answer is") ||
      lower.includes("in conclusion") ||
      lower.includes("to summarize") ||
      lower.includes("therefore") ||
      response.endsWith(".") && response.length > 100
    );
  }

  /**
   * Create empty usage summary
   */
  private createEmptyUsage(): UsageSummary {
    return {
      models: new Map(),
      totalCalls: 0,
      totalTokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      totalLatencyMs: 0,
    };
  }

  /**
   * Update usage summary with completion
   */
  private updateUsage(usage: UsageSummary, completion: LLMCompletion): void {
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
}

/**
 * Create RLM instance with simplified config
 */
export function createRLM(config: RLMConfig): RLM {
  return new RLM(config);
}
