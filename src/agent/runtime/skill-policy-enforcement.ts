import type { ChatUiMessage } from "#veryfront/chat/types.ts";
import { getToolResultSource } from "#veryfront/chat/tool-result-source.ts";
import { privateJsonParse, privateJsonStringify } from "#veryfront/security/private-json.ts";
import { slicePrivateArray } from "#veryfront/security/private-array.ts";
import {
  JSON_VALUE_MAX_SERIALIZED_BYTES,
  JSON_VALUE_MAX_STRING_BYTES,
  snapshotBoundedJsonValue,
} from "#veryfront/schemas/json-value.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import type { Message, ToolResultPart } from "../types.ts";
import type { ToolDefinition } from "#veryfront/tool";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import {
  isRuntimeGeneratedUserMessage,
  markRuntimeGeneratedUserMessage,
} from "./runtime-message-origin.ts";
import {
  attachProviderMetadata,
  isProviderReplayDelivered,
  markProviderReplayDelivered,
  readAttachedProviderMetadata,
} from "./provider-metadata.ts";
import { serverLogger } from "#veryfront/utils";
import {
  isSkillToolAvailable,
  type SkillToolAvailability,
} from "#veryfront/skill/allowed-tools.ts";
import {
  SKILL_DOCUMENT_MAX_CHARACTERS,
  SKILL_ID_MAX_LENGTH,
  SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
  SKILL_RELATIVE_PATH_MAX_LENGTH,
  SKILL_SUBDIR_MAX_ENTRIES,
} from "#veryfront/skill/limits.ts";
import { SKILL_READABLE_DIRS } from "#veryfront/skill/types.ts";
import { hasControlCharacters, isWellFormedUtf16 } from "#veryfront/skill/string-safety.ts";
import {
  hasToolExecutionErrorMarker,
  readToolResultOwnDataProperty,
  UNREADABLE_TOOL_RESULT_PROPERTY,
} from "#veryfront/tool/result.ts";
import { isToolResultPart } from "./tool-result-part.ts";
import { normalizeStrictRuntimeSkillReferencePath } from "./skill-metadata.ts";
import {
  extractSkillDelegationOverrides,
  type SkillDelegationOverrides,
} from "./skill-delegation-overrides.ts";
import { isGenuineUserTurnMessage } from "./runtime-message-origin.ts";
import {
  CANONICAL_FORM_INPUT_TOOL_ID,
  CANONICAL_LOAD_SKILL_TOOL_ID,
  FORM_INPUT_TOOL_ID,
  isFormInputToolName,
  isLoadSkillToolName,
  LOAD_SKILL_TOOL_ID,
} from "../platform-tool-names.ts";
export {
  CANONICAL_FORM_INPUT_TOOL_ID,
  CANONICAL_LOAD_SKILL_TOOL_ID,
  FORM_INPUT_TOOL_ID,
  isFormInputToolName,
  isLoadSkillToolName,
  LOAD_SKILL_TOOL_ID,
} from "../platform-tool-names.ts";

const logger = serverLogger.component("agent");
const objectHasOwn = Object.hasOwn;
const arrayIsArray = Array.isArray;
const trustedPlatformPolicyToolDefinitions = createPrivateWeakStore<object, true>();
const trustedPlatformPolicyToolResults = createPrivateWeakStore<object, string>();
const trustedHostedSourceIdentities = createPrivateWeakStore<object, object>();
const inheritedHostedPolicyToolResultIds = createPrivateWeakStore<object, Set<string>>();
const TRUSTED_PLATFORM_POLICY_TOOL_RESULT_METADATA_KEY =
  "__veryfrontTrustedPlatformPolicyToolResultIds";

export const INVOKE_AGENT_TOOL_ID = "invoke_agent";
export const SUBMITTED_FORM_INPUT_CONTEXT_KEY = "hasSubmittedFormInputResult";

const EMPTY_SKILL_FILE_LIST = Object.freeze([]) as readonly string[];

export const INACTIVE_SKILL_TOOL_AVAILABILITY: SkillToolAvailability = Object.freeze({
  hasActiveSkill: false,
  references: EMPTY_SKILL_FILE_LIST,
  scripts: EMPTY_SKILL_FILE_LIST,
});

const POST_SUBMITTED_FORM_INPUT_BLOCKED_TOOL_IDS: ReadonlySet<string> = new Set([
  FORM_INPUT_TOOL_ID,
  CANONICAL_FORM_INPUT_TOOL_ID,
]);

/** Mark a model-facing tool schema as the framework-owned platform control tool it represents. */
export function markTrustedPlatformPolicyToolDefinition<T extends ToolDefinition>(
  definition: T,
): T {
  trustedPlatformPolicyToolDefinitions.set(definition, true);
  return definition;
}

/** Check platform control provenance without trusting the public tool name. */
export function hasTrustedPlatformPolicyToolDefinition(definition: unknown): boolean {
  return typeof definition === "object" && definition !== null &&
    trustedPlatformPolicyToolDefinitions.get(definition) === true;
}

