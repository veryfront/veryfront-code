/**
 * Google Gemini Client
 *
 * Client for Gemini models via Google AI API
 */

import type {
  ClientBackend,
  ConversationMessage,
  LLMClientConfig,
  LLMCompletion,
} from "../types.ts";
import { BaseLLMClient } from "./base.ts";

interface GeminiContent {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
      role: string;
    };
    finishReason: string;
    safetyRatings?: Array<{
      category: string;
      probability: string;
    }>;
  }>;
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

interface GeminiStreamChunk {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
}

export class GeminiClient extends BaseLLMClient {
  readonly backend: ClientBackend = "gemini";
  private baseUrl: string;

  constructor(config: LLMClientConfig) {
    super(config);
    this.baseUrl = config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
  }

  async complete(
    messages: ConversationMessage[],
    options?: Partial<LLMClientConfig>
  ): Promise<LLMCompletion> {
    const config = this.mergeConfig(options);
    const startTime = Date.now();

    const { systemInstruction, contents } = this.convertMessages(messages);
    const modelName = config.model ?? "gemini-1.5-pro";

    const response = await this.withRetry(async () => {
      const url = `${this.baseUrl}/models/${modelName}:generateContent?key=${config.apiKey}`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(this.buildRequestBody(systemInstruction, contents, config)),
      });

      if (!res.ok) {
        const error = await res.text();
        throw new Error(`Gemini API error (${res.status}): ${error}`);
      }

      return res.json() as Promise<GeminiResponse>;
    });

    const latencyMs = Date.now() - startTime;
    const candidate = response.candidates?.[0];
    const content = candidate?.content?.parts
      ?.map((p) => p.text)
      .join("") ?? "";

    return {
      content,
      finishReason: this.mapFinishReason(candidate?.finishReason),
      tokens: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: response.usageMetadata?.totalTokenCount ?? 0,
      },
      latencyMs,
      model: modelName,
    };
  }

  async *stream(
    messages: ConversationMessage[],
    options?: Partial<LLMClientConfig>
  ): AsyncIterable<string> {
    const config = this.mergeConfig(options);
    const { systemInstruction, contents } = this.convertMessages(messages);
    const modelName = config.model ?? "gemini-1.5-pro";

    const url = `${this.baseUrl}/models/${modelName}:streamGenerateContent?alt=sse&key=${config.apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(this.buildRequestBody(systemInstruction, contents, config)),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${error}`);
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
            const json = JSON.parse(trimmed.slice(6)) as GeminiStreamChunk;
            const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              yield text;
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
    systemInstruction: string | undefined,
    contents: GeminiContent[],
    config: LLMClientConfig
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {},
    };

    if (systemInstruction) {
      body.systemInstruction = {
        parts: [{ text: systemInstruction }],
      };
    }

    const generationConfig: Record<string, unknown> = {};

    if (config.temperature !== undefined) {
      generationConfig.temperature = config.temperature;
    }
    if (config.maxTokens !== undefined) {
      generationConfig.maxOutputTokens = config.maxTokens;
    }
    if (config.topP !== undefined) {
      generationConfig.topP = config.topP;
    }
    if (config.stopSequences?.length) {
      generationConfig.stopSequences = config.stopSequences;
    }

    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }

    return body;
  }

  private convertMessages(messages: ConversationMessage[]): {
    systemInstruction: string | undefined;
    contents: GeminiContent[];
  } {
    let systemInstruction: string | undefined;
    const contents: GeminiContent[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemInstruction = (systemInstruction ?? "") + msg.content + "\n";
      } else {
        contents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        });
      }
    }

    // Ensure conversation starts with user
    if (contents.length > 0 && contents[0].role !== "user") {
      contents.unshift({
        role: "user",
        parts: [{ text: "Continue." }],
      });
    }

    return {
      systemInstruction: systemInstruction?.trim(),
      contents,
    };
  }

  private mapFinishReason(reason?: string): LLMCompletion["finishReason"] {
    switch (reason) {
      case "STOP":
        return "stop";
      case "MAX_TOKENS":
        return "length";
      case "SAFETY":
      case "RECITATION":
        return "content_filter";
      default:
        return "stop";
    }
  }
}
