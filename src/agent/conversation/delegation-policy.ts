import { extractLatestUserText } from "../artifacts/default-research-artifact-support.ts";
import { buildRootOwnedChildRunResultHint } from "../child-run/result-summary.ts";
import { isRecord } from "../../chat/conversation.ts";
import type { ChatSystemMessage } from "../../chat/types.ts";

/** Shared keep root assistant visible owner value. */
export const KEEP_ROOT_ASSISTANT_VISIBLE_OWNER = "Keep the root assistant visibly owning the work.";
/** Shared delegate only when materially helpful value. */
export const DELEGATE_ONLY_WHEN_MATERIALLY_HELPFUL =
  "Delegate only when isolation, parallelism, or a different tool/model budget materially helps.";
/** Shared no delegation narration unless asked value. */
export const NO_DELEGATION_NARRATION_UNLESS_ASKED =
  "Do not mention child agents, delegation, or tool/process narration unless the user explicitly asks about them.";
/** Shared synthesize delegated findings in root voice value. */
export const SYNTHESIZE_DELEGATED_FINDINGS_IN_ROOT_VOICE =
  "After delegated work returns, synthesize the findings in the root assistant voice.";

/** Shared load skill continue same turn value. */
export const LOAD_SKILL_CONTINUE_SAME_TURN = "Continue the same turn after calling it.";
/** Shared load skill continue same turn now value. */
export const LOAD_SKILL_CONTINUE_SAME_TURN_NOW = "Continue the same turn now.";
/** Shared load skill root ownership value. */
export const LOAD_SKILL_ROOT_OWNERSHIP: typeof KEEP_ROOT_ASSISTANT_VISIBLE_OWNER =
  KEEP_ROOT_ASSISTANT_VISIBLE_OWNER;
/** Shared load skill use allowed tools value. */
export const LOAD_SKILL_USE_ALLOWED_TOOLS =
  "For multi-step or isolated work, call invoke_agent; otherwise keep working directly with the allowed tools.";
/** Shared load skill delegation threshold value. */
export const LOAD_SKILL_DELEGATION_THRESHOLD: typeof DELEGATE_ONLY_WHEN_MATERIALLY_HELPFUL =
  DELEGATE_ONLY_WHEN_MATERIALLY_HELPFUL;
/** Shared load skill override forwarding value. */
export const LOAD_SKILL_OVERRIDE_FORWARDING =
  "Pass through any returned model, thinking, or maxSteps overrides to invoke_agent when delegating.";
/** Shared load skill tool intersection value. */
export const LOAD_SKILL_TOOL_INTERSECTION =
  "If the current run exposes fewer tools than the loaded skill metadata, use only the tools that are actually available right now.";

/** Builds root owned delegated findings instruction. */
export function buildRootOwnedDelegatedFindingsInstruction(): string {
  return `Use these delegated findings directly in your next assistant response. ${KEEP_ROOT_ASSISTANT_VISIBLE_OWNER} ${NO_DELEGATION_NARRATION_UNLESS_ASKED}`;
}

/** Shared root owned child result instruction value. */
export const ROOT_OWNED_CHILD_RESULT_INSTRUCTION: string =
  buildRootOwnedDelegatedFindingsInstruction();

/** Builds root owned child result hint. */
export function buildRootOwnedChildResultHint(
  text: string,
): { instruction: string; suggestedText: string } {
  return buildRootOwnedChildRunResultHint({
    text,
    instruction: ROOT_OWNED_CHILD_RESULT_INSTRUCTION,
  });
}

/** Public API contract for root owned child result hint. */
export interface RootOwnedChildResultHint {
  /** Instruction value. */
  instruction: string;
  /** Suggested text value. */
  suggestedText: string;
}

/** Public API contract for root owned child result hinted. */
export interface RootOwnedChildResultHinted {
  /** Root response hint value. */
  rootResponseHint?: RootOwnedChildResultHint;
}

function getRootOwnedChildResultText(result: unknown): string | null {
  if (!isRecord(result)) {
    return null;
  }

  if (
    result.status === "completed" &&
    typeof result.text === "string" &&
    result.text.length > 0
  ) {
    return result.text;
  }

  if (!result.success || !isRecord(result.summary)) {
    return null;
  }

  return typeof result.summary.text === "string" && result.summary.text.length > 0
    ? result.summary.text
    : null;
}

/** Applies root owned child result hint. */
export function withRootOwnedChildResultHint<T extends object>(
  result: T,
): T & RootOwnedChildResultHinted {
  const text = getRootOwnedChildResultText(result);
  if (!text) {
    return result;
  }

  return {
    ...result,
    rootResponseHint: buildRootOwnedChildResultHint(text),
  };
}