function snapshotPlatformPolicyToolResult(part: ToolResultPart): string | undefined {
  const type = readToolResultOwnDataProperty(part, "type");
  const toolCallId = readToolResultOwnDataProperty(part, "toolCallId");
  const toolName = readToolResultOwnDataProperty(part, "toolName");
  if (
    type !== "tool-result" || typeof toolCallId !== "string" || toolCallId.length === 0 ||
    typeof toolName !== "string" || toolName.length === 0
  ) return undefined;
  const isSkillLoad = toolName === "load_skill" || toolName === "veryfront__load_skill";
  const resultValue = readToolResultOwnDataProperty(part, "result");
  const providerExecuted = readToolResultOwnDataProperty(part, "providerExecuted");
  if (
    resultValue === UNREADABLE_TOOL_RESULT_PROPERTY ||
    providerExecuted === UNREADABLE_TOOL_RESULT_PROPERTY
  ) return undefined;
  // Match admitted payload sizes, including the small platform-result envelope.
  // A valid UTF-16 skill character uses at most three UTF-8 bytes, or six JSON
  // escape bytes. Include the existing bounded reference/script path inventory.
  const maxJsonBytes = isSkillLoad
    ? 6 * SKILL_DOCUMENT_MAX_CHARACTERS +
      6 * SKILL_RELATIVE_PATH_MAX_LENGTH *
        (SKILL_LOADABLE_REFERENCE_MAX_ENTRIES + SKILL_SUBDIR_MAX_ENTRIES) +
      65_536
    : JSON_VALUE_MAX_SERIALIZED_BYTES + 4_096;
  const encoded = typeof resultValue === "string";
  // Stored results may already be JSON strings. Snapshotting their literal text
  // can double JSON escape bytes; it must retain the same accepted payload.
  const result = snapshotBoundedJsonValue(
    resultValue,
    encoded
      ? maxJsonBytes
      : isSkillLoad
      ? 3 * SKILL_DOCUMENT_MAX_CHARACTERS
      : JSON_VALUE_MAX_STRING_BYTES,
    encoded ? 2 * maxJsonBytes + 2 : maxJsonBytes,
  );
  if (!result.success) return undefined;
  try {
    return privateJsonStringify({
      toolCallId,
      toolName,
      providerExecuted,
      result: normalizeToolResultPayload(result.value),
    });
  } catch {
    return undefined;
  }
}

/** Bind runtime-created control provenance to its data-only identity and result. */
export function markTrustedPlatformPolicyToolResultPart<T extends ToolResultPart>(
  part: T,
): T {
  const snapshot = snapshotPlatformPolicyToolResult(part);
  if (snapshot !== undefined && trustedPlatformPolicyToolResults.get(part) === undefined) {
    trustedPlatformPolicyToolResults.set(part, snapshot);
  }
  return part;
}

export function hasTrustedPlatformPolicyToolResultPart(part: ToolResultPart): boolean {
  const trustedSnapshot = trustedPlatformPolicyToolResults.get(part);
  return trustedSnapshot !== undefined &&
    snapshotPlatformPolicyToolResult(part) === trustedSnapshot;
}

/** Preserve control provenance only across clones with the original identity and result. */
export function inheritTrustedPlatformPolicyToolResultPart<T extends ToolResultPart>(
  source: ToolResultPart,
  target: T,
): T {
  const trustedSnapshot = trustedPlatformPolicyToolResults.get(source);
  if (
    trustedSnapshot !== undefined &&
    snapshotPlatformPolicyToolResult(source) === trustedSnapshot &&
    snapshotPlatformPolicyToolResult(target) === trustedSnapshot
  ) {
    trustedPlatformPolicyToolResults.set(target, trustedSnapshot);
  }
  return target;
}

function getTrustedPlatformPolicyToolResultIdsForPersistence(
  message: Message,
): string[] {
  const toolCallIds: string[] = [];
  for (let index = 0; index < message.parts.length; index++) {
    if (!objectHasOwn(message.parts, index)) continue;
    const part = message.parts[index]!;
    if (isToolResultPart(part) && hasTrustedPlatformPolicyToolResultPart(part)) {
      toolCallIds[toolCallIds.length] = part.toolCallId;
    }
  }
  return toolCallIds;
}

function withPolicyMetadata<TMessage extends Message>(
  message: TMessage,
  toolCallIds: readonly string[],
): TMessage {
  const metadata: Record<string, unknown> = {
    ...(objectHasOwn(message, "metadata") ? message.metadata ?? {} : {}),
  };
  delete metadata[TRUSTED_PLATFORM_POLICY_TOOL_RESULT_METADATA_KEY];
  if (toolCallIds.length > 0) {
    metadata[TRUSTED_PLATFORM_POLICY_TOOL_RESULT_METADATA_KEY] = slicePrivateArray(toolCallIds);
  }
  let nextMessage = {
    ...message,
    ...(Object.keys(metadata).length > 0 ? { metadata } : { metadata: undefined }),
  };
  const providerMetadata = readAttachedProviderMetadata(message);
  if (providerMetadata !== undefined) {
    nextMessage = attachProviderMetadata(nextMessage, providerMetadata);
  }
  if (isProviderReplayDelivered(message)) {
    markProviderReplayDelivered(nextMessage);
  }
  return isRuntimeGeneratedUserMessage(message)
    ? markRuntimeGeneratedUserMessage(nextMessage)
    : nextMessage;
}

/**
 * Prepare a runtime-created message for durable memory. Caller-supplied
 * metadata is cleared first; only live WeakStore provenance can create the
 * persisted ownership sidecar.
 */
