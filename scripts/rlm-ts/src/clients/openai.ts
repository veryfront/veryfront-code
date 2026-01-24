/**
 * OpenAI Client
 *
 * Works with OpenAI and OpenAI-compatible APIs (OpenRouter, Groq, Together, etc.)
 */

import type {
  ClientBackend,
  ConversationMessage,
  LLMClientConfig,
  LLMCompletion,
} from "../types.ts";
import { BaseLLMClient } from "./base.ts";

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
  name?: string;
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
}

const BACKEND_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  together: "https://api.together.xyz/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
};

export class OpenAIClient extends BaseLLMClient {
  readonly backend: ClientBackend;
  private baseUrl: string;

  constructor(config: LLMClientConfig, backend: ClientBackend = "openai") {
    super(config);
    this.backend = backend;
    this.baseUrl = config.baseUrl ?? BACKEND_BASE_URLS[backend] ?? BACKEND_BASE_URLS.openai;
  }

  async complete(
    messages: ConversationMessage[],
    options?: Partial<LLMClientConfig>
  ): Promise<LLMCompletion> {
    const config = this.mergeConfig(options);
    const startTime = Date.now();

    const response = await this.withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.buildHeaders(config),
        body: JSON.stringify(this.buildRequestBody(messages, config, false)),
        signal: this.createTimeoutSignal(config.timeout),
      });

      if (!res.ok) {
        const error = await res.text();
        throw new Error(`OpenAI API error (${res.status}): ${error}`);
      }

      return res.json() as Promise<OpenAIResponse>;
    });

    const latencyMs = Date.now() - startTime;
    const choice = response.choices[0];

    return {
      content: choice?.message?.content ?? "",
      finishReason: this.mapFinishReason(choice?.finish_reason),
      tokens: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
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

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(config),
      body: JSON.stringify(this.buildRequestBody(messages, config, true)),
      signal: this.createTimeoutSignal(config.timeout),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${error}`);
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
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (!trimmed.startsWith("data: ")) continue;

          try {
            const json = JSON.parse(trimmed.slice(6)) as OpenAIStreamChunk;
            const content = json.choices[0]?.delta?.content;
            if (content) {
              yield content;
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
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    if (config.organization) {
      headers["OpenAI-Organization"] = config.organization;
    }

    // OpenRouter specific headers
    if (this.backend === "openrouter") {
      headers["HTTP-Referer"] = "https://veryfront.com";
      headers["X-Title"] = "Veryfront RLM";
    }

    return headers;
  }

  private buildRequestBody(
    messages: ConversationMessage[],
    config: LLMClientConfig,
    stream: boolean
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: config.model,
      messages: messages.map(this.convertMessage),
      stream,
    };

    if (config.temperature !== undefined) {
      body.temperature = config.temperature;
    }
    if (config.maxTokens !== undefined) {
      body.max_completion_tokens = config.maxTokens;
    }
    if (config.topP !== undefined) {
      body.top_p = config.topP;
    }
    if (config.frequencyPenalty !== undefined) {
      body.frequency_penalty = config.frequencyPenalty;
    }
    if (config.presencePenalty !== undefined) {
      body.presence_penalty = config.presencePenalty;
    }
    if (config.stopSequences?.length) {
      body.stop = config.stopSequences;
    }

    return body;
  }

  private convertMessage(msg: ConversationMessage): OpenAIMessage {
    const converted: OpenAIMessage = {
      role: msg.role === "tool" ? "assistant" : msg.role,
      content: msg.content,
    };
    if (msg.name) {
      converted.name = msg.name;
    }
    return converted;
  }

  private mapFinishReason(
    reason?: string
  ): LLMCompletion["finishReason"] {
    switch (reason) {
      case "stop":
        return "stop";
      case "length":
        return "length";
      case "tool_calls":
      case "function_call":
        return "tool_calls";
      case "content_filter":
        return "content_filter";
      default:
        return "stop";
    }
  }

  private createTimeoutSignal(timeout?: number): AbortSignal | undefined {
    if (!timeout) return undefined;
    return AbortSignal.timeout(timeout);
  }
}
