import { estimateTokens } from "../../chat/message-prep.ts";
import {
  resolveModel,
  resolveVeryfrontCloudGatewayModelId,
  resolveVeryfrontCloudModelId,
  runWithVeryfrontCloudContextAsync,
} from "../../provider/index.ts";
import { generateText } from "../../runtime/runtime-bridge.ts";
import { redactSensitive, sanitizeUrlCredentials } from "#veryfront/utils/logger/redact.ts";
import type { TextGenerationRuntimeMessage } from "../runtime/text-generation-runtime-message-types.ts";
import type { AgentRuntimeMessage, AgentRuntimeMessagePart } from "../runtime/message-adapter.ts";
import type { ContextSummaryGenerator } from "./context-budget-manager.ts";

const DEFAULT_MAX_SERIALIZED_PART_CHARACTERS = 20_000;
const DEFAULT_MAX_SERIALIZED_MESSAGE_CHARACTERS = 60_000;

type GenerateTextFunction = typeof generateText;
type ResolveModelFunction = typeof resolveModel;

/** Options accepted by Veryfront Cloud context summary generator. */
export type VeryfrontCloudContextSummaryGeneratorOptions = {
  apiUrl: string | URL;
  authToken: string;
  projectSlug?: string | null;
  model?: string;
  maxOutputTokens: number;
  maxInputTokens: number;
  abortSignal?: AbortSignal;
  generateText?: GenerateTextFunction;
  resolveModel?: ResolveModelFunction;
};

function truncateText(text: string, maxCharacters: number): string {
  if (text.length <= maxCharacters) {
    return text;
  }

  return `${text.slice(0, maxCharacters)}\n[truncated ${text.length - maxCharacters} characters]`;
}

function stringifyUnknown(value: unknown): string {
  try {
    return JSON.stringify(
      redactSensitive(value),
      (_key, candidate) =>
        typeof candidate === "string" ? sanitizeUrlCredentials(candidate) : candidate,
    );
  } catch {
    return "[unserializable]";
  }
}

function serializeMessagePart(part: AgentRuntimeMessagePart): string {
  if (part.type === "text" && "text" in part) {
    return truncateText(part.text, DEFAULT_MAX_SERIALIZED_PART_CHARACTERS);
  }

  if (part.type === "tool-result" && "result" in part) {
    return [
      `tool result: ${part.toolName}`,
      `tool call id: ${part.toolCallId}`,
      truncateText(stringifyUnknown(part.result), DEFAULT_MAX_SERIALIZED_PART_CHARACTERS),
    ].join("\n");
  }

  if ((part.type === "image" || part.type === "file") && "mediaType" in part) {
    return `${part.type}: ${part.mediaType}`;
  }

  if ("toolCallId" in part && "toolName" in part && "args" in part) {
    return [
      `tool call: ${part.toolName}`,
      `tool call id: ${part.toolCallId}`,
      truncateText(stringifyUnknown(part.args), DEFAULT_MAX_SERIALIZED_PART_CHARACTERS),
    ].join("\n");
  }

  return truncateText(stringifyUnknown(part), DEFAULT_MAX_SERIALIZED_PART_CHARACTERS);
}

function serializeMessage(message: AgentRuntimeMessage): string {
  const body = message.parts.map(serializeMessagePart).join("\n\n");
  const serialized = [
    `<message id="${message.id}" role="${message.role}">`,
    body,
    "</message>",
  ].join("\n");

  return truncateText(serialized, DEFAULT_MAX_SERIALIZED_MESSAGE_CHARACTERS);
}

function chunkSerializedMessages(
  messages: readonly AgentRuntimeMessage[],
  maxInputTokens: number,
): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const message of messages) {
    const serialized = serializeMessage(message);
    const candidate = current ? `${current}\n\n${serialized}` : serialized;

    if (current && estimateTokens(candidate) > maxInputTokens) {
      chunks.push(current);
      current = serialized;
      continue;
    }

    current = candidate;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function createCompactionMessages(input: {
  segment: string;
  priorSummary?: string;
  retainedMessageCount: number;
  customInstructions?: string;
}): TextGenerationRuntimeMessage[] {
  const customInstructions = input.customInstructions
    ? `\nAdditional compaction instructions:\n${input.customInstructions}`
    : "";
  const priorSummary = input.priorSummary
    ? `\nExisting summary to update:\n${input.priorSummary}\n`
    : "";

  return [
    {
      role: "system",
      content: [
        "Summarize previous context for a continued Veryfront agent run.",
        "Output only the summary.",
        "Preserve user goals, constraints, completed work, in-progress work, decisions, file or project state, tool evidence, and next actions.",
        "Do not continue the conversation.",
        "Do not include private credentials or raw internal metadata.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        priorSummary,
        `Recent messages retained separately: ${input.retainedMessageCount}`,
        customInstructions,
        "\nConversation segment to summarize:",
        input.segment,
      ].join("\n"),
    },
  ];
}

async function summarizeSegment(input: {
  options: VeryfrontCloudContextSummaryGeneratorOptions;
  modelId: string;
  segment: string;
  priorSummary?: string;
  retainedMessageCount: number;
  customInstructions?: string;
}): Promise<string> {
  const generate = input.options.generateText ?? generateText;
  const resolve = input.options.resolveModel ?? resolveModel;
  const result = await runWithVeryfrontCloudContextAsync(
    {
      apiBaseUrl: input.options.apiUrl.toString(),
      apiToken: input.options.authToken,
      projectSlug: input.options.projectSlug ?? undefined,
      serviceLayer: "cloud",
    },
    () =>
      Promise.resolve(generate({
        model: resolve(input.modelId),
        messages: createCompactionMessages({
          segment: input.segment,
          priorSummary: input.priorSummary,
          retainedMessageCount: input.retainedMessageCount,
          customInstructions: input.customInstructions,
        }),
        maxOutputTokens: input.options.maxOutputTokens,
        temperature: 0,
        abortSignal: input.options.abortSignal,
      })),
  );

  return result.text.trim();
}

function resolveSummaryModelId(model: string | undefined): string {
  const cloudModelId = resolveVeryfrontCloudModelId(model);
  return resolveVeryfrontCloudGatewayModelId(cloudModelId) ?? cloudModelId;
}

/** Create a Veryfront Cloud backed summary generator for context compaction. */
export function createVeryfrontCloudContextSummaryGenerator(
  options: VeryfrontCloudContextSummaryGeneratorOptions,
): ContextSummaryGenerator {
  return async ({ messagesToSummarize, retainedMessages, customInstructions }) => {
    const modelId = resolveSummaryModelId(options.model);
    const chunks = chunkSerializedMessages(messagesToSummarize, options.maxInputTokens);
    let summary = "";

    for (const chunk of chunks) {
      summary = await summarizeSegment({
        options,
        modelId,
        segment: chunk,
        priorSummary: summary || undefined,
        retainedMessageCount: retainedMessages.length,
        customInstructions,
      });
    }

    return { text: summary };
  };
}