export function prepareTrustedPlatformPolicyMessageForPersistence(message: Message): Message {
  const trustedToolCallIds = getTrustedPlatformPolicyToolResultIdsForPersistence(message);
  return withPolicyMetadata(message, trustedToolCallIds);
}

/** Remove persisted ownership sidecars from caller-supplied messages before admission. */
export function stripTrustedPlatformPolicyMessageMetadata(message: Message): Message {
  return withPolicyMetadata(message, []);
}

function isTrustedPlatformPolicyTool(
  toolName: string,
  definition?: ToolDefinition,
): boolean {
  if (!isFormInputToolName(toolName) && !isLoadSkillToolName(toolName)) {
    return false;
  }
  return hasTrustedPlatformPolicyToolDefinition(definition);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  try {
    return value !== null && typeof value === "object" && !arrayIsArray(value);
  } catch {
    return false;
  }
}

function getBoundedArrayLength(value: unknown, maxEntries: number): number | null {
  try {
    if (!arrayIsArray(value)) return null;
  } catch {
    return null;
  }
  const length = readToolResultOwnDataProperty(value, "length");
  return typeof length === "number" &&
      Number.isSafeInteger(length) &&
      length >= 0 &&
      length <= maxEntries
    ? length
    : null;
}

function getActiveSkillReferenceSnapshot(
  activeSkillId: string | undefined,
  availability: SkillToolAvailability | undefined,
): string[] {
  if (
    !activeSkillId ||
    !isRecord(availability) ||
    readToolResultOwnDataProperty(availability, "hasActiveSkill") !== true
  ) {
    return [];
  }
  const references = readToolResultOwnDataProperty(availability, "references");
  const referenceCount = getBoundedArrayLength(
    references,
    SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
  );
  if (referenceCount === null) return [];

  const snapshot: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < referenceCount; index += 1) {
    const reference = readToolResultOwnDataProperty(references, index);
    if (
      typeof reference !== "string" ||
      normalizeStrictRuntimeSkillReferencePath(reference) !== reference ||
      !SKILL_READABLE_DIRS.some((directory) => reference.startsWith(`${directory}/`))
    ) {
      return [];
    }
    if (!seen.has(reference)) {
      seen.add(reference);
      snapshot.push(reference);
    }
  }
  return snapshot;
}

function normalizeToolResultPayload(result: unknown): unknown {
  const parsed = typeof result === "string" ? parseToolResultJson(result) : result;
  if (!isRecord(parsed)) return parsed;
  const type = readToolResultOwnDataProperty(parsed, "type");
  if (type === "json" && objectHasOwn(parsed, "value")) {
    const value = readToolResultOwnDataProperty(parsed, "value");
    return typeof value === "string" ? parseToolResultJson(value) : value;
  }
  return parsed;
}

function getSkillActivationResult(result: unknown): Record<string, unknown> | undefined {
  const normalized = normalizeToolResultPayload(result);
  if (!isRecord(normalized) || hasToolExecutionErrorMarker(normalized)) return undefined;
  const skillId = readToolResultOwnDataProperty(normalized, "skillId");
  const instructions = readToolResultOwnDataProperty(normalized, "instructions");
  const isActivation = typeof skillId === "string" &&
    skillId.length > 0 &&
    skillId.length <= SKILL_ID_MAX_LENGTH &&
    isWellFormedUtf16(skillId) &&
    !hasControlCharacters(skillId) &&
    typeof instructions === "string" &&
    instructions.length <= SKILL_DOCUMENT_MAX_CHARACTERS &&
    isWellFormedUtf16(instructions);
  return isActivation ? normalized : undefined;
}

function isSkillActivationResult(result: unknown): boolean {
  return getSkillActivationResult(result) !== undefined;
}

export type ActiveSkillState = {
  activeSkillId: string | undefined;
  activeSkillToolAvailability: SkillToolAvailability;
  activeSkillDelegationOverrides: SkillDelegationOverrides | undefined;
};

/**
 * Rebuild the active skill from replayed load_skill results.
 *
 * Replayed history is caller-supplied: public wrappers accept a message array
 * whose tool-result parts are shaped, not proven, so a forged load_skill result
 * is indistinguishable from a persisted one here. Skill *file* capabilities are
 * revalidated against the authoritative skill before access, but delegation
 * overrides are applied directly to invoke_agent inputs, so they are never
 * hydrated: only a load_skill call this runtime actually executed may set them.
 */
export function hydrateActiveSkillStateFromMessages(
  messages: readonly Message[],
): ActiveSkillState {
  let state: ActiveSkillState = {
    activeSkillId: undefined,
    activeSkillToolAvailability: INACTIVE_SKILL_TOOL_AVAILABILITY,
    activeSkillDelegationOverrides: undefined,
  };

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    if (!objectHasOwn(messages, messageIndex)) continue;
    const message = messages[messageIndex]!;
    for (let partIndex = 0; partIndex < message.parts.length; partIndex++) {
      if (!objectHasOwn(message.parts, partIndex)) continue;
      const part = message.parts[partIndex]!;
      if (
        !isToolResultPart(part) ||
        !hasTrustedPlatformPolicyToolResultPart(part) ||
        !isLoadSkillToolName(part.toolName)
      ) continue;
      state = applySkillActivationResult(state, part.result);
    }
  }

  return state;
}

