import type { Tool } from "#veryfront/tool";
import { HostedServiceAuthError, isHostedServiceAuthError } from "../service/auth.ts";
import {
  listRuntimeBuiltinSkillReferences,
  readRuntimeBuiltinSkill,
  readRuntimeBuiltinSkillReferenceFile,
} from "../runtime/builtin-skill-files.ts";
import {
  createRuntimeLoadSkillTool,
  type RuntimeLoadSkillBuiltinStore,
  type RuntimeLoadSkillToolContext,
  type RuntimeLoadSkillToolInput,
  type RuntimeLoadSkillToolOutput,
} from "../runtime/load-skill-tool.ts";
import type { MutableAgentProjectContext } from "../project/context.ts";
import {
  createRuntimeProjectFilesClient,
  type RuntimeProjectFilesClient,
  type RuntimeProjectFilesClientOptions,
  type RuntimeProjectFilesFetch,
  type RuntimeProjectFilesTrace,
} from "../runtime/project-files-client.ts";
import {
  getRuntimeProjectInstructions,
  getRuntimeProjectSkillCatalog,
  loadRuntimeBuiltinSkillCatalog,
  type RuntimeProjectSteeringLookup,
} from "../runtime/project-skill-catalog.ts";
import {
  createRuntimeProjectSkillLoader,
  type RuntimeLoadedProjectSkill,
  type RuntimeProjectSkillContext,
  type RuntimeProjectSkillLoader,
  type RuntimeProjectSkillLoaderLogger,
} from "../runtime/project-skill-loader.ts";
import type {
  RuntimeSkillDefinition,
  RuntimeSkillMetadataLogger,
} from "../runtime/skill-metadata.ts";
import { isRuntimeSkillVisibleTo } from "../runtime/skill-metadata.ts";

/** Public API contract for hosted project steering logger. */
export type HostedProjectSteeringLogger =
  & RuntimeSkillMetadataLogger
  & RuntimeProjectSkillLoaderLogger;

/** Options accepted by hosted project steering adapter. */
export type HostedProjectSteeringAdapterOptions = {
  apiUrl: string | URL;
  skillsDir: string;
  logger?: HostedProjectSteeringLogger;
  trace?: RuntimeProjectFilesTrace;
  fetch?: RuntimeProjectFilesFetch;
  projectFilesClient?: RuntimeProjectFilesClient;
  projectSkillLoader?: RuntimeProjectSkillLoader;
  builtinSkills?: readonly RuntimeSkillDefinition[];
  builtinStore?: RuntimeLoadSkillBuiltinStore;
};

/** Context for hosted project skill IDs. */
export type HostedProjectSkillIdsContext = MutableAgentProjectContext & {
  authToken: string;
  /**
   * Id of the agent this run executes as. Refreshes scope the rewritten
   * skill set to this agent (unowned + own); when absent, the conservative
   * project-level rule applies (unowned only) — a refresh can never widen
   * visibility beyond the caller's scope.
   */
  agentId?: string;
};

/** Public API contract for hosted project steering adapter. */
export type HostedProjectSteeringAdapter = {
  listBuiltinSkillIds: () => string[];
  getProjectInstructions: (lookup: RuntimeProjectSteeringLookup) => Promise<string>;
  getSkillsConfig: (lookup: RuntimeProjectSteeringLookup) => Promise<RuntimeSkillDefinition[]>;
  listProjectSkillReferences: (
    context: RuntimeProjectSkillContext,
    skillId: string,
  ) => Promise<string[]>;
  loadProjectSkill: (
    context: RuntimeProjectSkillContext,
    skillId: string,
  ) => Promise<RuntimeLoadedProjectSkill | null>;
  loadProjectSkillReference: (
    context: RuntimeProjectSkillContext,
    skillId: string,
    normalizedFile: string,
  ) => Promise<string | null>;
  createLoadSkillTool: (
    context: RuntimeLoadSkillToolContext,
  ) => Tool<RuntimeLoadSkillToolInput, RuntimeLoadSkillToolOutput>;
  refreshProjectSkillIds: (context: HostedProjectSkillIdsContext) => Promise<void>;
};

function createProjectFilesAccessDeniedError(statusCode: number, message: string): Error {
  return new HostedServiceAuthError(statusCode, message);
}

