import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import { INPUT_VALIDATION_FAILED } from "#veryfront/errors";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { SKILL_LOADABLE_REFERENCE_MAX_ENTRIES } from "#veryfront/skill/limits.ts";
import type { Tool, ToolExecutionContext } from "#veryfront/tool/types.ts";
import { zodToJsonSchema } from "#veryfront/tool/schema/zod-json-schema.ts";
import {
  LOAD_SKILL_CONTINUE_SAME_TURN,
  LOAD_SKILL_DELEGATION_THRESHOLD,
  LOAD_SKILL_OVERRIDE_FORWARDING,
  LOAD_SKILL_ROOT_OWNERSHIP,
  LOAD_SKILL_TOOL_INTERSECTION,
} from "../conversation/delegation-policy.ts";
import {
  listRuntimeBuiltinSkillReferences,
  readRuntimeBuiltinSkill,
  readRuntimeBuiltinSkillReferenceFile,
} from "./builtin-skill-files.ts";
import type {
  RuntimeLoadedProjectSkill,
  RuntimeProjectSkillContext,
  RuntimeProjectSkillLoader,
} from "./project-skill-loader.ts";
import {
  buildStrictRuntimeLoadedSkillResponse,
  normalizeStrictRuntimeSkillReferencePath,
  type RuntimeLoadedSkillResponse,
  type RuntimeLoadedSkillResponseMessages,
  type RuntimeSkillMetadataLogger,
} from "./skill-metadata.ts";

/** Legacy continuation-note fallback used when runtime tool inventory is unavailable. */
export const RUNTIME_LOAD_SKILL_CONTINUATION_NOTE =
  `IMPORTANT: load_skill only loads instructions. It does not perform the task or finish the turn. ${LOAD_SKILL_CONTINUE_SAME_TURN} ${LOAD_SKILL_ROOT_OWNERSHIP} For multi-step or isolated work, call invoke_agent; otherwise keep working directly with the allowed tools. ${LOAD_SKILL_DELEGATION_THRESHOLD} ${LOAD_SKILL_OVERRIDE_FORWARDING} ${LOAD_SKILL_TOOL_INTERSECTION}`;

/** Shared runtime load skill description value. */
export const RUNTIME_LOAD_SKILL_DESCRIPTION =
  `Load the full instructions for a skill. Use this when you need detailed guidance for a specific task type. If the skill specifies allowed-tools, you MUST only use those tools while following this skill. load_skill does not perform the task by itself. ${LOAD_SKILL_CONTINUE_SAME_TURN} ${LOAD_SKILL_ROOT_OWNERSHIP} ${LOAD_SKILL_DELEGATION_THRESHOLD} First call load_skill with only skillId. Use the optional \`file\` parameter only after the skill is loaded and only for a reference file listed by that loaded skill.`;

const DEFAULT_RUNTIME_LOAD_SKILL_RESPONSE_MESSAGES: RuntimeLoadedSkillResponseMessages = {
  allowedToolsNote:
    "IMPORTANT: While following this skill, you MUST only use the tools listed in allowedTools.",
  noCurrentRunToolsNote:
    "IMPORTANT: While following this skill, no direct-execution tools from this skill are available in the current run. allowedTools is intentionally empty; do not attempt direct tool execution in this run.",
  unavailableCurrentRunToolsDelegationNote:
    "IMPORTANT: Some tools required by this skill are not available in the current run. Use an available scoped agent_<id> delegation tool for the isolated work, or invoke_agent only when that exact legacy tool is present.",
  overrideNote: LOAD_SKILL_OVERRIDE_FORWARDING,
  referenceNote:
    "After this skill is loaded, use load_skill with the `file` parameter only for one of these listed reference files.",
};

function getAvailableScopedDelegateToolNames(availableToolNames?: readonly string[]): string[] {
  return (availableToolNames ?? [])
    .filter((toolName) => toolName.startsWith("agent_"))
    .sort();
}