export function extractSkillId(result: unknown): string | undefined {
  const activation = getSkillActivationResult(result);
  if (!activation) return undefined;
  const skillId = readToolResultOwnDataProperty(activation, "skillId");
  return typeof skillId === "string" ? skillId : undefined;
}

function extractStringArrayField(
  result: Record<string, unknown>,
  field: string,
  allowedDirectories: readonly string[],
  maxEntries: number,
): readonly string[] {
  const raw = readToolResultOwnDataProperty(result, field);
  const entryCount = getBoundedArrayLength(raw, maxEntries);
  if (entryCount === null) {
    return EMPTY_SKILL_FILE_LIST;
  }

  const snapshot: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < entryCount; index += 1) {
    const value = readToolResultOwnDataProperty(raw, index);
    if (
      typeof value !== "string" ||
      normalizeStrictRuntimeSkillReferencePath(value) !== value ||
      !allowedDirectories.some((directory) => value.startsWith(`${directory}/`))
    ) {
      return EMPTY_SKILL_FILE_LIST;
    }
    if (!seen.has(value)) {
      seen.add(value);
      snapshot.push(value);
    }
  }
  return Object.freeze(snapshot);
}

export function extractSkillToolAvailability(
  result: unknown,
): SkillToolAvailability | undefined {
  const activation = getSkillActivationResult(result);
  if (!activation) return undefined;

  return Object.freeze({
    hasActiveSkill: true,
    references: extractStringArrayField(
      activation,
      "references",
      SKILL_READABLE_DIRS,
      SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
    ),
    scripts: extractStringArrayField(
      activation,
      "scripts",
      ["scripts"],
      SKILL_SUBDIR_MAX_ENTRIES,
    ),
  });
}

/** Provenance of the activation result being folded into the active skill state. */
export type SkillActivationOptions = {
  /**
   * Whether the result came from a load_skill call this runtime executed, which
   * is the only provenance that authorizes delegation overrides (model,
   * thinking, maxSteps). Defaults to false so unproven results fail closed.
   */
  trustDelegationOverrides?: boolean;
};

/** Apply only a validated body-load response; reference/error results preserve state. */
export function applySkillActivationResult(
  current: ActiveSkillState,
  result: unknown,
  options: SkillActivationOptions = {},
): ActiveSkillState {
  const activation = getSkillActivationResult(result);
  if (!activation) return current;

  try {
    return {
      activeSkillId: extractSkillId(activation),
      activeSkillToolAvailability: extractSkillToolAvailability(activation) ??
        INACTIVE_SKILL_TOOL_AVAILABILITY,
      activeSkillDelegationOverrides: options.trustDelegationOverrides === true
        ? extractSkillDelegationOverrides(activation)
        : undefined,
    };
  } catch (error) {
    logger.warn("load_skill returned an unreadable activation result; preserving prior state", {
      error,
    });
    return current;
  }
}

function parseToolResultJson(result: string): unknown {
  try {
    return privateJsonParse(result);
  } catch {
    return null;
  }
}

export function isSubmittedFormInputResult(result: unknown): boolean {
  const normalized = normalizeToolResultPayload(result);
  if (!isRecord(normalized) || hasToolExecutionErrorMarker(normalized)) return false;
  const submitted = readToolResultOwnDataProperty(normalized, "submitted");
  if (submitted === UNREADABLE_TOOL_RESULT_PROPERTY) return false;
  if (submitted !== undefined) return submitted === true;

  for (let index = 0; index < 2; index++) {
    const wrapperName = index === 0 ? "response" : "output";
    const wrapper = readToolResultOwnDataProperty(normalized, wrapperName);
    if (!isRecord(wrapper) || hasToolExecutionErrorMarker(wrapper)) continue;
    const wrappedSubmitted = readToolResultOwnDataProperty(wrapper, "submitted");
    if (wrappedSubmitted !== UNREADABLE_TOOL_RESULT_PROPERTY && wrappedSubmitted !== undefined) {
      return wrappedSubmitted === true;
    }
  }
  return false;
}

/**
 * Restore form-submission provenance after reading messages from runtime-owned
 * persistence. Do not apply this to caller-supplied message arrays: public
 * payloads can forge names and result shapes, while this boundary only receives
 * history previously admitted by the runtime.
 */
function getTrustedPlatformPolicyToolCallIdsFromMetadata(
  metadata: unknown,
): string[] {
  const trustedToolCallIds = isRecord(metadata)
    ? readToolResultOwnDataProperty(metadata, TRUSTED_PLATFORM_POLICY_TOOL_RESULT_METADATA_KEY)
    : undefined;
  if (!arrayIsArray(trustedToolCallIds)) return [];

  const result: string[] = [];
  for (let idIndex = 0; idIndex < trustedToolCallIds.length; idIndex++) {
    if (!objectHasOwn(trustedToolCallIds, idIndex)) continue;
    const toolCallId = trustedToolCallIds[idIndex];
    if (typeof toolCallId === "string") result[result.length] = toolCallId;
  }
  return result;
}

