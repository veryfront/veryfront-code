import {
  estimateMessageTokenBreakdown,
  estimateTokens,
  type MessageTokenBreakdown,
} from "../../chat/message-prep.ts";
import { defineSchema } from "../../schemas/index.ts";
import type { Schema } from "../../extensions/schema/index.ts";
import type { AgentRuntimeMessage } from "../runtime/message-adapter.ts";

/** Durable event type emitted when runtime context is compacted. */
export const AGENT_RUN_CONTEXT_COMPACTED_EVENT_TYPE = "AGENT_RUN_CONTEXT_COMPACTED" as const;

/** Reason a runtime compacted conversation context. */
export type ContextCompactionReason = "context_window" | "transport_body";

/** Model-generated summary used to replace compacted context. */
export interface ContextCompactionSummary {
  /** Summary text inserted into the retained context. */
  text: string;
}

/** Durable payload describing one context compaction. */
export interface ContextCompactionEventPayload {
  /** Additional event fields accepted by durable run transport. */
  [key: string]: unknown;
  /** Event discriminator. */
  type: typeof AGENT_RUN_CONTEXT_COMPACTED_EVENT_TYPE;
  /** Summary inserted in place of compacted messages. */
  summary: ContextCompactionSummary;
  /** First retained conversation entry. */
  firstKeptEntryId: string;
  /** Estimated token count before compaction. */
  tokensBefore: number;
  /** Estimated token count after compaction. */
  tokensAfter: number;
  /** Total configured token budget. */
  tokenBudget: number;
  /** Tokens reserved for model output and runtime overhead. */
  reserveTokens: number;
  /** Reason compaction was required. */
  reason: ContextCompactionReason;
}

/** Returns the context compaction summary schema. */
export const getContextCompactionSummarySchema: () => Schema<ContextCompactionSummary> =
  defineSchema((v) =>
    v.object({
      text: v.string().min(1),
    })
  );

/** Returns the context compaction event payload schema. */
export const getContextCompactionEventPayloadSchema: () => Schema<ContextCompactionEventPayload> =
  defineSchema((v) =>
    v.object({
      type: v.literal(AGENT_RUN_CONTEXT_COMPACTED_EVENT_TYPE),
      summary: getContextCompactionSummarySchema(),
      firstKeptEntryId: v.string().min(1),
      tokensBefore: v.number().int().nonnegative(),
      tokensAfter: v.number().int().nonnegative(),
      tokenBudget: v.number().int().positive(),
      reserveTokens: v.number().int().nonnegative(),
      reason: v.enum(["context_window", "transport_body"] as const),
    }).superRefine((event, ctx) => {
      const usableBudget = event.tokenBudget - event.reserveTokens;
      if (usableBudget <= 0) {
        ctx.addIssue({
          code: "custom",
          message: "reserveTokens must be lower than tokenBudget",
          path: ["reserveTokens"],
        });
      }
      if (event.tokensAfter > usableBudget) {
        ctx.addIssue({
          code: "custom",
          message: "tokensAfter must fit within the usable token budget",
          path: ["tokensAfter"],
        });
      }
      if (event.tokensAfter > event.tokensBefore) {
        ctx.addIssue({
          code: "custom",
          message: "tokensAfter cannot exceed tokensBefore",
          path: ["tokensAfter"],
        });
      }
    })
  );

/** Produces a bounded summary for messages selected for compaction. */
export type ContextSummaryGenerator = (input: {
  /** Messages selected for replacement by a summary. */
  messagesToSummarize: AgentRuntimeMessage[];
  /** Recent messages retained verbatim. */
  retainedMessages: AgentRuntimeMessage[];
  /** Optional application-specific summary instructions. */
  customInstructions?: string;
}) => Promise<ContextCompactionSummary> | ContextCompactionSummary;

/** Token budgets and hooks used by context compaction. */
export type ContextBudgetManagerOptions = {
  /** Maximum estimated tokens available for conversation context. */
  tokenBudget: number;
  /** Tokens reserved for output and runtime overhead. */
  reserveTokens: number;
  /** Recent tail token target retained verbatim. */
  recentTailTokens: number;
  /** Minimum number of recent turns retained verbatim. */
  minimumRecentTurns?: number;
  /** Maximum tokens requested from the summary generator. */
  maxSummaryTokens?: number;
  /** Optional application-specific summary instructions. */
  customInstructions?: string;
  /** Reason recorded when compaction occurs. */
  reason?: ContextCompactionReason;
  /** Clock used to timestamp generated summary messages. */
  now?: () => number;
  /** Generates the replacement summary. */
  summaryGenerator: ContextSummaryGenerator;
};

/** Measurements produced while enforcing a context budget. */
export type ContextBudgetDiagnostics = {
  /** Whether any messages were compacted. */
  compacted: boolean;
  /** Estimated tokens before compaction. */
  tokensBefore: number;
  /** Estimated tokens after compaction. */
  tokensAfter: number;
  /** Token breakdown before compaction. */
  beforeBreakdown: MessageTokenBreakdown;
  /** Token breakdown after compaction. */
  afterBreakdown: MessageTokenBreakdown;
  /** Configured total token budget. */
  tokenBudget: number;
  /** Configured token reserve. */
  reserveTokens: number;
  /** Estimated tokens in the generated summary. */
  summaryTokens: number;
  /** Estimated tokens retained in the recent tail. */
  retainedTailTokens: number;
  /** Reason recorded for compaction. */
  reason: ContextCompactionReason;
};