function buildRuntimeLoadSkillDelegationAdvice(availableToolNames?: readonly string[]): string {
  if (availableToolNames === undefined) {
    return `For multi-step or isolated work, call invoke_agent; otherwise keep working directly with the allowed tools. ${LOAD_SKILL_DELEGATION_THRESHOLD} ${LOAD_SKILL_OVERRIDE_FORWARDING}`;
  }

  const scopedDelegateToolNames = getAvailableScopedDelegateToolNames(availableToolNames);
  if (scopedDelegateToolNames.length > 0) {
    const tools = scopedDelegateToolNames.map((toolName) => `\`${toolName}\``).join(", ");
    return `For multi-step or isolated work, use only these available scoped delegation tools: ${tools}; otherwise keep working directly with the allowed tools. ${LOAD_SKILL_DELEGATION_THRESHOLD}`;
  }

  if (availableToolNames.includes("invoke_agent")) {
    return `For multi-step or isolated work, call the available legacy invoke_agent tool; otherwise keep working directly with the allowed tools. ${LOAD_SKILL_DELEGATION_THRESHOLD} ${LOAD_SKILL_OVERRIDE_FORWARDING}`;
  }

  return "";
}

function buildRuntimeLoadSkillContinuationNote(availableToolNames?: readonly string[]): string {
  const delegationAdvice = buildRuntimeLoadSkillDelegationAdvice(availableToolNames);
  return [
    "IMPORTANT: load_skill only loads instructions. It does not perform the task or finish the turn.",
    LOAD_SKILL_CONTINUE_SAME_TURN,
    LOAD_SKILL_ROOT_OWNERSHIP,
    delegationAdvice,
    LOAD_SKILL_TOOL_INTERSECTION,
  ].filter((part) => part.length > 0).join(" ");
}

function buildUnavailableCurrentRunToolsDelegationNote(
  availableToolNames?: readonly string[],
): string {
  if (availableToolNames === undefined) {
    return DEFAULT_RUNTIME_LOAD_SKILL_RESPONSE_MESSAGES.unavailableCurrentRunToolsDelegationNote;
  }

  const scopedDelegateToolNames = getAvailableScopedDelegateToolNames(availableToolNames);
  if (scopedDelegateToolNames.length > 0) {
    const tools = scopedDelegateToolNames.map((toolName) => `\`${toolName}\``).join(", ");
    return `IMPORTANT: Some tools required by this skill are not available in the current run. Use only these available scoped delegation tools for isolated work: ${tools}.`;
  }

  if (availableToolNames.includes("invoke_agent")) {
    return "IMPORTANT: Some tools required by this skill are not available in the current run. Use the available legacy invoke_agent tool for isolated work.";
  }

  return "";
}

/** Context for runtime load skill tool. */
export type RuntimeLoadSkillToolContext = RuntimeProjectSkillContext & {
  /** Agent identity used to enforce owner-scoped skill visibility. */
  agentId?: string;
  /**
   * Authoritative completed catalog snapshot when defined. An empty array
   * means the catalog was available but exposed no loadable skills. Omit this
   * field only when the catalog was unavailable or was not evaluated, which
   * permits direct builtin fallback.
   */
  availableSkillIds?: readonly string[];
  availableToolNames?: readonly string[];
  loadedSkillResponses?: Record<string, RuntimeLoadedSkillResponse>;
  loadedSkillReferenceResponses?: Record<string, RuntimeLoadSkillReferenceFileOutput>;
};

/** Public API contract for runtime load skill builtin store. */
export type RuntimeLoadSkillBuiltinStore = {
  readSkill: (skillsDir: string, skillId: string) => string | null;
  readReferenceFile: (skillsDir: string, skillId: string, normalizedFile: string) => string | null;
  listReferences: (skillsDir: string, skillId: string) => string[];
};

/** Public API contract for runtime load skill tool messages. */
export type RuntimeLoadSkillToolMessages = Partial<RuntimeLoadedSkillResponseMessages>;