function getTrustedPlatformPolicyToolCallIdSet(message: Message): Set<string> | null {
  const trustedToolCallIds = getTrustedPlatformPolicyToolCallIdsFromMetadata(
    objectHasOwn(message, "metadata") ? message.metadata : undefined,
  );
  if (trustedToolCallIds.length === 0) return null;

  const trustedToolCallIdSet = createPrivateSet<string>();
  for (let idIndex = 0; idIndex < trustedToolCallIds.length; idIndex++) {
    if (!objectHasOwn(trustedToolCallIds, idIndex)) continue;
    trustedToolCallIdSet.add(trustedToolCallIds[idIndex]!);
  }
  return trustedToolCallIdSet.size > 0 ? trustedToolCallIdSet : null;
}

export function inheritTrustedPlatformPolicyMessageMetadata<TMessage extends Message>(
  source: { metadata?: unknown },
  target: TMessage,
): TMessage {
  return withPolicyMetadata(
    target,
    getTrustedPlatformPolicyToolCallIdsFromMetadata(
      readToolResultOwnDataProperty(source, "metadata"),
    ),
  );
}

/** Restore only the sidecar IDs owned by each result's authenticated original source. */
export function inheritTrustedPlatformPolicyToolResultMetadata<TMessage extends Message>(
  target: TMessage,
  getTrustedSource: (sourceId: string) => { metadata?: unknown } | null | undefined,
): TMessage {
  const toolCallIds: string[] = [];
  for (let index = 0; index < target.parts.length; index++) {
    if (!objectHasOwn(target.parts, index)) continue;
    const part = target.parts[index]!;
    if (!isToolResultPart(part)) continue;
    const sourceId = getToolResultSource(part);
    if (sourceId === undefined) continue;
    const source = getTrustedSource(sourceId);
    if (!source) continue;
    const sourceIds = getTrustedPlatformPolicyToolCallIdsFromMetadata(
      readToolResultOwnDataProperty(source, "metadata"),
    );
    for (let sourceIndex = 0; sourceIndex < sourceIds.length; sourceIndex++) {
      if (sourceIds[sourceIndex] === part.toolCallId) {
        toolCallIds[toolCallIds.length] = part.toolCallId;
        break;
      }
    }
  }
  const restoredMessage = withPolicyMetadata(target, toolCallIds);
  if (toolCallIds.length > 0) {
    const inheritedIds = createPrivateSet<string>();
    for (let index = 0; index < toolCallIds.length; index++) {
      inheritedIds.add(toolCallIds[index]!);
    }
    inheritedHostedPolicyToolResultIds.set(restoredMessage, inheritedIds);
  }
  return restoredMessage;
}

