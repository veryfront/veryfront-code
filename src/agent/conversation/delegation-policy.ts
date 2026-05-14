import { extractLatestUserText } from "../default-research-artifact-support.ts";
import { buildRootOwnedChildRunResultHint } from "../child-run/result-summary.ts";
import { isRecord } from "../../chat/conversation.ts";
import type { ChatSystemMessage } from "../../chat/types.ts";

export const KEEP_ROOT_ASSISTANT_VISIBLE_OWNER = "Keep the root assistant visibly owning the work.";
export const DELEGATE_ONLY_WHEN_MATERIALLY_HELPFUL =
  "Delegate only when isolation, parallelism, or a different tool/model budget materially helps.";
export const NO_DELEGATION_NARRATION_UNLESS_ASKED =
  "Do not mention child agents, delegation, or tool/process narration unless the user explicitly asks about them.";
export const SYNTHESIZE_DELEGATED_FINDINGS_IN_ROOT_VOICE =
  "After delegated work returns, synthesize the findings in the root assistant voice.";

export const LOAD_SKILL_CONTINUE_SAME_TURN = "Continue the same turn after calling it.";
export const LOAD_SKILL_CONTINUE_SAME_TURN_NOW = "Continue the same turn now.";
export const LOAD_SKILL_ROOT_OWNERSHIP = KEEP_ROOT_ASSISTANT_VISIBLE_OWNER;
export const LOAD_SKILL_USE_ALLOWED_TOOLS =
  "For multi-step or isolated work, call invoke_agent; otherwise keep working directly with the allowed tools.";
export const LOAD_SKILL_DELEGATION_THRESHOLD = DELEGATE_ONLY_WHEN_MATERIALLY_HELPFUL;
export const LOAD_SKILL_OVERRIDE_FORWARDING =
  "Pass through any returned model, thinking, or maxSteps overrides to invoke_agent when delegating.";
export const LOAD_SKILL_TOOL_INTERSECTION =
  "If the current run exposes fewer tools than the loaded skill metadata, use only the tools that are actually available right now.";

export function buildRootOwnedDelegatedFindingsInstruction(): string {
  return `Use these delegated findings directly in your next assistant response. ${KEEP_ROOT_ASSISTANT_VISIBLE_OWNER} ${NO_DELEGATION_NARRATION_UNLESS_ASKED}`;
}

export const ROOT_OWNED_CHILD_RESULT_INSTRUCTION = buildRootOwnedDelegatedFindingsInstruction();

export function buildRootOwnedChildResultHint(
  text: string,
): { instruction: string; suggestedText: string } {
  return buildRootOwnedChildRunResultHint({
    text,
    instruction: ROOT_OWNED_CHILD_RESULT_INSTRUCTION,
  });
}

export interface RootOwnedChildResultHint {
  instruction: string;
  suggestedText: string;
}

export interface RootOwnedChildResultHinted {
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

export function buildInvokeAgentFollowupInstruction(): string {
  return `${SYNTHESIZE_DELEGATED_FINDINGS_IN_ROOT_VOICE} ${NO_DELEGATION_NARRATION_UNLESS_ASKED}`;
}

export function buildStarterIntentRootOwnershipReminder(): string {
  return `CRITICAL: For first-turn /plan and /research starter requests, keep the root assistant visibly owning the work, continue in the same turn after load_skill, and delegate only when isolation, parallelism, or a different tool/model budget materially helps.`;
}

export function buildStarterIntentRootOwnershipBlockMessage(): string {
  return `Keep the first /plan or /research turn root-owned. Continue in the main thread after load_skill, explain the approach first, and delegate only when isolation, parallelism, or a different tool/model budget materially helps.`;
}

export const LOAD_SKILL_CONTINUATION_REMINDER =
  `CRITICAL: load_skill only loaded instructions. ${LOAD_SKILL_CONTINUE_SAME_TURN_NOW} ${LOAD_SKILL_ROOT_OWNERSHIP} Use the loaded skill guidance to proceed. ${LOAD_SKILL_DELEGATION_THRESHOLD} Do not stop immediately after load_skill.`;
export const SLASH_COMMAND_ARTIFACT_REMINDER =
  `CRITICAL: This slash-command task names an exact artifact path. ${LOAD_SKILL_ROOT_OWNERSHIP} Treat that path as a required deliverable, and continue in the same turn. Delegate only when isolation materially helps.`;
const RICH_TEXT_COMMAND_PATTERN = /<span\s+data-command="([^"]+)">\s*\/([a-z0-9_-]+)\s*<\/span>/gi;
const STARTER_INTENT_PATTERN = /^\s*\/([a-z0-9_-]+)\b/i;
const CONVERSATION_FIRST_STARTER_INTENT_IDS = new Set(["plan", "research"]);
export const FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_REMINDER =
  buildStarterIntentRootOwnershipReminder();
export const FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_CONTEXT_KEY =
  "__vfStarterIntentRootOwnership";
export const FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_BLOCK_MESSAGE =
  buildStarterIntentRootOwnershipBlockMessage();

type StarterIntentTurnPolicyInput = {
  messages: readonly unknown[];
  step: number;
};

type StarterIntentTurnPolicy = {
  starterIntentId: string | null;
  keepConversationFirst: boolean;
  shouldAddRootOwnershipReminder: boolean;
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

export function addFirstTurnStarterIntentRootOwnershipReminder(system: string): string {
  if (system.includes(FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_REMINDER)) {
    return system;
  }

  return `${system}\n\n${FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_REMINDER}`;
}

export function isStarterIntentRootOwnershipRequired(value: unknown): boolean {
  return value === true;
}

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

export function addLoadSkillContinuationReminder(
  instructions: string | ChatSystemMessage[],
): string | ChatSystemMessage[] {
  if (typeof instructions === "string") {
    return `${instructions}\n\n${LOAD_SKILL_CONTINUATION_REMINDER}`;
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

export function addSlashCommandArtifactReminder(
  instructions: string | ChatSystemMessage[],
): string | ChatSystemMessage[] {
  if (typeof instructions === "string") {
    return `${instructions}\n\n${SLASH_COMMAND_ARTIFACT_REMINDER}`;
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