/** Options accepted by runtime load skill tool. */
export type RuntimeLoadSkillToolOptions = {
  context: RuntimeLoadSkillToolContext;
  skillsDir: string;
  projectSkillLoader: RuntimeProjectSkillLoader;
  builtinSkillIds?: readonly string[];
  builtinStore?: RuntimeLoadSkillBuiltinStore;
  description?: string;
  nextStep?: string;
  messages?: RuntimeLoadSkillToolMessages;
  logger?: RuntimeSkillMetadataLogger;
};

export const getRuntimeLoadSkillToolInputSchema = defineSchema((v) =>
  v.object({
    skillId: v.string()
      .regex(
        /^[a-zA-Z0-9_-]+(?:\.md)?$/,
        'skillId must contain only letters, numbers, "_" or "-", with an optional lowercase ".md" suffix',
      )
      .describe(
        'The skill ID to load. A lowercase ".md" suffix is accepted when it is the canonical ID or an unambiguous alias (e.g., "react-components" or "react-components.md").',
      ),
    file: v.string().optional().describe(
      "Optional reference file to load. First load the skill with only skillId, then use file only for a reference path listed by that loaded skill.",
    ),
  })
);

/** @deprecated Use getRuntimeLoadSkillToolInputSchema() */
const runtimeLoadSkillToolInputSchema = lazySchema(getRuntimeLoadSkillToolInputSchema);

/** Input payload for runtime load skill tool. */
export type RuntimeLoadSkillToolInput = InferSchema<
  ReturnType<typeof getRuntimeLoadSkillToolInputSchema>
>;

/** Output from runtime load skill reference file. */
export type RuntimeLoadSkillReferenceFileOutput = {
  skillId: string;
  file: string;
  content: string;
};

/** Output from runtime load skill error. */
export type RuntimeLoadSkillErrorOutput = {
  error: string;
};

/** Output from runtime load skill tool. */
export type RuntimeLoadSkillToolOutput =
  | RuntimeLoadedSkillResponse
  | RuntimeLoadSkillReferenceFileOutput
  | RuntimeLoadSkillErrorOutput;

function getBuiltinStore(options: RuntimeLoadSkillToolOptions): RuntimeLoadSkillBuiltinStore {
  return {
    readSkill: options.builtinStore?.readSkill ?? readRuntimeBuiltinSkill,
    readReferenceFile: options.builtinStore?.readReferenceFile ??
      readRuntimeBuiltinSkillReferenceFile,
    listReferences: options.builtinStore?.listReferences ?? listRuntimeBuiltinSkillReferences,
  };
}

function getResponseMessages(
  options: RuntimeLoadSkillToolOptions,
): RuntimeLoadedSkillResponseMessages {
  return {
    allowedToolsNote: options.messages?.allowedToolsNote ??
      DEFAULT_RUNTIME_LOAD_SKILL_RESPONSE_MESSAGES.allowedToolsNote,
    noCurrentRunToolsNote: options.messages?.noCurrentRunToolsNote ??
      DEFAULT_RUNTIME_LOAD_SKILL_RESPONSE_MESSAGES.noCurrentRunToolsNote,
    unavailableCurrentRunToolsDelegationNote:
      options.messages?.unavailableCurrentRunToolsDelegationNote ??
        buildUnavailableCurrentRunToolsDelegationNote(options.context.availableToolNames),
    overrideNote: options.messages?.overrideNote ??
      DEFAULT_RUNTIME_LOAD_SKILL_RESPONSE_MESSAGES.overrideNote,
    referenceNote: options.messages?.referenceNote ??
      DEFAULT_RUNTIME_LOAD_SKILL_RESPONSE_MESSAGES.referenceNote,
  };
}

function buildLoadedSkillResponse(input: {
  options: RuntimeLoadSkillToolOptions;
  skillId: string;
  instructions: string;
  references?: readonly string[];
}): RuntimeLoadedSkillResponse {
  return buildStrictRuntimeLoadedSkillResponse({
    skillId: input.skillId,
    instructions: input.instructions,
    nextStep: input.options.nextStep ??
      buildRuntimeLoadSkillContinuationNote(input.options.context.availableToolNames),
    messages: getResponseMessages(input.options),
    references: input.references,
    availableToolNames: input.options.context.availableToolNames,
    logger: input.options.logger,
  });
}

