import { estimateTokens } from "../../chat/message-prep.ts";
import {
  resolveModel,
  resolveVeryfrontCloudGatewayModelId,
  resolveVeryfrontCloudModelId,
} from "../../provider/index.ts";
import {
  runWithVeryfrontCloudContext,
  runWithVeryfrontCloudContextAsync,
  type VeryfrontCloudContext,
} from "#veryfront/provider/veryfront-cloud/context.ts";
import { loadVeryfrontCloudModelCatalog } from "#veryfront/provider/veryfront-cloud/shared.ts";
import { readVeryfrontCloudModelFacts } from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import type { ModelRuntime } from "#veryfront/provider/types.ts";
import { generateText } from "../../runtime/runtime-bridge.ts";
import { redactSensitive, sanitizeUrlCredentials } from "#veryfront/utils";
import type { TextGenerationRuntimeMessage } from "../runtime/text-generation-runtime-message-types.ts";
import type { AgentRuntimeMessage, AgentRuntimeMessagePart } from "../runtime/message-adapter.ts";
import type { ContextSummaryGenerator } from "./context-budget-manager.ts";
import {
  type AgentModelRuntimeResolver,
  createModelRuntimeResolverAbortScope,
} from "../runtime/model-transport.ts";

const DEFAULT_MAX_SERIALIZED_PART_CHARACTERS = 20_000;
const DEFAULT_MAX_SERIALIZED_MESSAGE_CHARACTERS = 60_000;

type GenerateTextFunction = typeof generateText;
type ResolveModelFunction = typeof resolveModel;

/** Options accepted by Veryfront Cloud context summary generator. */
export type VeryfrontCloudContextSummaryGeneratorOptions = {
  apiUrl: string | URL;
  authToken?: string;
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
  cloudContext: VeryfrontCloudContext;
  modelId: string;
  segment: string;
  priorSummary?: string;
  retainedMessageCount: number;
  customInstructions?: string;
}): Promise<string> {
  const generate = input.options.generateText ?? generateText;
  const resolve = input.options.resolveModel ?? resolveModel;
  const result = await runWithVeryfrontCloudContextAsync(
    input.cloudContext,
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

function summaryCloudContext(
  options: VeryfrontCloudContextSummaryGeneratorOptions,
): VeryfrontCloudContext {
  return {
    apiBaseUrl: options.apiUrl.toString(),
    apiToken: options.authToken,
    projectSlug: options.projectSlug ?? undefined,
    serviceLayer: "cloud",
  };
}

/** Longest summary generation waits for the served catalog before resolving its model. */
const CATALOG_MAX_WAIT_MS = 3_000;

function resolveSummaryModelId(model: string | undefined): string {
  const cloudModelId = resolveVeryfrontCloudModelId(model);
  return resolveVeryfrontCloudGatewayModelId(cloudModelId) ?? cloudModelId;
}

/** Create a Veryfront Cloud backed summary generator for context compaction. */
export function createVeryfrontCloudContextSummaryGenerator(
  options: VeryfrontCloudContextSummaryGeneratorOptions,
): ContextSummaryGenerator {
  return (input) => generateSummary(options, input);
}

async function generateSummary(
  options: VeryfrontCloudContextSummaryGeneratorOptions,
  { messagesToSummarize, retainedMessages, customInstructions }: Parameters<
    ContextSummaryGenerator
  >[0],
  loadRunScopedCatalog?: () => Promise<string | undefined>,
): Promise<{ text: string }> {
  // The model resolves against the served catalog loaded for the same
  // credentials and project the summary calls use.
  let cloudContext = summaryCloudContext(options);
  if (loadRunScopedCatalog) {
    // The run-scoped credential stays inside the model resolver; the context
    // names its catalog by a key that holds no credential.
    const catalogScopeKey = await loadRunScopedCatalog();
    if (catalogScopeKey) cloudContext = { ...cloudContext, catalogScopeKey };
  } else {
    await runWithVeryfrontCloudContextAsync(
      cloudContext,
      () => loadVeryfrontCloudModelCatalog({ maxWaitMs: CATALOG_MAX_WAIT_MS }),
    );
  }
  const modelId = runWithVeryfrontCloudContext(
    cloudContext,
    () => resolveSummaryModelId(options.model),
  );
  const chunks = chunkSerializedMessages(messagesToSummarize, options.maxInputTokens);
  let summary = "";

  for (const chunk of chunks) {
    summary = await summarizeSegment({
      options,
      cloudContext,
      modelId,
      segment: chunk,
      priorSummary: summary || undefined,
      retainedMessageCount: retainedMessages.length,
      customInstructions,
    });
  }

  return { text: summary };
}

/**
 * Load the served catalog for a run-scoped credential through a model its
 * resolver builds, and return the non-secret key naming it. The probe model is
 * only prepared, never called. Undefined when nothing could be loaded.
 */
async function loadResolverCatalogScopeKey(
  resolveModel: (modelId: string) => ModelRuntime,
  model: string | undefined,
  context: VeryfrontCloudContext,
  signal: AbortSignal,
): Promise<string | undefined> {
  try {
    const probeId = runWithVeryfrontCloudContext(context, () => {
      try {
        return resolveSummaryModelId(model);
      } catch {
        // An alias only the served catalog knows: any model of the same
        // credential names the same catalog.
        return resolveSummaryModelId(undefined);
      }
    });
    const probe = resolveModel(probeId);
    const wait = new AbortController();
    const timer = setTimeout(() => wait.abort(), CATALOG_MAX_WAIT_MS);
    try {
      await probe.prepare?.(AbortSignal.any([signal, wait.signal]));
    } finally {
      clearTimeout(timer);
    }
    return readVeryfrontCloudModelFacts(probe)?.catalogScopeKey;
  } catch {
    return undefined;
  }
}

/** @internal Bind context-compaction inference authority to one generator invocation. */
export function createRunScopedVeryfrontCloudContextSummaryGenerator(
  options: Omit<VeryfrontCloudContextSummaryGeneratorOptions, "resolveModel">,
  createModelResolver: () => AgentModelRuntimeResolver | undefined,
): ContextSummaryGenerator {
  const { authToken, abortSignal, ...baseOptions } = options;
  let used = false;
  return async (input) => {
    if (used) {
      throw new TypeError("Context compaction inference authority has already been used");
    }
    used = true;

    const resolveModelRuntime = createModelResolver();
    const abortScope = createModelRuntimeResolverAbortScope(
      resolveModelRuntime,
      abortSignal,
    );
    try {
      // The model the catalog probe prepared is the one the summary calls.
      const resolved = new Map<string, ModelRuntime>();
      const resolveModel = (modelId: string) => {
        const model = resolved.get(modelId) ?? resolveModelRuntime?.(modelId);
        if (!model) {
          throw new TypeError(
            `Context compaction requires a Veryfront Cloud model, received "${modelId}"`,
          );
        }
        resolved.set(modelId, model);
        return model;
      };
      const summaryOptions: VeryfrontCloudContextSummaryGeneratorOptions = {
        ...baseOptions,
        abortSignal: abortScope.signal,
        ...(resolveModelRuntime ? { resolveModel } : { authToken }),
      };
      return await generateSummary(
        summaryOptions,
        input,
        resolveModelRuntime
          ? () =>
            loadResolverCatalogScopeKey(
              resolveModel,
              summaryOptions.model,
              summaryCloudContext(summaryOptions),
              abortScope.signal,
            )
          : undefined,
      );
    } finally {
      abortScope.dispose();
    }
  };
}
