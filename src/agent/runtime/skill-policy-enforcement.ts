import type { Message } from "../types.ts";
import type { ToolDefinition } from "#veryfront/tool";
import { serverLogger } from "#veryfront/utils";
import {
  isSkillToolAvailable,
  type SkillToolAvailability,
} from "#veryfront/skill/allowed-tools.ts";
import {
  SKILL_DOCUMENT_MAX_CHARACTERS,
  SKILL_ID_MAX_LENGTH,
  SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
  SKILL_SUBDIR_MAX_ENTRIES,
} from "#veryfront/skill/limits.ts";
import { SKILL_READABLE_DIRS } from "#veryfront/skill/types.ts";
import { hasControlCharacters, isWellFormedUtf16 } from "#veryfront/skill/string-safety.ts";
import {
  hasToolExecutionErrorMarker,
  readToolResultOwnDataProperty,
  UNREADABLE_TOOL_RESULT_PROPERTY,
} from "#veryfront/tool/result.ts";
import { isToolResultPart } from "./tool-result-continuation.ts";
import { normalizeStrictRuntimeSkillReferencePath } from "./skill-metadata.ts";
import {
  extractSkillDelegationOverrides,
  type SkillDelegationOverrides,
} from "./skill-delegation-overrides.ts";
import { isGenuineUserTurnMessage } from "./runtime-message-origin.ts";

const logger = serverLogger.component("agent");

export const LOAD_SKILL_TOOL_ID = "load_skill";
export const FORM_INPUT_TOOL_ID = "form_input";
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
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  try {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  } catch {
    return false;
  }
}

function getBoundedArrayLength(value: unknown, maxEntries: number): number | null {
  try {
    if (!Array.isArray(value)) return null;
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

function isSkillActivationResult(result: unknown): result is Record<string, unknown> {
  if (!isRecord(result) || hasToolExecutionErrorMarker(result)) return false;
  const skillId = readToolResultOwnDataProperty(result, "skillId");
  const instructions = readToolResultOwnDataProperty(result, "instructions");
  return typeof skillId === "string" &&
    skillId.length > 0 &&
    skillId.length <= SKILL_ID_MAX_LENGTH &&
    isWellFormedUtf16(skillId) &&
    !hasControlCharacters(skillId) &&
    typeof instructions === "string" &&
    instructions.length <= SKILL_DOCUMENT_MAX_CHARACTERS &&
    isWellFormedUtf16(instructions);
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

  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolResultPart(part) || part.toolName !== LOAD_SKILL_TOOL_ID) continue;
      state = applySkillActivationResult(state, part.result);
    }
  }

  return state;
}

export function extractSkillId(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  const skillId = readToolResultOwnDataProperty(result, "skillId");
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
  if (!isSkillActivationResult(result)) return undefined;

  return Object.freeze({
    hasActiveSkill: true,
    references: extractStringArrayField(
      result,
      "references",
      SKILL_READABLE_DIRS,
      SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
    ),
    scripts: extractStringArrayField(
      result,
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
  if (!isSkillActivationResult(result)) return current;

  try {
    return {
      activeSkillId: extractSkillId(result),
      activeSkillToolAvailability: extractSkillToolAvailability(result) ??
        INACTIVE_SKILL_TOOL_AVAILABILITY,
      activeSkillDelegationOverrides: options.trustDelegationOverrides === true
        ? extractSkillDelegationOverrides(result)
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
    return JSON.parse(result);
  } catch {
    return null;
  }
}

export function isSubmittedFormInputResult(result: unknown): boolean {
  const normalized = typeof result === "string" ? parseToolResultJson(result) : result;
  if (!isRecord(normalized) || hasToolExecutionErrorMarker(normalized)) return false;
  const submitted = readToolResultOwnDataProperty(normalized, "submitted");
  if (submitted === UNREADABLE_TOOL_RESULT_PROPERTY) return false;
  if (submitted !== undefined) return submitted === true;

  for (const wrapperName of ["response", "output"]) {
    const wrapper = readToolResultOwnDataProperty(normalized, wrapperName);
    if (!isRecord(wrapper) || hasToolExecutionErrorMarker(wrapper)) continue;
    const wrappedSubmitted = readToolResultOwnDataProperty(wrapper, "submitted");
    if (wrappedSubmitted !== UNREADABLE_TOOL_RESULT_PROPERTY && wrappedSubmitted !== undefined) {
      return wrappedSubmitted === true;
    }
  }
  return false;
}

function latestUserMessageIndex(messages: readonly Message[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index] && isGenuineUserTurnMessage(messages[index]!)) {
      return index;
    }
  }

  return -1;
}

export function hasSubmittedFormInputResult(messages: readonly Message[]): boolean {
  const startIndex = latestUserMessageIndex(messages) + 1;

  return messages.slice(startIndex).some((message) =>
    message.parts.some((part) =>
      isToolResultPart(part) &&
      part.toolName === FORM_INPUT_TOOL_ID &&
      isSubmittedFormInputResult(part.result)
    )
  );
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
    return [...tools];
  }

  const activeSkillReferences = getActiveSkillReferenceSnapshot(
    activeSkill?.id,
    activeSkill?.toolAvailability,
  );
  return tools.flatMap((tool) => {
    if (POST_SUBMITTED_FORM_INPUT_BLOCKED_TOOL_IDS.has(tool.name)) {
      return [];
    }
    if (tool.name !== LOAD_SKILL_TOOL_ID) {
      return [tool];
    }
    if (!activeSkill?.id || activeSkillReferences.length === 0) {
      return [];
    }
    return [{
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
    }];
  });
}

export type SkillPolicyResult =
  | { allowed: true }
  | { allowed: false; error: string };

export type SkillPolicyOptions = {
  hasSubmittedFormInput?: boolean;
  skillToolAvailability?: SkillToolAvailability;
  activeSkillId?: string;
  toolInput?: unknown;
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
  if (toolName !== LOAD_SKILL_TOOL_ID || !isRecord(input)) return false;
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
    POST_SUBMITTED_FORM_INPUT_BLOCKED_TOOL_IDS.has(toolName)
  ) {
    return {
      allowed: false,
      error:
        `Tool "${toolName}" cannot run after a submitted form_input result exists. Continue with the submitted values.`,
    };
  }

  if (
    options.hasSubmittedFormInput === true &&
    toolName === LOAD_SKILL_TOOL_ID &&
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