function buildAlreadyLoadedSkillResponse(
  skillId: string,
  response: RuntimeLoadedSkillResponse,
): RuntimeLoadedSkillResponse {
  return {
    ...response,
    instructions:
      `Skill "${skillId}" is already loaded in this turn. Do not call load_skill for "${skillId}" again. ` +
      "Continue from the existing user request and any submitted tool results, then produce the next useful response now. " +
      "If a form_input result already exists, treat it as final for this turn and do not call form_input again.",
    nextStep:
      "Continue now. Do not reload this skill or restart intake; use the existing context and finish the current turn.",
    references: response.references,
  };
}

function buildMissingSkillError(
  options: RuntimeLoadSkillToolOptions,
  skillId: string,
): RuntimeLoadSkillErrorOutput {
  const available = getKnownRuntimeSkillIds(options)?.join(", ") || "none";
  return {
    error: `Skill not found: ${skillId}. Available skills: ${available}`,
  };
}

function buildAlreadyLoadedSkillReferenceResponse(
  skillId: string,
  file: string,
): RuntimeLoadSkillReferenceFileOutput {
  return {
    skillId,
    file,
    content:
      `Reference file "${skillId}/${file}" is already loaded in this turn. Do not call load_skill for this file again. ` +
      "Continue from the existing reference content and produce the next useful response now.",
  };
}

function buildRuntimeSkillCacheKey(
  context: RuntimeLoadSkillToolContext,
  skillId: string,
): string {
  return JSON.stringify([
    skillId,
    context.projectId ?? null,
    context.branchId ?? null,
    context.skillSourcePaths?.[skillId] ?? null,
  ]);
}

function buildRuntimeSkillReferenceCacheKey(
  context: RuntimeLoadSkillToolContext,
  skillId: string,
  normalizedFile: string,
): string {
  return JSON.stringify([
    buildRuntimeSkillCacheKey(context, skillId),
    normalizedFile,
  ]);
}

function readOwnDataProperty(value: unknown, key: PropertyKey): unknown {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function executionContextAdvertisesReference(
  context: ToolExecutionContext | undefined,
  skillId: string,
  file: string,
  normalizedFile: string,
): boolean {
  if (
    file !== normalizedFile ||
    readOwnDataProperty(context, "activeSkillId") !== skillId
  ) {
    return false;
  }

  const availability = readOwnDataProperty(context, "activeSkillToolAvailability");
  const references = readOwnDataProperty(availability, "references");
  if (!Array.isArray(references)) {
    return false;
  }

  try {
    const lengthDescriptor = Object.getOwnPropertyDescriptor(references, "length");
    const length = lengthDescriptor && "value" in lengthDescriptor
      ? lengthDescriptor.value
      : undefined;
    if (
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > SKILL_LOADABLE_REFERENCE_MAX_ENTRIES
    ) {
      return false;
    }

    let isAdvertised = false;
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(references, index);
      const reference = descriptor && "value" in descriptor ? descriptor.value : undefined;
      if (
        typeof reference !== "string" ||
        normalizeStrictRuntimeSkillReferencePath(reference) !== reference
      ) {
        return false;
      }
      isAdvertised ||= reference === normalizedFile;
    }
    return isAdvertised;
  } catch {
    return false;
  }
}

function hasClaimedProjectSkill(
  context: RuntimeLoadSkillToolContext,
  skillId: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(context.skillSourcePaths ?? {}, skillId);
}

function buildRuntimeLoadSkillDescription(options: RuntimeLoadSkillToolOptions): string {
  if (options.description) {
    return options.description;
  }

  const knownIds = getKnownRuntimeSkillIds(options);
  if (knownIds === null) {
    return RUNTIME_LOAD_SKILL_DESCRIPTION;
  }

  const available = knownIds.join(", ") || "none";

  return `${RUNTIME_LOAD_SKILL_DESCRIPTION} Available skill IDs: ${available}. Do not invent skill IDs. Only call load_skill with one of these IDs.`;
}