/** Builds invoke agent followup instruction. */
export function buildInvokeAgentFollowupInstruction(): string {
  return `${SYNTHESIZE_DELEGATED_FINDINGS_IN_ROOT_VOICE} ${NO_DELEGATION_NARRATION_UNLESS_ASKED}`;
}

/** Builds starter intent root ownership reminder. */
export function buildStarterIntentRootOwnershipReminder(): string {
  return `CRITICAL: For first-turn /plan and /research starter requests, keep the root assistant visibly owning the work, continue in the same turn after load_skill, and delegate only when isolation, parallelism, or a different tool/model budget materially helps.`;
}

/** Message shape for build starter intent root ownership block. */
export function buildStarterIntentRootOwnershipBlockMessage(): string {
  return `Keep the first /plan or /research turn root-owned. Continue in the main thread after load_skill, explain the approach first, and delegate only when isolation, parallelism, or a different tool/model budget materially helps.`;
}

/** Shared load skill continuation reminder value. */
export const LOAD_SKILL_CONTINUATION_REMINDER =
  `CRITICAL: load_skill only loaded instructions. ${LOAD_SKILL_CONTINUE_SAME_TURN_NOW} ${LOAD_SKILL_ROOT_OWNERSHIP} Use the loaded skill guidance to proceed. ${LOAD_SKILL_DELEGATION_THRESHOLD} Do not stop immediately after load_skill.`;
/** Shared slash command artifact reminder value. */
export const SLASH_COMMAND_ARTIFACT_REMINDER =
  `CRITICAL: This slash-command task names an exact artifact path. ${LOAD_SKILL_ROOT_OWNERSHIP} Treat that path as a required deliverable, and continue in the same turn. Delegate only when isolation materially helps.`;
const RICH_TEXT_COMMAND_PATTERN = /<span\s+data-command="([^"]+)">\s*\/([a-z0-9_-]+)\s*<\/span>/gi;
const STARTER_INTENT_PATTERN = /^\s*\/([a-z0-9_-]+)\b/i;
const CONVERSATION_FIRST_STARTER_INTENT_IDS = new Set(["plan", "research"]);
/** Shared first turn starter intent root ownership reminder value. */
export const FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_REMINDER: string =
  buildStarterIntentRootOwnershipReminder();
/** Shared first turn starter intent root ownership context key value. */
export const FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_CONTEXT_KEY =
  "__vfStarterIntentRootOwnership";
/** Shared first turn starter intent root ownership block message value. */
export const FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_BLOCK_MESSAGE: string =
  buildStarterIntentRootOwnershipBlockMessage();

/** Input used to evaluate first-turn starter intent policy. */
export type StarterIntentTurnPolicyInput = {
  /** Conversation messages available at the current step. */
  messages: readonly unknown[];
  /** Zero-based runtime step index. */
  step: number;
};

/** Result of evaluating first-turn starter intent policy. */
export type StarterIntentTurnPolicy = {
  /** Parsed starter intent identifier, when present. */
  starterIntentId: string | null;
  /** Whether the root agent must remain the visible conversation owner. */
  keepConversationFirst: boolean;
  /** Whether root-ownership instructions must be added. */
  shouldAddRootOwnershipReminder: boolean;
  /** Whether immediate delegation must be blocked. */
  shouldBlockImmediateDelegation: boolean;
};

function isToolCallPart(
  part: unknown,
): part is { type: "tool-call"; toolCallId: string; toolName: string } {
  return (
    isRecord(part) &&
    part.type === "tool-call" &&
    typeof part.toolCallId === "string" &&
    typeof part.toolName === "string"
  );
}

function isToolResultPart(part: unknown): part is {
  type: "tool-result";
  toolCallId: string;
  toolName?: string;
  output?: unknown;
  result?: unknown;
} {
  return isRecord(part) && part.type === "tool-result" && typeof part.toolCallId === "string";
}

function hasNonEmptyTextPart(part: unknown): boolean {
  return isRecord(part) && part.type === "text" && typeof part.text === "string" &&
    part.text.trim().length > 0;
}

function hasToolCallOrResult(messages: readonly unknown[], toolName: string): boolean {
  return messages.some((message) => {
    if (!isRecord(message) || !Array.isArray(message.content)) {
      return false;
    }

    return message.content.some((part) => {
      if (!isRecord(part) || typeof part.toolName !== "string") {
        return false;
      }

      return (part.type === "tool-call" || part.type === "tool-result") &&
        part.toolName === toolName;
    });
  });
}