/** Reject every result sharing an ID, including malformed or differently named duplicates. */
function ambiguousResultIds(message: Message): Set<string> {
  const seen = createPrivateSet<string>();
  const duplicates = createPrivateSet<string>();
  const parts = message.parts;
  for (let index = 0; index < parts.length; index++) {
    if (!objectHasOwn(parts, index)) continue;
    const part = parts[index];
    if (readToolResultOwnDataProperty(part, "type") !== "tool-result") continue;
    const id = readToolResultOwnDataProperty(part, "toolCallId");
    if (typeof id !== "string") continue;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return duplicates;
}

function isOwnHistoryToolResult(part: unknown): part is ToolResultPart {
  return readToolResultOwnDataProperty(part, "type") === "tool-result" &&
    typeof readToolResultOwnDataProperty(part, "toolCallId") === "string" &&
    typeof readToolResultOwnDataProperty(part, "toolName") === "string" &&
    readToolResultOwnDataProperty(part, "result") !== UNREADABLE_TOOL_RESULT_PROPERTY;
}

function countHistoryToolResultIds(
  messages: readonly Message[],
  messageCount: number,
  shouldCount: (message: Message, part: ToolResultPart) => boolean,
): Map<string, number> {
  const counts = createPrivateMap<string, number>();
  for (let index = 0; index < messageCount; index++) {
    if (!objectHasOwn(messages, index)) continue;
    const message = messages[index]!;
    const parts = readToolResultOwnDataProperty(message, "parts");
    if (!arrayIsArray(parts)) continue;
    const length = readToolResultOwnDataProperty(parts, "length");
    if (typeof length !== "number") continue;
    for (let partIndex = 0; partIndex < length; partIndex++) {
      if (!objectHasOwn(parts, partIndex)) continue;
      const part = readToolResultOwnDataProperty(parts, partIndex);
      if (!isOwnHistoryToolResult(part)) continue;
      const id = readToolResultOwnDataProperty(part, "toolCallId");
      if (typeof id === "string" && shouldCount(message, part)) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function restoreTrustedPlatformPolicyResultsFromPersistedMessage(
  message: Message,
  isTrustedSource: (part: ToolResultPart) => boolean = () => true,
): void {
  const trustedToolCallIdSet = getTrustedPlatformPolicyToolCallIdSet(message);
  if (!trustedToolCallIdSet) return;
  const duplicates = ambiguousResultIds(message);
  const parts = message.parts;
  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    if (!objectHasOwn(parts, partIndex)) continue;
    const part = parts[partIndex]!;
    if (
      isToolResultPart(part) && !duplicates.has(part.toolCallId) && isTrustedSource(part) &&
      trustedToolCallIdSet.has(part.toolCallId) &&
      ((isFormInputToolName(part.toolName) && isSubmittedFormInputResult(part.result)) ||
        (isLoadSkillToolName(part.toolName) && isSkillActivationResult(part.result)))
    ) {
      markTrustedPlatformPolicyToolResultPart(part);
    }
  }
}

export function restoreTrustedPlatformPolicyResultsFromPersistedHistory(
  messages: readonly Message[],
  messageCount: number = messages.length,
): void {
  const boundedMessageCount = Math.max(0, Math.min(messages.length, messageCount));
  const resultCounts = countHistoryToolResultIds(
    messages,
    boundedMessageCount,
    (message, part) =>
      getTrustedPlatformPolicyToolCallIdSet(message)?.has(part.toolCallId) === true,
  );
  for (let index = 0; index < boundedMessageCount; index++) {
    if (!objectHasOwn(messages, index)) continue;
    restoreTrustedPlatformPolicyResultsFromPersistedMessage(
      messages[index]!,
      (part) => resultCounts.get(part.toolCallId) === 1,
    );
  }
}

function getTrustedHostedLoadSkillCallMapFromAssistant(
  message: Message,
): Map<string, string> | null {
  if (message.role !== "assistant") return null;
  const trustedToolCallIdSet = getTrustedPlatformPolicyToolCallIdSet(message);
  if (!trustedToolCallIdSet) return null;

  const trustedHostedLoadSkillCalls = createPrivateMap<string, string>();
  const seenTrustedToolCallIds = createPrivateSet<string>();
  const ambiguousTrustedToolCallIds = createPrivateSet<string>();
  const parts = message.parts;
  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    if (!objectHasOwn(parts, partIndex)) continue;
    const part = parts[partIndex]!;
    if (!isRecord(part) || part.type !== "tool-call") continue;
    const toolCallId = part.toolCallId;
    if (typeof toolCallId !== "string" || !trustedToolCallIdSet.has(toolCallId)) continue;
    if (seenTrustedToolCallIds.has(toolCallId)) {
      trustedHostedLoadSkillCalls.delete(toolCallId);
      ambiguousTrustedToolCallIds.add(toolCallId);
      continue;
    }
    seenTrustedToolCallIds.add(toolCallId);
    if (ambiguousTrustedToolCallIds.has(toolCallId)) continue;

    const toolName = part.toolName;
    if (typeof toolName === "string" && isLoadSkillToolName(toolName)) {
      trustedHostedLoadSkillCalls.set(toolCallId, toolName);
    }
  }
  return trustedHostedLoadSkillCalls.size > 0 ? trustedHostedLoadSkillCalls : null;
}

function restoreAdjacentTrustedHostedLoadSkillResults(
  message: Message,
  pendingTrustedLoadSkillCalls: Map<string, string>,
  isTrustedSource: (part: ToolResultPart) => boolean,
): void {
  if (message.role !== "tool") return;
  const duplicates = ambiguousResultIds(message);
  const parts = message.parts;
  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    if (!objectHasOwn(parts, partIndex)) continue;
    const part = parts[partIndex]!;
    if (
      !isToolResultPart(part) || duplicates.has(part.toolCallId) || !isTrustedSource(part) ||
      !pendingTrustedLoadSkillCalls.has(part.toolCallId)
    ) continue;
    const expectedToolName = pendingTrustedLoadSkillCalls.get(part.toolCallId);
    pendingTrustedLoadSkillCalls.delete(part.toolCallId);
    if (
      expectedToolName === part.toolName &&
      isLoadSkillToolName(part.toolName) &&
      isSkillActivationResult(part.result)
    ) {
      markTrustedPlatformPolicyToolResultPart(part);
    }
  }
}

function createTrustedHostedHistoryMessageIdSet(
  messageIds: readonly string[] | undefined,
): Set<string> | null {
  if (!messageIds || messageIds.length === 0) return null;
  const trustedMessageIds = createPrivateSet<string>();
  for (let index = 0; index < messageIds.length; index++) {
    if (!objectHasOwn(messageIds, index)) continue;
    const messageId = messageIds[index];
    if (typeof messageId === "string") trustedMessageIds.add(messageId);
  }
  return trustedMessageIds.size > 0 ? trustedMessageIds : null;
}

/** @internal Bind a converted runtime message to its unique server-loaded UI source. */
export function inheritTrustedHostedHistorySourceIdentity<
  TSource extends object,
  TMessage extends Message,
>(
  source: TSource,
  message: TMessage,
): TMessage {
  trustedHostedSourceIdentities.set(message, source);
  return message;
}

/**
 * Restore platform provenance only from unique admitted history sources.
 * UI projections require an opaque per-result origin. Direct runtime callers
 * explicitly admit unique IDs or host-bound splits sharing a private source.
 */

export function restoreTrustedHostedPlatformPolicyResultsFromServerHistory(
  messages: readonly Message[],
  options: {
    legacyLoadSkillReplayAllowed?: boolean;
    trustedMessageIds?: readonly string[];
    /** Original UI sources, before one source can project into assistant and tool messages. */
    sourceMessages?: readonly Pick<ChatUiMessage, "id">[];
  } = {},
): void {
  const trustedMessageIds = createTrustedHostedHistoryMessageIdSet(options.trustedMessageIds);
  if (!trustedMessageIds) return;
  const sourceCounts = createPrivateMap<string, number>();
  const sources = options.sourceMessages ?? messages;
  for (let index = 0; index < sources.length; index++) {
    if (!objectHasOwn(sources, index)) continue;
    const id = readToolResultOwnDataProperty(sources[index], "id");
    if (typeof id === "string") sourceCounts.set(id, (sourceCounts.get(id) ?? 0) + 1);
  }

  const observedMessages = createPrivateMap<string, Message>();
  const duplicateIds = createPrivateSet<string>();
  for (let index = 0; index < messages.length; index++) {
    if (!objectHasOwn(messages, index)) continue;
    const message = messages[index]!;
    const id = readToolResultOwnDataProperty(message, "id");
    if (typeof id !== "string" || !trustedMessageIds.has(id)) continue;
    const previous = observedMessages.get(id);
    if (!previous) {
      observedMessages.set(id, message);
      continue;
    }
    // One UI tool result becomes an assistant call and a tool response with the same source ID.
    // Permit that host-produced split only when both messages have the same private source identity.
    const source = trustedHostedSourceIdentities.get(previous);
    if (!source || source !== trustedHostedSourceIdentities.get(message)) {
      duplicateIds.add(id);
    }
  }

  const isAdmittedResultSource = (message: Message, part: ToolResultPart): boolean => {
    const messageId = readToolResultOwnDataProperty(message, "id");
    const sourceId = getToolResultSource(part) ??
      (options.sourceMessages === undefined && typeof messageId === "string"
        ? messageId
        : undefined);
    return sourceId !== undefined && trustedMessageIds.has(sourceId) &&
      (options.sourceMessages === undefined
        ? observedMessages.has(sourceId) && !duplicateIds.has(sourceId)
        : sourceCounts.get(sourceId) === 1);
  };
  const resultCounts = countHistoryToolResultIds(messages, messages.length, isAdmittedResultSource);

  let pendingTrustedLoadSkillCalls: Map<string, string> | null = null;
  for (let index = 0; index < messages.length; index++) {
    if (!objectHasOwn(messages, index)) continue;
    const message = messages[index]!;
    const messageId = readToolResultOwnDataProperty(message, "id");
    const messageIsTrustedHistory = typeof messageId === "string" &&
      trustedMessageIds.has(messageId) && !duplicateIds.has(messageId) &&
      (options.sourceMessages === undefined || sourceCounts.get(messageId) === 1);
    const isTrustedResultSource = (part: ToolResultPart): boolean =>
      resultCounts.get(part.toolCallId) === 1 && isAdmittedResultSource(message, part);

    const inheritedResultIds = inheritedHostedPolicyToolResultIds.get(message);
    restoreTrustedPlatformPolicyResultsFromPersistedMessage(
      message,
      (part) =>
        isTrustedResultSource(part) &&
        (messageIsTrustedHistory || inheritedResultIds?.has(part.toolCallId) === true),
    );
    if (message.role === "assistant" && messageIsTrustedHistory) {
      pendingTrustedLoadSkillCalls = getTrustedHostedLoadSkillCallMapFromAssistant(message);
    } else if (message.role === "tool") {
      if (pendingTrustedLoadSkillCalls) {
        restoreAdjacentTrustedHostedLoadSkillResults(
          message,
          pendingTrustedLoadSkillCalls,
          isTrustedResultSource,
        );
        if (pendingTrustedLoadSkillCalls.size === 0) pendingTrustedLoadSkillCalls = null;
      } else {
        pendingTrustedLoadSkillCalls = null;
      }
    } else {
      pendingTrustedLoadSkillCalls = null;
    }

    const duplicates = ambiguousResultIds(message);
    const parts = message.parts;
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      if (!objectHasOwn(parts, partIndex)) continue;
      const part = parts[partIndex]!;
      if (
        isToolResultPart(part) && !duplicates.has(part.toolCallId) && isTrustedResultSource(part) &&
        (
          (part.toolName === CANONICAL_FORM_INPUT_TOOL_ID &&
            isSubmittedFormInputResult(part.result)) ||
          ((part.toolName === CANONICAL_LOAD_SKILL_TOOL_ID ||
            (options.legacyLoadSkillReplayAllowed === true &&
              part.toolName === LOAD_SKILL_TOOL_ID)) &&
            isSkillActivationResult(part.result))
        )
      ) {
        markTrustedPlatformPolicyToolResultPart(part);
      }
    }
  }
}