function createProjectFilesClientOptions(
  options: HostedProjectSteeringAdapterOptions,
): RuntimeProjectFilesClientOptions {
  return {
    apiUrl: options.apiUrl,
    fetch: options.fetch,
    trace: options.trace,
    createAccessDeniedError: createProjectFilesAccessDeniedError,
  };
}

function createDefaultProjectFilesClient(
  options: HostedProjectSteeringAdapterOptions,
): RuntimeProjectFilesClient {
  return createRuntimeProjectFilesClient(createProjectFilesClientOptions(options));
}

function createDefaultProjectSkillLoader(
  options: HostedProjectSteeringAdapterOptions,
  projectFilesClient: RuntimeProjectFilesClient,
): RuntimeProjectSkillLoader {
  return createRuntimeProjectSkillLoader({
    getProjectFile: projectFilesClient.getProjectFile,
    getProjectFiles: projectFilesClient.getProjectFiles,
    isAccessDeniedError: isHostedServiceAuthError,
    logger: options.logger,
  });
}

function createDefaultBuiltinStore(): RuntimeLoadSkillBuiltinStore {
  return {
    readSkill: readRuntimeBuiltinSkill,
    readReferenceFile: readRuntimeBuiltinSkillReferenceFile,
    listReferences: listRuntimeBuiltinSkillReferences,
  };
}

/** Create hosted project steering adapter. */
export function createHostedProjectSteeringAdapter(
  options: HostedProjectSteeringAdapterOptions,
): HostedProjectSteeringAdapter {
  const projectFilesClient = options.projectFilesClient ?? createDefaultProjectFilesClient(options);
  const projectSkillLoader = options.projectSkillLoader ??
    createDefaultProjectSkillLoader(options, projectFilesClient);
  const builtinSkills = options.builtinSkills ??
    loadRuntimeBuiltinSkillCatalog({ skillsDir: options.skillsDir, logger: options.logger });
  const builtinStore = options.builtinStore ?? createDefaultBuiltinStore();

  async function getProjectInstructions(
    lookup: RuntimeProjectSteeringLookup,
  ): Promise<string> {
    return getRuntimeProjectInstructions({
      ...lookup,
      getProjectFile: projectFilesClient.getProjectFile,
    });
  }

  async function getSkillsConfig(
    lookup: RuntimeProjectSteeringLookup,
  ): Promise<RuntimeSkillDefinition[]> {
    return getRuntimeProjectSkillCatalog({
      ...lookup,
      builtinSkills,
      logger: options.logger,
      getProjectFile: projectFilesClient.getProjectFile,
      getProjectFiles: projectFilesClient.getProjectFiles,
    });
  }

  return {
    listBuiltinSkillIds: () => builtinSkills.map((skill) => skill.id),
    getProjectInstructions,
    getSkillsConfig,
    listProjectSkillReferences: (context, skillId) =>
      projectSkillLoader.listProjectSkillReferences(context, skillId),
    loadProjectSkill: (context, skillId) => projectSkillLoader.loadProjectSkill(context, skillId),
    loadProjectSkillReference: (context, skillId, normalizedFile) =>
      projectSkillLoader.loadProjectSkillReference(context, skillId, normalizedFile),
    createLoadSkillTool: (context) =>
      createRuntimeLoadSkillTool({
        context,
        skillsDir: options.skillsDir,
        projectSkillLoader,
        builtinSkillIds: builtinSkills.map((skill) => skill.id),
        builtinStore,
        logger: options.logger,
      }),
    refreshProjectSkillIds: async (context) => {
      const skills = await getSkillsConfig({
        projectId: context.projectId,
        authToken: context.authToken,
        branchId: context.branchId,
      });

      // Owner-aware: the refreshed per-run skill set keeps the caller's
      // scope — never another agent's owned skills — and the source-path
      // map stays in sync so colocated skills do not go stale.
      const visibleSkills = skills.filter((skill) =>
        isRuntimeSkillVisibleTo(skill, { agentId: context.agentId })
      );
      context.availableSkillIds = visibleSkills.map((skill) => skill.id);
      const skillSourcePaths = Object.fromEntries(
        visibleSkills
          .filter((skill) => skill.sourcePath)
          .map((skill) => [skill.id, skill.sourcePath as string]),
      );
      context.skillSourcePaths = Object.keys(skillSourcePaths).length > 0
        ? skillSourcePaths
        : undefined;
    },
  };
}
