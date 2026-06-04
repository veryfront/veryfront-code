import { estimateTokens } from "../../chat/message-prep.ts";
import { defineSchema } from "../../schemas/index.ts";
import type { InferSchema } from "../../extensions/schema/index.ts";
import type { AgentRuntimeMessage } from "../runtime/message-adapter.ts";

export const AGENT_RUN_CONTEXT_COMPACTED_EVENT_TYPE = "AGENT_RUN_CONTEXT_COMPACTED" as const;

export const getContextCompactionSummarySchema = defineSchema((v) =>
  v.object({
    text: v.string().min(1),
  })
);

export const getContextCompactionEventPayloadSchema = defineSchema((v) =>
  v.object({
    type: v.literal(AGENT_RUN_CONTEXT_COMPACTED_EVENT_TYPE),
    summary: getContextCompactionSummarySchema(),
    firstKeptEntryId: v.string().min(1),
    tokensBefore: v.number().int().nonnegative(),
    tokensAfter: v.number().int().nonnegative(),
    tokenBudget: v.number().int().positive(),
    reserveTokens: v.number().int().nonnegative(),
    reason: v.enum(["context_window", "transport_body"]),
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

export type ContextCompactionSummary = InferSchema<
  ReturnType<typeof getContextCompactionSummarySchema>
>;

export type ContextCompactionEventPayload = InferSchema<
  ReturnType<typeof getContextCompactionEventPayloadSchema>
>;

export type ContextCompactionReason = ContextCompactionEventPayload["reason"];

export type ContextSummaryGenerator = (input: {
  messagesToSummarize: AgentRuntimeMessage[];
  retainedMessages: AgentRuntimeMessage[];
  customInstructions?: string;
}) => Promise<ContextCompactionSummary> | ContextCompactionSummary;

export type ContextBudgetManagerOptions = {
  tokenBudget: number;
  reserveTokens: number;
  recentTailTokens: number;
  minimumRecentTurns?: number;
  maxSummaryTokens?: number;
  customInstructions?: string;
  reason?: ContextCompactionReason;
  now?: () => number;
  summaryGenerator: ContextSummaryGenerator;
};

export type ContextBudgetDiagnostics = {
  compacted: boolean;
  tokensBefore: number;
  tokensAfter: number;
  tokenBudget: number;
  reserveTokens: number;
  summaryTokens: number;
  retainedTailTokens: number;
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
  const usableBudget = getUsableTokenBudget(options);

  if (tokensBefore <= usableBudget) {
    return {
      messages: [...messages],
      diagnostics: {
        compacted: false,
        tokensBefore,
        tokensAfter: tokensBefore,
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
      tokenBudget: options.tokenBudget,
      reserveTokens: options.reserveTokens,
      summaryTokens: estimateTokens(summary.text),
      retainedTailTokens: getMessageListTokens(retainedMessages),
      reason,
    },
  };
}
