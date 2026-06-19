import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { tool } from "#veryfront/tool";
import type { Tool } from "#veryfront/tool/types.ts";
import {
  LOAD_SKILL_CONTINUE_SAME_TURN,
  LOAD_SKILL_DELEGATION_THRESHOLD,
  LOAD_SKILL_OVERRIDE_FORWARDING,
  LOAD_SKILL_ROOT_OWNERSHIP,
  LOAD_SKILL_TOOL_INTERSECTION,
  LOAD_SKILL_USE_ALLOWED_TOOLS,
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
  buildRuntimeLoadedSkillResponse,
  normalizeRuntimeSkillReferencePath,
  type RuntimeLoadedSkillResponse,
  type RuntimeLoadedSkillResponseMessages,
  type RuntimeSkillMetadataLogger,
} from "./skill-metadata.ts";
import { narrowPolicyAfterSubmittedForm } from "./skill-policy-enforcement.ts";

/** Shared runtime load skill continuation note value. */
export const RUNTIME_LOAD_SKILL_CONTINUATION_NOTE =
  `IMPORTANT: load_skill only loads instructions. It does not perform the task or finish the turn. ${LOAD_SKILL_CONTINUE_SAME_TURN} ${LOAD_SKILL_ROOT_OWNERSHIP} ${LOAD_SKILL_USE_ALLOWED_TOOLS} ${LOAD_SKILL_DELEGATION_THRESHOLD} ${LOAD_SKILL_OVERRIDE_FORWARDING} ${LOAD_SKILL_TOOL_INTERSECTION}`;

/** Shared runtime load skill description value. */
export const RUNTIME_LOAD_SKILL_DESCRIPTION =
  `Load the full instructions for a skill. Use this when you need detailed guidance for a specific task type. If the skill specifies allowed-tools, you MUST only use those tools while following this skill. load_skill does not perform the task by itself. ${LOAD_SKILL_CONTINUE_SAME_TURN} ${LOAD_SKILL_ROOT_OWNERSHIP} ${LOAD_SKILL_USE_ALLOWED_TOOLS} ${LOAD_SKILL_DELEGATION_THRESHOLD} First call load_skill with only skillId. Use the optional \`file\` parameter only after the skill is loaded and only for a reference file listed by that loaded skill.`;

const DEFAULT_RUNTIME_LOAD_SKILL_RESPONSE_MESSAGES: RuntimeLoadedSkillResponseMessages = {
  allowedToolsNote:
    "IMPORTANT: While following this skill, you MUST only use the tools listed in allowedTools.",
  noCurrentRunToolsNote:
    "IMPORTANT: While following this skill, no direct-execution tools from this skill are available in the current run. allowedTools is intentionally empty; do not attempt direct tool execution in this run.",
  unavailableCurrentRunToolsDelegationNote:
    "IMPORTANT: Some tools required by this skill are not available in the current run. Use invoke_agent for the isolated work and pass delegationTools as the child tools allowlist.",
  overrideNote: LOAD_SKILL_OVERRIDE_FORWARDING,
  referenceNote:
    "After this skill is loaded, use load_skill with the `file` parameter only for one of these listed reference files.",
};

