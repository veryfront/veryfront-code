/**
 * Anthropic Client
 *
 * Client for Claude models via Anthropic API
 */

import type {
  ClientBackend,
  ConversationMessage,
  LLMClientConfig,
  LLMCompletion,
} from "../types.ts";
import { BaseLLMClient } from "./base.ts";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: Array<{
    type: "text";
    text: string;
  }>;
  model: string;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  delta?: {
    type: string;
    text?: string;
  };
  message?: AnthropicResponse;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export class AnthropicClient extends BaseLLMClient {
  readonly backend: ClientBackend = "anthropic";
  private baseUrl: string;

  constructor(config: LLMClientConfig) {
    super(config);
    this.baseUrl = config.baseUrl ?? "https://api.anthropic.com";
  }

  async complete(
    messages: ConversationMessage[],
    options?: Partial<LLMClientConfig>
  ): Promise<LLMCompletion> {
    const config = this.mergeConfig(options);
    const startTime = Date.now();

    const { systemPrompt, anthropicMessages } = this.convertMessages(messages);

    const response = await this.withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: this.buildHeaders(config),
        body: JSON.stringify(
          this.buildRequestBody(systemPrompt, anthropicMessages, config, false)
        ),
        signal: this.createTimeoutSignal(config.timeout),
      });

      if (!res.ok) {
        const error = await res.text();
        throw new Error(`Anthropic API error (${res.status}): ${error}`);
      }

      return res.json() as Promise<AnthropicResponse>;
    });

    const latencyMs = Date.now() - startTime;
    const content = response.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");

    return {
      content,
      finishReason: this.mapStopReason(response.stop_reason),
      tokens: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      latencyMs,
      model: response.model,
    };
  }

  async *stream(
    messages: ConversationMessage[],
    options?: Partial<LLMClientConfig>
  ): AsyncIterable<string> {
    const config = this.mergeConfig(options);
    const { systemPrompt, anthropicMessages } = this.convertMessages(messages);

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: this.buildHeaders(config),
      body: JSON.stringify(
        this.buildRequestBody(systemPrompt, anthropicMessages, config, true)
      ),
      signal: this.createTimeoutSignal(config.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          try {
            const event = JSON.parse(trimmed.slice(6)) as AnthropicStreamEvent;

            if (
              event.type === "content_block_delta" &&
              event.delta?.type === "text_delta" &&
              event.delta.text
            ) {
              yield event.delta.text;
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private buildHeaders(config: LLMClientConfig): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey ?? "",
      "anthropic-version": "2023-06-01",
    };
  }

  private buildRequestBody(
    systemPrompt: string | undefined,
    messages: AnthropicMessage[],
    config: LLMClientConfig,
    stream: boolean
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      max_tokens: config.maxTokens ?? 4096,
      stream,
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }
    if (config.temperature !== undefined) {
      body.temperature = config.temperature;
    }
    if (config.topP !== undefined) {
      body.top_p = config.topP;
    }
    if (config.stopSequences?.length) {
      body.stop_sequences = config.stopSequences;
    }

    return body;
  }

  private convertMessages(messages: ConversationMessage[]): {
    systemPrompt: string | undefined;
    anthropicMessages: AnthropicMessage[];
  } {
    let systemPrompt: string | undefined;
    const anthropicMessages: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemPrompt = (systemPrompt ?? "") + msg.content + "\n";
      } else {
        anthropicMessages.push({
          role: msg.role === "assistant" ? "assistant" : "user",
          content: msg.content,
        });
      }
    }

    // Ensure alternating user/assistant pattern
    const normalized = this.normalizeMessageOrder(anthropicMessages);

    return {
      systemPrompt: systemPrompt?.trim(),
      anthropicMessages: normalized,
    };
  }

  /**
   * Anthropic requires alternating user/assistant messages
   * starting with user
   */
  private normalizeMessageOrder(messages: AnthropicMessage[]): AnthropicMessage[] {
    if (messages.length === 0) return [];

    const result: AnthropicMessage[] = [];
    let lastRole: string | null = null;

    for (const msg of messages) {
      if (msg.role === lastRole) {
        // Merge consecutive same-role messages
        const last = result[result.length - 1];
        if (last) {
          last.content += "\n\n" + msg.content;
        }
      } else {
        // If first message is not user, prepend empty user message
        if (result.length === 0 && msg.role !== "user") {
          result.push({ role: "user", content: "Continue." });
        }
        result.push({ ...msg });
        lastRole = msg.role;
      }
    }

    return result;
  }

  private mapStopReason(reason: string | null): LLMCompletion["finishReason"] {
    switch (reason) {
      case "end_turn":
      case "stop_sequence":
        return "stop";
      case "max_tokens":
        return "length";
      default:
        return "stop";
    }
  }

  private createTimeoutSignal(timeout?: number): AbortSignal | undefined {
    if (!timeout) return undefined;
    return AbortSignal.timeout(timeout);
  }
}
