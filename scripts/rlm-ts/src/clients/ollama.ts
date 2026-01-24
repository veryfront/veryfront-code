/**
 * Ollama Client
 *
 * Client for local LLM inference via Ollama
 */

import type {
  ClientBackend,
  ConversationMessage,
  LLMClientConfig,
  LLMCompletion,
} from "../types.ts";
import { BaseLLMClient } from "./base.ts";

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: true;
  done_reason: string;
  total_duration: number;
  load_duration: number;
  prompt_eval_count: number;
  prompt_eval_duration: number;
  eval_count: number;
  eval_duration: number;
}

interface OllamaStreamChunk {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaClient extends BaseLLMClient {
  readonly backend: ClientBackend = "ollama";
  private baseUrl: string;

  constructor(config: LLMClientConfig) {
    super(config);
    this.baseUrl = config.baseUrl ?? "http://localhost:11434";
  }

  async complete(
    messages: ConversationMessage[],
    options?: Partial<LLMClientConfig>
  ): Promise<LLMCompletion> {
    const config = this.mergeConfig(options);
    const startTime = Date.now();

    const response = await this.withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(this.buildRequestBody(messages, config, false)),
      });

      if (!res.ok) {
        const error = await res.text();
        throw new Error(`Ollama API error (${res.status}): ${error}`);
      }

      return res.json() as Promise<OllamaResponse>;
    });

    const latencyMs = Date.now() - startTime;

    // Ollama reports eval_count as output tokens and prompt_eval_count as input
    return {
      content: response.message?.content ?? "",
      finishReason: this.mapDoneReason(response.done_reason),
      tokens: {
        inputTokens: response.prompt_eval_count ?? 0,
        outputTokens: response.eval_count ?? 0,
        totalTokens: (response.prompt_eval_count ?? 0) + (response.eval_count ?? 0),
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

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(this.buildRequestBody(messages, config, true)),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${error}`);
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
          if (!trimmed) continue;

          try {
            const json = JSON.parse(trimmed) as OllamaStreamChunk;
            if (json.message?.content) {
              yield json.message.content;
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

  private buildRequestBody(
    messages: ConversationMessage[],
    config: LLMClientConfig,
    stream: boolean
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: config.model ?? "llama3.2",
      messages: messages.map(this.convertMessage),
      stream,
    };

    // Ollama options
    const options: Record<string, unknown> = {};

    if (config.temperature !== undefined) {
      options.temperature = config.temperature;
    }
    if (config.maxTokens !== undefined) {
      options.num_predict = config.maxTokens;
    }
    if (config.topP !== undefined) {
      options.top_p = config.topP;
    }
    if (config.stopSequences?.length) {
      options.stop = config.stopSequences;
    }

    if (Object.keys(options).length > 0) {
      body.options = options;
    }

    return body;
  }

  private convertMessage(msg: ConversationMessage): OllamaMessage {
    return {
      role: msg.role === "tool" ? "assistant" : msg.role,
      content: msg.content,
    };
  }

  private mapDoneReason(reason?: string): LLMCompletion["finishReason"] {
    switch (reason) {
      case "stop":
        return "stop";
      case "length":
        return "length";
      default:
        return "stop";
    }
  }
}
