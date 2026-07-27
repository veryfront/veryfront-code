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
  createStrictRuntimeProjectFilesClient,
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

/** Internal strict options forbid signal-unaware public project-files clients. */
export type StrictHostedProjectSteeringAdapterOptions =
  & Omit<HostedProjectSteeringAdapterOptions, "projectFilesClient">
  & {
    projectFilesClient?: never;
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

/** Internal request-scoped extension used only by fail-closed cloud composition. */
export type StrictHostedProjectSteeringAdapter = HostedProjectSteeringAdapter & {
  getProjectInstructionsForRequest: (
    lookup: RuntimeProjectSteeringLookup,
    signal: AbortSignal | undefined,
  ) => Promise<string>;
  getSkillsConfigForRequest: (
    lookup: RuntimeProjectSteeringLookup,
    signal: AbortSignal | undefined,
  ) => Promise<RuntimeSkillDefinition[]>;
  refreshProjectSkillIdsForRequest: (
    context: HostedProjectSkillIdsContext,
    signal: AbortSignal | undefined,
  ) => Promise<void>;
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
  strict: boolean,
): RuntimeProjectFilesClient | ReturnType<typeof createStrictRuntimeProjectFilesClient> {
  const clientOptions = createProjectFilesClientOptions(options);
  return strict
    ? createStrictRuntimeProjectFilesClient(clientOptions)
    : createRuntimeProjectFilesClient(clientOptions);
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

function createProjectSteeringAdapter(
  options: HostedProjectSteeringAdapterOptions,
  strictProjectFiles: false,
): HostedProjectSteeringAdapter;
function createProjectSteeringAdapter(
  options: StrictHostedProjectSteeringAdapterOptions,
  strictProjectFiles: true,
): StrictHostedProjectSteeringAdapter;
function createProjectSteeringAdapter(
  options: HostedProjectSteeringAdapterOptions,
  strictProjectFiles: boolean,
): HostedProjectSteeringAdapter | StrictHostedProjectSteeringAdapter {
  if (strictProjectFiles && options.projectFilesClient !== undefined) {
    throw new TypeError(
      "Strict hosted project steering does not accept a signal-unaware projectFilesClient",
    );
  }
  const projectFilesClient = strictProjectFiles
    ? createDefaultProjectFilesClient(options, true)
    : options.projectFilesClient ?? createDefaultProjectFilesClient(options, false);
  const projectSkillLoader = options.projectSkillLoader ??
    createDefaultProjectSkillLoader(options, projectFilesClient);
  const builtinSkills = options.builtinSkills ??
    loadRuntimeBuiltinSkillCatalog({ skillsDir: options.skillsDir, logger: options.logger });
  const builtinStore = options.builtinStore ?? createDefaultBuiltinStore();

  async function getProjectInstructions(
    lookup: RuntimeProjectSteeringLookup,
    signal?: AbortSignal,
  ): Promise<string> {
    return getRuntimeProjectInstructions({
      ...lookup,
      getProjectFile: (fileOptions) =>
        projectFilesClient.getProjectFile({
          ...fileOptions,
          ...(strictProjectFiles && signal ? { signal } : {}),
        }),
    });
  }

  async function getSkillsConfig(
    lookup: RuntimeProjectSteeringLookup,
    signal?: AbortSignal,
  ): Promise<RuntimeSkillDefinition[]> {
    return getRuntimeProjectSkillCatalog({
      ...lookup,
      builtinSkills,
      logger: options.logger,
      getProjectFile: (fileOptions) =>
        projectFilesClient.getProjectFile({
          ...fileOptions,
          ...(strictProjectFiles && signal ? { signal } : {}),
        }),
      getProjectFiles: (fileOptions) =>
        projectFilesClient.getProjectFiles({
          ...fileOptions,
          ...(strictProjectFiles && signal ? { signal } : {}),
        }),
    });
  }

  async function refreshProjectSkillIds(
    context: HostedProjectSkillIdsContext,
    signal?: AbortSignal,
  ): Promise<void> {
    const skills = await getSkillsConfig(
      {
        projectId: context.projectId,
        authToken: context.authToken,
        branchId: context.branchId,
      },
      signal,
    );

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
  }

  const adapter: HostedProjectSteeringAdapter = {
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
    refreshProjectSkillIds,
  };
  if (!strictProjectFiles) {
    return adapter;
  }
  return {
    ...adapter,
    getProjectInstructionsForRequest: getProjectInstructions,
    getSkillsConfigForRequest: getSkillsConfig,
    refreshProjectSkillIdsForRequest: refreshProjectSkillIds,
  };
}

/**
 * Create a hosted project steering adapter.
 *
 * The public factory retains the established permissive project-files client
 * contract. Hosted service composition uses the strict internal factory below.
 */
export function createHostedProjectSteeringAdapter(
  options: HostedProjectSteeringAdapterOptions,
): HostedProjectSteeringAdapter {
  return createProjectSteeringAdapter(options, false);
}

/** Create the fail-closed project steering adapter used by hosted services. */
export function createStrictHostedProjectSteeringAdapter(
  options: StrictHostedProjectSteeringAdapterOptions,
): StrictHostedProjectSteeringAdapter {
  return createProjectSteeringAdapter(options, true);
}