function latestUserMessageIndex(messages: readonly Message[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (!objectHasOwn(messages, index)) continue;
    if (messages[index] && isGenuineUserTurnMessage(messages[index]!)) {
      return index;
    }
  }

  return -1;
}

export function hasSubmittedFormInputResult(messages: readonly Message[]): boolean {
  const startIndex = latestUserMessageIndex(messages) + 1;

  for (let index = startIndex; index < messages.length; index++) {
    if (!objectHasOwn(messages, index)) continue;
    const parts = messages[index]!.parts;
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      if (!objectHasOwn(parts, partIndex)) continue;
      const part = parts[partIndex]!;
      if (
        isToolResultPart(part) &&
        hasTrustedPlatformPolicyToolResultPart(part) &&
        isFormInputToolName(part.toolName) &&
        isSubmittedFormInputResult(part.result)
      ) return true;
    }
  }
  return false;
}

export function filterToolsAfterSubmittedFormInput(
  tools: readonly ToolDefinition[],
  messages: readonly Message[],
  runtimeContext?: Record<string, unknown>,
  activeSkill?: {
    id?: string;
    toolAvailability?: SkillToolAvailability;
  },
): ToolDefinition[] {
  const hasSubmittedFormInput = hasSubmittedFormInputResult(messages) ||
    runtimeContext?.[SUBMITTED_FORM_INPUT_CONTEXT_KEY] === true;
  if (!hasSubmittedFormInput) {
    const snapshot: ToolDefinition[] = [];
    for (let index = 0; index < tools.length; index++) {
      const tool = tools[index];
      if (tool !== undefined) snapshot[snapshot.length] = tool;
    }
    return snapshot;
  }

  const activeSkillReferences = getActiveSkillReferenceSnapshot(
    activeSkill?.id,
    activeSkill?.toolAvailability,
  );
  const filtered: ToolDefinition[] = [];
  for (let index = 0; index < tools.length; index++) {
    const tool = tools[index];
    if (tool === undefined) continue;
    if (
      POST_SUBMITTED_FORM_INPUT_BLOCKED_TOOL_IDS.has(tool.name) &&
      isTrustedPlatformPolicyTool(tool.name, tool)
    ) {
      continue;
    }
    if (!isLoadSkillToolName(tool.name) || !isTrustedPlatformPolicyTool(tool.name, tool)) {
      filtered[filtered.length] = tool;
      continue;
    }
    if (!activeSkill?.id || activeSkillReferences.length === 0) {
      continue;
    }
    filtered[filtered.length] = markTrustedPlatformPolicyToolDefinition({
      ...tool,
      parameters: {
        type: "object",
        properties: {
          skillId: { type: "string", enum: [activeSkill.id] },
          file: { type: "string", enum: activeSkillReferences },
        },
        required: ["skillId", "file"],
        additionalProperties: false,
      },
    });
  }
  return filtered;
}