export type ContextBudgetManagerResult = {
  messages: AgentRuntimeMessage[];
  eventPayload?: ContextCompactionEventPayload;
  diagnostics: ContextBudgetDiagnostics;
};

export class ContextCompactionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ContextCompactionError";
  }
}

function getUsableTokenBudget(
  options: Pick<ContextBudgetManagerOptions, "tokenBudget" | "reserveTokens">,
): number {
  return options.tokenBudget - options.reserveTokens;
}

function getMessageTokens(message: AgentRuntimeMessage): number {
  return estimateTokens(message);
}

function getMessageListTokens(messages: readonly AgentRuntimeMessage[]): number {
  return estimateTokens(messages);
}

function isUserMessage(message: AgentRuntimeMessage): boolean {
  return message.role === "user";
}

function getToolCallIds(message: AgentRuntimeMessage): string[] {
  return message.parts.flatMap((part) =>
    "toolCallId" in part && typeof part.toolCallId === "string" &&
      part.type !== "tool-result"
      ? [part.toolCallId]
      : []
  );
}

function getToolResultIds(message: AgentRuntimeMessage): string[] {
  return message.parts.flatMap((part) =>
    part.type === "tool-result" && typeof part.toolCallId === "string" ? [part.toolCallId] : []
  );
}

function collectToolCallIds(messages: readonly AgentRuntimeMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const id of getToolCallIds(message)) {
      ids.add(id);
    }
  }
  return ids;
}

function collectToolResultIds(messages: readonly AgentRuntimeMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const id of getToolResultIds(message)) {
      ids.add(id);
    }
  }
  return ids;
}

function findLatestUserMessageIndex(messages: readonly AgentRuntimeMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && isUserMessage(message)) {
      return index;
    }
  }
  return Math.max(0, messages.length - 1);
}

function findRecentTailStartIndex(
  messages: readonly AgentRuntimeMessage[],
  options: Pick<ContextBudgetManagerOptions, "recentTailTokens" | "minimumRecentTurns">,
): number {
  const latestUserIndex = findLatestUserMessageIndex(messages);
  const minimumRecentTurns = Math.max(1, options.minimumRecentTurns ?? 1);
  let tokenTotal = 0;
  let userTurnCount = 0;
  let startIndex = messages.length - 1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }

    tokenTotal += getMessageTokens(message);
    if (isUserMessage(message)) {
      userTurnCount += 1;
    }
    startIndex = index;

    if (
      tokenTotal >= options.recentTailTokens &&
      startIndex <= latestUserIndex &&
      userTurnCount >= minimumRecentTurns
    ) {
      break;
    }
  }

  return startIndex;
}

function expandTailForToolPairs(
  messages: readonly AgentRuntimeMessage[],
  initialStartIndex: number,
): number {
  let startIndex = initialStartIndex;
  let changed = true;

  while (changed) {
    changed = false;
    const tail = messages.slice(startIndex);
    const tailCallIds = collectToolCallIds(tail);
    const tailResultIds = collectToolResultIds(tail);

    for (let index = startIndex - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (!message) {
        continue;
      }

      const messageCallIds = getToolCallIds(message);
      const messageResultIds = getToolResultIds(message);
      const tailNeedsCall = messageCallIds.some((id) => tailResultIds.has(id));
      const tailNeedsResult = messageResultIds.some((id) => tailCallIds.has(id));

      if (tailNeedsCall || tailNeedsResult) {
        startIndex = index;
        changed = true;
      }
    }
  }

  return startIndex;
}

function expandTailForRecentAssistantTurn(
  messages: readonly AgentRuntimeMessage[],
  initialStartIndex: number,
): number {
  const firstRetainedMessage = messages[initialStartIndex];
  const previousMessage = messages[initialStartIndex - 1];
  return firstRetainedMessage?.role === "user" && previousMessage?.role === "assistant"
    ? initialStartIndex - 1
    : initialStartIndex;
}

function createSyntheticSummaryMessage(input: {
  text: string;
  firstKeptEntryId: string;
  timestamp: number;
}): AgentRuntimeMessage {
  return {
    id: `context_compaction_summary:${input.firstKeptEntryId}`,
    role: "system",
    parts: [{
      type: "text",
      text: `Previous context summary:\n${input.text}`,
    }],
    timestamp: input.timestamp,
  };
}

function enforceSummaryLimit(
  summary: ContextCompactionSummary,
  maxSummaryTokens?: number,
): ContextCompactionSummary {
  if (!maxSummaryTokens || estimateTokens(summary.text) <= maxSummaryTokens) {
    return summary;
  }

  throw new ContextCompactionError("Context compaction summary exceeded maxSummaryTokens");
}