/** Context for runtime load skill tool. */
export type RuntimeLoadSkillToolContext = RuntimeProjectSkillContext & {
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
      .regex(/^[a-zA-Z0-9_-]+$/, 'skillId must contain only letters, numbers, "_" or "-"')
      .describe('The skill ID to load (e.g., "react-components", "api-design")'),
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
        DEFAULT_RUNTIME_LOAD_SKILL_RESPONSE_MESSAGES.unavailableCurrentRunToolsDelegationNote,
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
  return buildRuntimeLoadedSkillResponse({
    skillId: input.skillId,
    instructions: input.instructions,
    nextStep: input.options.nextStep ?? RUNTIME_LOAD_SKILL_CONTINUATION_NOTE,
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
  const finishAllowedTools = narrowPolicyAfterSubmittedForm(skillId, response.allowedTools);

  return {
    ...response,
    instructions:
      `Skill "${skillId}" is already loaded in this turn. Do not call load_skill for "${skillId}" again. ` +
      "Continue from the existing user request and any submitted tool results, then produce the next useful response now. " +
      "If a form_input result already exists, treat it as final for this turn and do not call form_input again.",
    nextStep:
      "Continue now. Do not reload this skill or restart intake; use the existing context and finish the current turn.",
    ...(finishAllowedTools
      ? {
        allowedTools: finishAllowedTools,
        note: finishAllowedTools.length > 0
          ? response.note
          : "IMPORTANT: Intake is complete for this turn. Do not call form_input again; finish with the existing context.",
      }
      : {}),
    references: response.references,
  };
}

function buildMissingSkillError(
  options: RuntimeLoadSkillToolOptions,
  skillId: string,
): RuntimeLoadSkillErrorOutput {
  const knownIds = new Set([
    ...(options.context.availableSkillIds ?? []),
    ...(options.builtinSkillIds ?? []),
  ]);
  const available = [...knownIds].sort().join(", ");
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

function buildRuntimeLoadSkillDescription(options: RuntimeLoadSkillToolOptions): string {
  if (options.description) {
    return options.description;
  }

  if (!options.context.availableSkillIds && !options.builtinSkillIds) {
    return RUNTIME_LOAD_SKILL_DESCRIPTION;
  }

  const knownIds = new Set([
    ...(options.context.availableSkillIds ?? []),
    ...(options.builtinSkillIds ?? []),
  ]);
  const available = [...knownIds].sort().join(", ") || "none";

  return `${RUNTIME_LOAD_SKILL_DESCRIPTION} Available skill IDs: ${available}. Do not invent skill IDs. Only call load_skill with one of these IDs.`;
}

function getKnownRuntimeSkillIds(options: RuntimeLoadSkillToolOptions): string[] | null {
  if (!options.context.availableSkillIds && !options.builtinSkillIds) {
    return null;
  }

  return [
    ...new Set([
      ...(options.context.availableSkillIds ?? []),
      ...(options.builtinSkillIds ?? []),
    ]),
  ].sort();
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

function buildRuntimeLoadSkillInputSchema(options: RuntimeLoadSkillToolOptions) {
  const knownIds = getKnownRuntimeSkillIds(options);
  if (!knownIds || knownIds.length === 0) {
    return runtimeLoadSkillToolInputSchema;
  }

  const knownIdSet = new Set(knownIds);
  const loadedIds = getLoadedRuntimeSkillIds(options).filter((skillId) => knownIdSet.has(skillId));
  const loadedIdSet = new Set(loadedIds);
  const unloadedIds = knownIds.filter((skillId) => !loadedIdSet.has(skillId));

  if (loadedIds.length > 0 && unloadedIds.length === 0) {
    const [firstLoaded, ...restLoaded] = loadedIds as [string, ...string[]];
    const loadedEnumValues = [firstLoaded, ...restLoaded] as [string, ...string[]];
    return defineSchema((v) =>
      v.object({
        skillId: v.enum(loadedEnumValues).describe(
          `Already-loaded skill ID. Body reloads are not allowed; use this only with file for listed references. Loaded skill IDs: ${
            loadedIds.join(", ")
          }`,
        ),
        file: v.string().describe(
          "Required reference file to load from an already-loaded skill. Do not call load_skill again for the skill body.",
        ),
      })
    )();
  }

  if (loadedIds.length > 0) {
    const [firstUnloaded, ...restUnloaded] = unloadedIds as [string, ...string[]];
    const unloadedEnumValues = [firstUnloaded, ...restUnloaded] as [string, ...string[]];
    const [firstLoaded, ...restLoaded] = loadedIds as [string, ...string[]];
    const loadedEnumValues = [firstLoaded, ...restLoaded] as [string, ...string[]];
    return defineSchema((v) =>
      v.union([
        v.object({
          skillId: v.enum(unloadedEnumValues).describe(
            `Unloaded skill ID to load. Available unloaded skill IDs: ${unloadedIds.join(", ")}`,
          ),
          file: v.string().optional().describe(
            "Optional reference file to load. First load the skill with only skillId, then use file only for a reference path listed by that loaded skill.",
          ),
        }),
        v.object({
          skillId: v.enum(loadedEnumValues).describe(
            `Already-loaded skill ID. Body reloads are not allowed; use this only with file for listed references. Loaded skill IDs: ${
              loadedIds.join(", ")
            }`,
          ),
          file: v.string().describe(
            "Required reference file to load from an already-loaded skill. Do not call load_skill again for the skill body.",
          ),
        }),
      ])
    )();
  }

  const [first, ...rest] = knownIds as [string, ...string[]];
  const enumValues = [first, ...rest] as [string, ...string[]];
  return defineSchema((v) =>
    v.object({
      skillId: v.enum(enumValues).describe(
        `The skill ID to load. Available skill IDs: ${knownIds.join(", ")}`,
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
): Promise<RuntimeLoadSkillReferenceFileOutput | RuntimeLoadSkillErrorOutput> {
  const normalizedFile = normalizeRuntimeSkillReferencePath(file);
  if (!normalizedFile) {
    return { error: `Invalid reference file path: ${file}` };
  }

  const loadedSkillKey = buildRuntimeSkillCacheKey(options.context, skillId);
  const loadedSkillResponse = options.context.loadedSkillResponses?.[loadedSkillKey];
  if (!loadedSkillResponse) {
    return {
      error: `Skill "${skillId}" must be loaded before reference file "${normalizedFile}". ` +
        `Call load_skill with only {"skillId":"${skillId}"} first, then request one of the listed reference files.`,
    };
  }

  const advertisedReferences = loadedSkillResponse.references ?? [];
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
  if (projectFileContent) {
    const response = { skillId, file: normalizedFile, content: projectFileContent };
    loadedSkillReferenceResponses[referenceKey] = response;
    return response;
  }

  const localContent = getBuiltinStore(options).readReferenceFile(
    options.skillsDir,
    skillId,
    normalizedFile,
  );
  if (localContent) {
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

  return tool({
    id: "load_skill",
    description: buildRuntimeLoadSkillDescription(options),
    inputSchema: buildRuntimeLoadSkillInputSchema(options),
    execute: async ({ skillId, file }) => {
      if (file) {
        return await loadRuntimeSkillReferenceFile(options, skillId, file);
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

      const localContent = builtinStore.readSkill(options.skillsDir, skillId);
      if (localContent) {
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
    },
  });
}
