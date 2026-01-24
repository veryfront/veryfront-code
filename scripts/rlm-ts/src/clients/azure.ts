/**
 * Azure OpenAI Client
 *
 * Client for Azure-hosted OpenAI models
 */

import type {
  ClientBackend,
  ConversationMessage,
  LLMClientConfig,
  LLMCompletion,
} from "../types.ts";
import { BaseLLMClient } from "./base.ts";

interface AzureMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface AzureResponse {
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

interface AzureStreamChunk {
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

export interface AzureOpenAIConfig extends LLMClientConfig {
  /** Azure resource name */
  resourceName: string;
  /** Azure deployment name */
  deploymentName: string;
  /** API version (default: 2024-02-15-preview) */
  apiVersion?: string;
}

export class AzureOpenAIClient extends BaseLLMClient {
  readonly backend: ClientBackend = "azure_openai";
  private resourceName: string;
  private deploymentName: string;
  private apiVersion: string;

  constructor(config: AzureOpenAIConfig) {
    super(config);

    if (!config.resourceName) {
      throw new Error("Azure OpenAI requires resourceName");
    }
    if (!config.deploymentName) {
      throw new Error("Azure OpenAI requires deploymentName");
    }

    this.resourceName = config.resourceName;
    this.deploymentName = config.deploymentName;
    this.apiVersion = config.apiVersion ?? "2024-02-15-preview";
  }

  private get baseUrl(): string {
    return `https://${this.resourceName}.openai.azure.com/openai/deployments/${this.deploymentName}`;
  }

  async complete(
    messages: ConversationMessage[],
    options?: Partial<LLMClientConfig>
  ): Promise<LLMCompletion> {
    const config = this.mergeConfig(options);
    const startTime = Date.now();

    const response = await this.withRetry(async () => {
      const url = `${this.baseUrl}/chat/completions?api-version=${this.apiVersion}`;

      const res = await fetch(url, {
        method: "POST",
        headers: this.buildHeaders(config),
        body: JSON.stringify(this.buildRequestBody(messages, config, false)),
      });

      if (!res.ok) {
        const error = await res.text();
        throw new Error(`Azure OpenAI API error (${res.status}): ${error}`);
      }

      return res.json() as Promise<AzureResponse>;
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
    const url = `${this.baseUrl}/chat/completions?api-version=${this.apiVersion}`;

    const response = await fetch(url, {
      method: "POST",
      headers: this.buildHeaders(config),
      body: JSON.stringify(this.buildRequestBody(messages, config, true)),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Azure OpenAI API error (${response.status}): ${error}`);
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
            const json = JSON.parse(trimmed.slice(6)) as AzureStreamChunk;
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
    return {
      "Content-Type": "application/json",
      "api-key": config.apiKey ?? "",
    };
  }

  private buildRequestBody(
    messages: ConversationMessage[],
    config: LLMClientConfig,
    stream: boolean
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
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

  private convertMessage(msg: ConversationMessage): AzureMessage {
    return {
      role: msg.role === "tool" ? "assistant" : msg.role,
      content: msg.content,
    };
  }

  private mapFinishReason(reason?: string): LLMCompletion["finishReason"] {
    switch (reason) {
      case "stop":
        return "stop";
      case "length":
        return "length";
      case "content_filter":
        return "content_filter";
      default:
        return "stop";
    }
  }
}