function assertValidContextBudgetOptions(options: ContextBudgetManagerOptions): void {
  if (!Number.isInteger(options.tokenBudget) || options.tokenBudget <= 0) {
    throw new ContextCompactionError("Context compaction tokenBudget must be a positive integer");
  }
  if (!Number.isInteger(options.reserveTokens) || options.reserveTokens < 0) {
    throw new ContextCompactionError(
      "Context compaction reserveTokens must be a nonnegative integer",
    );
  }
  if (options.reserveTokens >= options.tokenBudget) {
    throw new ContextCompactionError(
      "Context compaction reserveTokens must be lower than tokenBudget",
    );
  }
  if (!Number.isInteger(options.recentTailTokens) || options.recentTailTokens <= 0) {
    throw new ContextCompactionError(
      "Context compaction recentTailTokens must be a positive integer",
    );
  }
  if (
    options.minimumRecentTurns !== undefined &&
    (!Number.isInteger(options.minimumRecentTurns) || options.minimumRecentTurns <= 0)
  ) {
    throw new ContextCompactionError(
      "Context compaction minimumRecentTurns must be a positive integer",
    );
  }
  if (
    options.maxSummaryTokens !== undefined &&
    (!Number.isInteger(options.maxSummaryTokens) || options.maxSummaryTokens <= 0)
  ) {
    throw new ContextCompactionError(
      "Context compaction maxSummaryTokens must be a positive integer",
    );
  }
}

/** Apply hosted-chat context budget management. */
export async function applyContextBudget(
  messages: readonly AgentRuntimeMessage[],
  options: ContextBudgetManagerOptions,
): Promise<ContextBudgetManagerResult> {
  assertValidContextBudgetOptions(options);
  const reason = options.reason ?? "context_window";
  const tokensBefore = getMessageListTokens(messages);
  const beforeBreakdown = estimateMessageTokenBreakdown(messages);
  const usableBudget = getUsableTokenBudget(options);

  if (tokensBefore <= usableBudget) {
    const retainedMessages = [...messages];
    const afterBreakdown = estimateMessageTokenBreakdown(retainedMessages);
    return {
      messages: retainedMessages,
      diagnostics: {
        compacted: false,
        tokensBefore,
        tokensAfter: tokensBefore,
        beforeBreakdown,
        afterBreakdown,
        tokenBudget: options.tokenBudget,
        reserveTokens: options.reserveTokens,
        summaryTokens: 0,
        retainedTailTokens: tokensBefore,
        reason,
      },
    };
  }

  if (messages.length === 0) {
    throw new ContextCompactionError("Context compaction requires at least one message");
  }

  const initialTailStartIndex = findRecentTailStartIndex(messages, options);
  const conversationTailStartIndex = expandTailForRecentAssistantTurn(
    messages,
    initialTailStartIndex,
  );
  const tailStartIndex = expandTailForToolPairs(messages, conversationTailStartIndex);
  const messagesToSummarize = messages.slice(0, tailStartIndex);
  const retainedMessages = messages.slice(tailStartIndex);
  const firstKeptEntryId = retainedMessages[0]?.id;

  if (!firstKeptEntryId) {
    throw new ContextCompactionError("Context compaction could not select a retained tail");
  }

  let summary: ContextCompactionSummary;
  try {
    summary = getContextCompactionSummarySchema().parse(
      await options.summaryGenerator({
        messagesToSummarize,
        retainedMessages,
        customInstructions: options.customInstructions,
      }),
    );
    summary = enforceSummaryLimit(summary, options.maxSummaryTokens);
  } catch (error) {
    if (error instanceof ContextCompactionError) {
      throw error;
    }
    throw new ContextCompactionError("Context compaction summary generation failed", {
      cause: error,
    });
  }

  const summaryMessage = createSyntheticSummaryMessage({
    text: summary.text,
    firstKeptEntryId,
    timestamp: options.now?.() ?? Date.now(),
  });
  const compactedMessages = [summaryMessage, ...retainedMessages];
  const tokensAfter = getMessageListTokens(compactedMessages);
  const afterBreakdown = estimateMessageTokenBreakdown(compactedMessages);
  if (tokensAfter > usableBudget) {
    throw new ContextCompactionError("Context compaction result exceeded usable token budget");
  }

  const eventPayload = getContextCompactionEventPayloadSchema().parse({
    type: AGENT_RUN_CONTEXT_COMPACTED_EVENT_TYPE,
    summary,
    firstKeptEntryId,
    tokensBefore,
    tokensAfter,
    tokenBudget: options.tokenBudget,
    reserveTokens: options.reserveTokens,
    reason,
  });

  return {
    messages: compactedMessages,
    eventPayload,
    diagnostics: {
      compacted: true,
      tokensBefore,
      tokensAfter,
      beforeBreakdown,
      afterBreakdown,
      tokenBudget: options.tokenBudget,
      reserveTokens: options.reserveTokens,
      summaryTokens: estimateTokens(summary.text),
      retainedTailTokens: getMessageListTokens(retainedMessages),
      reason,
    },
  };
}