function getKnownRuntimeSkillIds(options: RuntimeLoadSkillToolOptions): string[] | null {
  const knownIds = options.context.availableSkillIds !== undefined
    ? options.context.availableSkillIds
    : options.builtinSkillIds;
  if (knownIds === undefined) {
    return null;
  }

  return [...new Set(knownIds)].sort();
}

function getLoadedRuntimeSkillIds(options: RuntimeLoadSkillToolOptions): string[] {
  return [
    ...new Set(
      Object.values(options.context.loadedSkillResponses ?? {})
        .map((response) => response.skillId)
        .filter((skillId): skillId is string => typeof skillId === "string" && skillId.length > 0),
    ),
  ].sort();
}

function getReferenceableLoadedRuntimeSkillIds(
  options: RuntimeLoadSkillToolOptions,
): string[] {
  return [
    ...new Set(
      Object.values(options.context.loadedSkillResponses ?? {})
        .filter((response) => (response.references?.length ?? 0) > 0)
        .map((response) => response.skillId)
        .filter((skillId): skillId is string => typeof skillId === "string" && skillId.length > 0),
    ),
  ].sort();
}

function getRuntimeSkillIdInputValues(
  skillIds: readonly [string, ...string[]],
  knownSkillIds: readonly string[],
): [string, ...string[]] {
  const knownSkillIdSet = new Set(knownSkillIds);
  const values = skillIds.flatMap((skillId) => {
    const alias = `${skillId}.md`;
    return skillId.endsWith(".md") || knownSkillIdSet.has(alias) ? [skillId] : [skillId, alias];
  });
  return values as [string, ...string[]];
}

function normalizeRuntimeLoadSkillInputSkillId(
  options: RuntimeLoadSkillToolOptions,
  skillId: string,
): string {
  const knownSkillIds = getKnownRuntimeSkillIds(options);
  if (knownSkillIds?.includes(skillId)) {
    return skillId;
  }

  const aliasTarget = skillId.endsWith(".md") ? skillId.slice(0, -3) : null;
  if (aliasTarget && (!knownSkillIds || knownSkillIds.includes(aliasTarget))) {
    return aliasTarget;
  }

  return skillId;
}

