import { readProviderOptions, readRecord, unwrapToolInputSchema } from "veryfront/provider/shared";
import type { RuntimePromptMessage } from "veryfront/provider/shared";

export type RuntimeToolDefinition =
  | {
    type: "function";
    name: string;
    description?: string;
    inputSchema: unknown;
  }
  | {
    type: "provider";
    name: string;
    id: `${string}.${string}`;
    args: Record<string, unknown>;
  };

type ProviderReasoningEffort = "low" | "medium" | "high" | "max";

type ProviderReasoningOption = {
  enabled?: boolean;
  effort?: ProviderReasoningEffort;
  budgetTokens?: number;
};

export type OpenAICompatibleLanguageOptions = {
  prompt: RuntimePromptMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  tools?: RuntimeToolDefinition[];
  toolChoice?: unknown;
  seed?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  headers?: HeadersInit;
  providerOptions?: Record<string, unknown>;
  includeRawChunks?: boolean;
  abortSignal?: AbortSignal;
  cacheControl?: unknown;
  reasoning?: ProviderReasoningOption;
  userId?: string;
  requestLabels?: Record<string, string>;
  serviceTier?: "auto" | "default" | "flex" | "scale";
  parallelToolCalls?: boolean;
  responseFormat?:
    | { type: "text" }
    | { type: "json" }
    | {
      type: "json_schema";
      name: string;
      schema: unknown;
      description?: string;
      strict?: boolean;
    };
  anthropicContainer?: unknown;
  googleCachedContent?: string;
  googleSafetySettings?: Array<{
    category: string;
    threshold: string;
  }>;
  mcpServers?: Array<Record<string, unknown>>;
};

type WarningCollector = {
  push(warning: {
    type: "unsupported-setting" | "other";
    setting?: string;
    details?: string;
    provider: string;
  }): void;
  drain(): Array<{
    type: "unsupported-setting" | "other";
    setting?: string;
    details?: string;
    provider: string;
  }>;
};

type GoogleCompatibleContent = {
  role: "user" | "model";
  parts: Array<Record<string, unknown>>;
};

type GoogleCompatibleRequest = {
  contents: GoogleCompatibleContent[];
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
  tools?: Array<Record<string, unknown>>;
  toolConfig?: {
    functionCallingConfig: Record<string, unknown>;
  };
  generationConfig?: Record<string, unknown>;
  [key: string]: unknown;
};

function toGoogleContents(
  prompt: RuntimePromptMessage[],
): {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: GoogleCompatibleContent[];
} {
  const systemParts: string[] = [];
  const contents: GoogleCompatibleContent[] = [];

  for (const message of prompt) {
    switch (message.role) {
      case "system":
        if (message.content.length > 0) {
          systemParts.push(message.content);
        }
        break;
      case "user":
        contents.push({
          role: "user",
          parts: toGoogleUserParts(message.content),
        });
        break;
      case "assistant": {
        const parts: Array<Record<string, unknown>> = [];
        for (const part of message.content) {
          if (part.type === "text") {
            parts.push({ text: part.text });
            continue;
          }
          if (part.type === "reasoning") {
            continue;
          }
          parts.push({
            functionCall: {
              id: part.toolCallId,
              name: part.toolName,
              args: part.input,
            },
          });
        }
        contents.push({ role: "model", parts });
        break;
      }
      case "tool":
        contents.push({
          role: "user",
          parts: message.content.map((part) => ({
            functionResponse: {
              id: part.toolCallId,
              name: part.toolName,
              response: {
                result: part.output.value,
              },
            },
          })),
        });
        break;
    }
  }

  return {
    ...(systemParts.length > 0
      ? { systemInstruction: { parts: systemParts.map((text) => ({ text })) } }
      : {}),
    contents,
  };
}

function toGoogleUserParts(
  parts: Extract<RuntimePromptMessage, { role: "user" }>["content"],
): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [];

  for (const part of parts) {
    if (part.type === "text") {
      if (part.text.length > 0) {
        content.push({ text: part.text });
      }
      continue;
    }

    if (part.type === "image" || part.mediaType.startsWith("image/")) {
      content.push({
        fileData: {
          mimeType: part.mediaType,
          fileUri: part.url,
        },
      });
    }
  }

  return content;
}

function toGoogleTools(
  tools: RuntimeToolDefinition[] | undefined,
): Array<Record<string, unknown>> | undefined {
  if (!tools) {
    return undefined;
  }

  const functionDeclarations: Array<Record<string, unknown>> = [];
  const providerEntries: Array<Record<string, unknown>> = [];

  for (const tool of tools) {
    if (tool.type === "function") {
      functionDeclarations.push({
        name: tool.name,
        ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        parameters: unwrapToolInputSchema(tool.inputSchema),
      });
      continue;
    }

    if (!tool.id.startsWith("google.")) {
      continue;
    }
    const providerType = tool.id.slice("google.".length);
    if (providerType.length === 0) {
      continue;
    }
    const camelKey = providerType.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
    providerEntries.push({ [camelKey]: tool.args ?? {} });
  }

  const result: Array<Record<string, unknown>> = [];
  if (functionDeclarations.length > 0) {
    result.push({ functionDeclarations });
  }
  result.push(...providerEntries);
  return result.length > 0 ? result : undefined;
}

