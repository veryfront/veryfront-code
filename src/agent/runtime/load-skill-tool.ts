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

/** Shared runtime load skill continuation note value. */
export const RUNTIME_LOAD_SKILL_CONTINUATION_NOTE =
  `IMPORTANT: load_skill only loads instructions. It does not perform the task or finish the turn. ${LOAD_SKILL_CONTINUE_SAME_TURN} ${LOAD_SKILL_ROOT_OWNERSHIP} ${LOAD_SKILL_USE_ALLOWED_TOOLS} ${LOAD_SKILL_DELEGATION_THRESHOLD} ${LOAD_SKILL_OVERRIDE_FORWARDING} ${LOAD_SKILL_TOOL_INTERSECTION}`;

/** Shared runtime load skill description value. */
export const RUNTIME_LOAD_SKILL_DESCRIPTION =
  `Load the full instructions for a skill. Use this when you need detailed guidance for a specific task type. If the skill specifies allowed-tools, you MUST only use those tools while following this skill. load_skill does not perform the task by itself. ${LOAD_SKILL_CONTINUE_SAME_TURN} ${LOAD_SKILL_ROOT_OWNERSHIP} ${LOAD_SKILL_USE_ALLOWED_TOOLS} ${LOAD_SKILL_DELEGATION_THRESHOLD} Use the optional \`file\` parameter to load a specific reference file from the skill.`;

const DEFAULT_RUNTIME_LOAD_SKILL_RESPONSE_MESSAGES: RuntimeLoadedSkillResponseMessages = {
  allowedToolsNote:
    "IMPORTANT: While following this skill, you MUST only use the tools listed in allowedTools.",
  noCurrentRunToolsNote:
    "IMPORTANT: While following this skill, no direct-execution tools from this skill are available in the current run. allowedTools is intentionally empty; do not attempt direct tool execution in this run.",
  unavailableCurrentRunToolsDelegationNote:
    "IMPORTANT: Some tools required by this skill are not available in the current run. Use invoke_agent for the isolated work and pass delegationTools as the child tools allowlist.",
  overrideNote: LOAD_SKILL_OVERRIDE_FORWARDING,
  referenceNote: "Use load_skill with the `file` parameter to load any of these reference files.",
};

/** Context for runtime load skill tool. */
export type RuntimeLoadSkillToolContext = RuntimeProjectSkillContext & {
  availableSkillIds?: readonly string[];
  availableToolNames?: readonly string[];
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
      'Optional reference file to load (e.g. "references/quickstart.md")',
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

function buildRuntimeLoadSkillInputSchema(options: RuntimeLoadSkillToolOptions) {
  const knownIds = getKnownRuntimeSkillIds(options);
  if (!knownIds || knownIds.length === 0) {
    return runtimeLoadSkillToolInputSchema;
  }

  const [first, ...rest] = knownIds as [string, ...string[]];
  const enumValues = [first, ...rest] as [string, ...string[]];
  return defineSchema((v) =>
    v.object({
      skillId: v.enum(enumValues).describe(
        `The skill ID to load. Available skill IDs: ${knownIds.join(", ")}`,
      ),
      file: v.string().optional().describe(
        'Optional reference file to load (e.g. "references/quickstart.md")',
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

  const projectFileContent = await options.projectSkillLoader.loadProjectSkillReference(
    options.context,
    skillId,
    normalizedFile,
  );
  if (projectFileContent) {
    return { skillId, file: normalizedFile, content: projectFileContent };
  }

  const localContent = getBuiltinStore(options).readReferenceFile(
    options.skillsDir,
    skillId,
    normalizedFile,
  );
  if (localContent) {
    return { skillId, file: normalizedFile, content: localContent };
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

      const projectSkill = await loadRuntimeSkillBody(options, skillId);
      if (projectSkill) {
        return buildLoadedSkillResponse({
          options,
          skillId,
          instructions: projectSkill.instructions,
          references: projectSkill.references,
        });
      }

      const localContent = builtinStore.readSkill(options.skillsDir, skillId);
      if (localContent) {
        return buildLoadedSkillResponse({
          options,
          skillId,
          instructions: localContent,
          references: builtinStore.listReferences(options.skillsDir, skillId),
        });
      }

      return buildMissingSkillError(options, skillId);
    },
  });
}