function buildRuntimeLoadSkillInputSchema(options: RuntimeLoadSkillToolOptions) {
  const knownIds = getKnownRuntimeSkillIds(options);
  if (!knownIds || knownIds.length === 0) {
    return runtimeLoadSkillToolInputSchema;
  }

  const knownIdSet = new Set(knownIds);
  const loadedIds = getLoadedRuntimeSkillIds(options).filter((skillId) => knownIdSet.has(skillId));
  const loadedIdSet = new Set(loadedIds);
  const referenceableLoadedIds = getReferenceableLoadedRuntimeSkillIds(options)
    .filter((skillId) => knownIdSet.has(skillId));
  const unloadedIds = knownIds.filter((skillId) => !loadedIdSet.has(skillId));

  if (
    loadedIds.length > 0 && unloadedIds.length === 0 && referenceableLoadedIds.length === 0
  ) {
    const [firstLoaded, ...restLoaded] = loadedIds as [string, ...string[]];
    const loadedEnumValues = getRuntimeSkillIdInputValues(
      [firstLoaded, ...restLoaded],
      knownIds,
    );
    return defineSchema((v) =>
      v.object({
        skillId: v.enum(loadedEnumValues).describe(
          `Already-loaded skill ID with no advertised reference files. Calling load_skill again is a no-op. Loaded skill IDs: ${
            loadedEnumValues.join(", ")
          }`,
        ),
      }).strict()
    )();
  }

  if (referenceableLoadedIds.length > 0 && unloadedIds.length === 0) {
    const [firstLoaded, ...restLoaded] = referenceableLoadedIds as [string, ...string[]];
    const loadedEnumValues = getRuntimeSkillIdInputValues(
      [firstLoaded, ...restLoaded],
      knownIds,
    );
    return defineSchema((v) =>
      v.object({
        skillId: v.enum(loadedEnumValues).describe(
          `Already-loaded skill ID. Body reloads are not allowed; use this only with file for listed references. Loaded skill IDs: ${
            loadedEnumValues.join(", ")
          }`,
        ),
        file: v.string().describe(
          "Required reference file to load from an already-loaded skill. Do not call load_skill again for the skill body.",
        ),
      })
    )();
  }

  if (referenceableLoadedIds.length > 0) {
    const [firstUnloaded, ...restUnloaded] = unloadedIds as [string, ...string[]];
    const unloadedEnumValues = getRuntimeSkillIdInputValues(
      [firstUnloaded, ...restUnloaded],
      knownIds,
    );
    const [firstLoaded, ...restLoaded] = referenceableLoadedIds as [string, ...string[]];
    const loadedEnumValues = getRuntimeSkillIdInputValues(
      [firstLoaded, ...restLoaded],
      knownIds,
    );
    return defineSchema((v) =>
      v.union([
        v.object({
          skillId: v.enum(unloadedEnumValues).describe(
            `Unloaded skill ID to load. Available unloaded skill IDs: ${
              unloadedEnumValues.join(", ")
            }`,
          ),
          file: v.string().optional().describe(
            "Optional reference file to load. First load the skill with only skillId, then use file only for a reference path listed by that loaded skill.",
          ),
        }),
        v.object({
          skillId: v.enum(loadedEnumValues).describe(
            `Already-loaded skill ID. Body reloads are not allowed; use this only with file for listed references. Loaded skill IDs: ${
              loadedEnumValues.join(", ")
            }`,
          ),
          file: v.string().describe(
            "Required reference file to load from an already-loaded skill. Do not call load_skill again for the skill body.",
          ),
        }),
      ])
    )();
  }

  const [first, ...rest] = unloadedIds as [string, ...string[]];
  const enumValues = getRuntimeSkillIdInputValues([first, ...rest], knownIds);
  return defineSchema((v) =>
    v.object({
      skillId: v.enum(enumValues).describe(
        `Unloaded skill ID to load. Available unloaded skill IDs: ${enumValues.join(", ")}`,
      ),
      file: v.string().optional().describe(
        "Optional reference file to load. First load the skill with only skillId, then use file only for a reference path listed by that loaded skill.",
      ),
    })
  )();
}

async function loadRuntimeSkillReferenceFile(
  options: RuntimeLoadSkillToolOptions,
  skillId: string,
  file: string,
  executionContext?: ToolExecutionContext,
): Promise<RuntimeLoadSkillReferenceFileOutput | RuntimeLoadSkillErrorOutput> {
  const normalizedFile = normalizeStrictRuntimeSkillReferencePath(file);
  if (!normalizedFile) {
    return { error: `Invalid reference file path: ${file}` };
  }

  const loadedSkillKey = buildRuntimeSkillCacheKey(options.context, skillId);
  const loadedSkillResponse = options.context.loadedSkillResponses?.[loadedSkillKey];
  const resumedReferenceIsAdvertised = !loadedSkillResponse &&
    executionContextAdvertisesReference(
      executionContext,
      skillId,
      file,
      normalizedFile,
    );
  if (!loadedSkillResponse && !resumedReferenceIsAdvertised) {
    return {
      error: `Skill "${skillId}" must be loaded before reference file "${normalizedFile}". ` +
        `Call load_skill with only {"skillId":"${skillId}"} first, then request one of the listed reference files.`,
    };
  }

  const advertisedReferences = loadedSkillResponse?.references ??
    (resumedReferenceIsAdvertised ? [normalizedFile] : []);
  if (!advertisedReferences.includes(normalizedFile)) {
    const availableReferences = advertisedReferences.length > 0
      ? advertisedReferences.join(", ")
      : "none";
    return {
      error: `Reference file not advertised by loaded skill "${skillId}": ${normalizedFile}. ` +
        `Available references: ${availableReferences}`,
    };
  }

  const loadedSkillReferenceResponses = options.context.loadedSkillReferenceResponses ??= {};
  const referenceKey = buildRuntimeSkillReferenceCacheKey(
    options.context,
    skillId,
    normalizedFile,
  );
  if (loadedSkillReferenceResponses[referenceKey]) {
    return buildAlreadyLoadedSkillReferenceResponse(skillId, normalizedFile);
  }

  const projectFileContent = await options.projectSkillLoader.loadProjectSkillReference(
    options.context,
    skillId,
    normalizedFile,
  );
  if (projectFileContent !== null) {
    const response = { skillId, file: normalizedFile, content: projectFileContent };
    loadedSkillReferenceResponses[referenceKey] = response;
    return response;
  }

  if (hasClaimedProjectSkill(options.context, skillId)) {
    return { error: `Project skill reference not found: ${skillId}/${normalizedFile}` };
  }

  const localContent = getBuiltinStore(options).readReferenceFile(
    options.skillsDir,
    skillId,
    normalizedFile,
  );
  if (localContent !== null) {
    const response = { skillId, file: normalizedFile, content: localContent };
    loadedSkillReferenceResponses[referenceKey] = response;
    return response;
  }

  return { error: `Reference file not found: ${skillId}/${normalizedFile}` };
}