/** Extract starter intent ID. */
export function extractStarterIntentId(messages: readonly unknown[]): string | null {
  const latestUserText = extractLatestUserText(messages);
  if (!latestUserText) {
    return null;
  }

  const normalizedText = latestUserText.replace(
    RICH_TEXT_COMMAND_PATTERN,
    (_match, _dataCommand, slashCommand) => {
      return `/${slashCommand}`;
    },
  );
  const commandId = STARTER_INTENT_PATTERN.exec(normalizedText)?.[1] ?? null;

  return commandId ? commandId.toLowerCase() : null;
}

/** Evaluate starter intent turn policy helper. */
export function evaluateStarterIntentTurnPolicy(
  input: StarterIntentTurnPolicyInput,
): StarterIntentTurnPolicy {
  const starterIntentId = extractStarterIntentId(input.messages);
  const keepConversationFirst = input.step === 1 && starterIntentId !== null &&
    CONVERSATION_FIRST_STARTER_INTENT_IDS.has(starterIntentId);
  const invokeAgentStarted = keepConversationFirst &&
    hasToolCallOrResult(input.messages, "invoke_agent");

  return {
    starterIntentId,
    keepConversationFirst,
    shouldAddRootOwnershipReminder: keepConversationFirst && !invokeAgentStarted,
    shouldBlockImmediateDelegation: keepConversationFirst,
  };
}

/** Add first turn starter intent root ownership reminder helper. */
export function addFirstTurnStarterIntentRootOwnershipReminder(system: string): string {
  if (system.includes(FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_REMINDER)) {
    return system;
  }

  return `${system}\n\n${FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_REMINDER}`;
}

/** Check whether starter intent root ownership is required. */
export function isStarterIntentRootOwnershipRequired(value: unknown): boolean {
  return value === true;
}

/** Should reinforce load skill continuation helper. */
export function shouldReinforceLoadSkillContinuation(messages: readonly unknown[]): boolean {
  const lastMessage = messages.at(-1);
  const previousMessage = messages.at(-2);

  if (
    !isRecord(lastMessage) || lastMessage.role !== "tool" ||
    !Array.isArray(lastMessage.content)
  ) {
    return false;
  }

  if (
    !isRecord(previousMessage) || previousMessage.role !== "assistant" ||
    !Array.isArray(previousMessage.content)
  ) {
    return false;
  }

  const toolCalls: Array<{ type: "tool-call"; toolCallId: string; toolName: string }> = [];
  for (const part of previousMessage.content) {
    if (isToolCallPart(part)) {
      toolCalls.push(part);
    }
  }

  const loadSkillCalls = toolCalls.filter((part) => part.toolName === "load_skill");

  if (loadSkillCalls.length === 0) {
    return false;
  }

  if (previousMessage.content.some(hasNonEmptyTextPart)) {
    return false;
  }

  if (toolCalls.some((part) => part.toolName !== "load_skill")) {
    return false;
  }

  const completedToolCallIds = new Set<string>();
  for (const part of lastMessage.content) {
    if (isToolResultPart(part)) {
      completedToolCallIds.add(part.toolCallId);
    }
  }

  return loadSkillCalls.every((part) => completedToolCallIds.has(part.toolCallId));
}

/** Add load skill continuation reminder helper. */
export function addLoadSkillContinuationReminder(
  instructions: string | ChatSystemMessage[],
): string | ChatSystemMessage[] {
  if (typeof instructions === "string") {
    return instructions.includes(LOAD_SKILL_CONTINUATION_REMINDER)
      ? instructions
      : `${instructions}\n\n${LOAD_SKILL_CONTINUATION_REMINDER}`;
  }

  if (instructions.some((message) => message.content.includes(LOAD_SKILL_CONTINUATION_REMINDER))) {
    return instructions;
  }

  return [
    ...instructions,
    {
      role: "system",
      content: LOAD_SKILL_CONTINUATION_REMINDER,
    },
  ];
}

/** Add slash command artifact reminder helper. */
export function addSlashCommandArtifactReminder(
  instructions: string | ChatSystemMessage[],
): string | ChatSystemMessage[] {
  if (typeof instructions === "string") {
    return instructions.includes(SLASH_COMMAND_ARTIFACT_REMINDER)
      ? instructions
      : `${instructions}\n\n${SLASH_COMMAND_ARTIFACT_REMINDER}`;
  }

  if (instructions.some((message) => message.content.includes(SLASH_COMMAND_ARTIFACT_REMINDER))) {
    return instructions;
  }

  return [
    ...instructions,
    {
      role: "system",
      content: SLASH_COMMAND_ARTIFACT_REMINDER,
    },
  ];
}