function normalizeGoogleToolChoice(toolChoice: unknown):
  | GoogleCompatibleRequest["toolConfig"]
  | undefined {
  if (toolChoice === undefined) {
    return undefined;
  }

  if (typeof toolChoice === "string") {
    switch (toolChoice) {
      case "none":
        return { functionCallingConfig: { mode: "NONE" } };
      case "any":
      case "required":
        return { functionCallingConfig: { mode: "ANY" } };
      default:
        return { functionCallingConfig: { mode: "AUTO" } };
    }
  }

  const record = readRecord(toolChoice);
  if (!record) return undefined;

  if (record.type === "tool" && typeof record.name === "string") {
    return {
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: [record.name],
      },
    };
  }

  if (record.type === "tools" && Array.isArray(record.names)) {
    const names = record.names.filter((n): n is string => typeof n === "string");
    if (names.length > 0) {
      return {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: names,
        },
      };
    }
  }

  if (record.type === "auto") {
    return { functionCallingConfig: { mode: "AUTO" } };
  }
  if (record.type === "none") {
    return { functionCallingConfig: { mode: "NONE" } };
  }
  if (record.type === "any" || record.type === "required") {
    return { functionCallingConfig: { mode: "ANY" } };
  }

  return undefined;
}

function resolveGoogleThinkingConfig(
  option: ProviderReasoningOption | undefined,
): Record<string, unknown> | undefined {
  if (!option || option.enabled !== true) {
    return undefined;
  }
  const config: Record<string, unknown> = { includeThoughts: true };
  if (typeof option.budgetTokens === "number") {
    config.thinkingBudget = option.budgetTokens;
    return config;
  }
  switch (option.effort) {
    case "low":
      config.thinkingBudget = 512;
      break;
    case "high":
      config.thinkingBudget = 8192;
      break;
    case "max":
      config.thinkingBudget = -1;
      break;
    case "medium":
    default:
      config.thinkingBudget = 2048;
      break;
  }
  return config;
}

function buildGoogleGenerationConfig(
  options: OpenAICompatibleLanguageOptions,
): Record<string, unknown> | undefined {
  const thinkingConfig = resolveGoogleThinkingConfig(options.reasoning);
  const config: Record<string, unknown> = {
    ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.topP !== undefined ? { topP: options.topP } : {}),
    ...(options.topK !== undefined ? { topK: options.topK } : {}),
    ...(options.stopSequences && options.stopSequences.length > 0
      ? { stopSequences: options.stopSequences }
      : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    ...(thinkingConfig ? { thinkingConfig } : {}),
  };

  return Object.keys(config).length > 0 ? config : undefined;
}

export function buildGoogleGenerateContentRequest(
  providerName: string,
  options: OpenAICompatibleLanguageOptions,
  warnings: WarningCollector,
): GoogleCompatibleRequest {
  if (options.presencePenalty !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "google",
      setting: "presencePenalty",
      details: "Gemini generateContent does not accept presencePenalty; the value was dropped.",
    });
  }
  if (options.frequencyPenalty !== undefined) {
    warnings.push({
      type: "unsupported-setting",
      provider: "google",
      setting: "frequencyPenalty",
      details: "Gemini generateContent does not accept frequencyPenalty; the value was dropped.",
    });
  }
  if (options.responseFormat && options.responseFormat.type !== "text") {
    warnings.push({
      type: "unsupported-setting",
      provider: "google",
      setting: "responseFormat",
      details:
        "Gemini uses generationConfig.responseMimeType + responseSchema for structured outputs, which is a separate surface and not yet wired through this option.",
    });
  }

  const { systemInstruction, contents } = toGoogleContents(options.prompt);
  const generationConfig = buildGoogleGenerationConfig(options);
  const labels = options.requestLabels && Object.keys(options.requestLabels).length > 0
    ? options.requestLabels
    : typeof options.userId === "string" && options.userId.length > 0
    ? { user_id: options.userId }
    : undefined;
  const body: GoogleCompatibleRequest = {
    contents,
    ...(systemInstruction ? { systemInstruction } : {}),
    ...(toGoogleTools(options.tools) ? { tools: toGoogleTools(options.tools) } : {}),
    ...(normalizeGoogleToolChoice(options.toolChoice)
      ? { toolConfig: normalizeGoogleToolChoice(options.toolChoice) }
      : {}),
    ...(generationConfig ? { generationConfig } : {}),
    ...(labels ? { labels } : {}),
    ...(typeof options.googleCachedContent === "string" && options.googleCachedContent.length > 0
      ? { cachedContent: options.googleCachedContent }
      : {}),
    ...(options.googleSafetySettings && options.googleSafetySettings.length > 0
      ? { safetySettings: options.googleSafetySettings }
      : {}),
  };

  Object.assign(body, readProviderOptions(options.providerOptions, "google", providerName));
  return body;
}