async function loadRuntimeSkillBody(
  options: RuntimeLoadSkillToolOptions,
  skillId: string,
): Promise<RuntimeLoadedProjectSkill | null> {
  return await options.projectSkillLoader.loadProjectSkill(options.context, skillId);
}

/** Create runtime load skill tool. */
export function createRuntimeLoadSkillTool(
  options: RuntimeLoadSkillToolOptions,
): Tool<RuntimeLoadSkillToolInput, RuntimeLoadSkillToolOutput> {
  const builtinStore = getBuiltinStore(options);

  async function execute(
    { skillId, file }: RuntimeLoadSkillToolInput,
    executionContext?: ToolExecutionContext,
  ) {
    let parsed: RuntimeLoadSkillToolInput;
    try {
      parsed = buildRuntimeLoadSkillInputSchema(options).parse(
        file === undefined ? { skillId } : { skillId, file },
      );
    } catch (error) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: `Tool "load_skill" input validation failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
    skillId = normalizeRuntimeLoadSkillInputSkillId(options, parsed.skillId);
    file = parsed.file;

    const knownSkillIds = getKnownRuntimeSkillIds(options);
    if (knownSkillIds !== null && !knownSkillIds.includes(skillId)) {
      return buildMissingSkillError(options, skillId);
    }

    if (file) {
      return await loadRuntimeSkillReferenceFile(
        options,
        skillId,
        file,
        executionContext,
      );
    }

    const loadedSkillResponses = options.context.loadedSkillResponses ??= {};
    const loadedSkillKey = buildRuntimeSkillCacheKey(options.context, skillId);
    const loadedResponse = loadedSkillResponses[loadedSkillKey];
    if (loadedResponse) {
      return buildAlreadyLoadedSkillResponse(skillId, loadedResponse);
    }

    const projectSkill = await loadRuntimeSkillBody(options, skillId);
    if (projectSkill) {
      const response = buildLoadedSkillResponse({
        options,
        skillId,
        instructions: projectSkill.instructions,
        references: projectSkill.references,
      });
      loadedSkillResponses[loadedSkillKey] = response;
      return response;
    }

    if (hasClaimedProjectSkill(options.context, skillId)) {
      return {
        error:
          `Project skill "${skillId}" is unavailable or no longer satisfies its validated catalog contract.`,
      };
    }

    const localContent = builtinStore.readSkill(options.skillsDir, skillId);
    if (localContent !== null) {
      const response = buildLoadedSkillResponse({
        options,
        skillId,
        instructions: localContent,
        references: builtinStore.listReferences(options.skillsDir, skillId),
      });
      loadedSkillResponses[loadedSkillKey] = response;
      return response;
    }

    return buildMissingSkillError(options, skillId);
  }

  return {
    id: "load_skill",
    type: "function",
    description: buildRuntimeLoadSkillDescription(options),
    inputSchema: runtimeLoadSkillToolInputSchema,
    get inputSchemaJson() {
      return zodToJsonSchema(buildRuntimeLoadSkillInputSchema(options));
    },
    execute,
  };
}