export type SkillPolicyResult =
  | { allowed: true }
  | { allowed: false; error: string };

export type SkillPolicyOptions = {
  hasSubmittedFormInput?: boolean;
  skillToolAvailability?: SkillToolAvailability;
  activeSkillId?: string;
  toolInput?: unknown;
  toolDefinition?: ToolDefinition;
};

function isActiveSkillReferenceLoad(options: SkillPolicyOptions): boolean {
  if (
    !options.activeSkillId ||
    !isRecord(options.toolInput) ||
    !isRecord(options.skillToolAvailability) ||
    readToolResultOwnDataProperty(options.skillToolAvailability, "hasActiveSkill") !== true
  ) {
    return false;
  }
  const skillId = readToolResultOwnDataProperty(options.toolInput, "skillId");
  const file = readToolResultOwnDataProperty(options.toolInput, "file");
  if (
    skillId !== options.activeSkillId ||
    typeof file !== "string" ||
    normalizeStrictRuntimeSkillReferencePath(file) !== file
  ) {
    return false;
  }

  return getActiveSkillReferenceSnapshot(
    options.activeSkillId,
    options.skillToolAvailability,
  ).includes(file);
}

/** Identify a valid skill-body activation call without confusing reference reads for activation. */
export function isSkillBodyLoadRequest(toolName: string, input: unknown): boolean {
  if (!isLoadSkillToolName(toolName) || !isRecord(input)) return false;
  const skillId = readToolResultOwnDataProperty(input, "skillId");
  const file = readToolResultOwnDataProperty(input, "file");
  return typeof skillId === "string" && skillId.length > 0 && file === undefined;
}

export function enforceSkillPolicy(
  toolName: string,
  options: SkillPolicyOptions = {},
): SkillPolicyResult {
  if (
    options.hasSubmittedFormInput === true &&
    POST_SUBMITTED_FORM_INPUT_BLOCKED_TOOL_IDS.has(toolName) &&
    isTrustedPlatformPolicyTool(toolName, options.toolDefinition)
  ) {
    return {
      allowed: false,
      error:
        `Tool "${toolName}" cannot run after a submitted form_input result exists. Continue with the submitted values.`,
    };
  }

  if (
    options.hasSubmittedFormInput === true &&
    isLoadSkillToolName(toolName) &&
    isTrustedPlatformPolicyTool(toolName, options.toolDefinition) &&
    !isActiveSkillReferenceLoad(options)
  ) {
    return {
      allowed: false,
      error:
        `Tool "${toolName}" cannot load or switch skill bodies after form_input was submitted. Only an advertised reference file from the active skill may be loaded.`,
    };
  }

  if (!isSkillToolAvailable(toolName, options.skillToolAvailability)) {
    // The two cases need different remedies and the model acts on this text: with
    // no skill loaded it should call load_skill, while a loaded skill that
    // advertises no matching file cannot be fixed by retrying.
    const hasActiveSkill =
      readToolResultOwnDataProperty(options.skillToolAvailability, "hasActiveSkill") === true;
    return {
      allowed: false,
      error: hasActiveSkill
        ? `Tool "${toolName}" is unavailable because the active skill advertises no matching file.`
        : `Tool "${toolName}" is unavailable because no skill is loaded. Call load_skill first.`,
    };
  }

  return { allowed: true };
}
