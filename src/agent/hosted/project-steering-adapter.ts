import type { Tool } from "#veryfront/tool";
import { HostedServiceAuthError, isHostedServiceAuthError } from "../service/auth.ts";
import {
  listRuntimeBuiltinSkillReferencesWithinLimit,
  readRuntimeBuiltinSkillReferenceWithinLimit,
  readRuntimeBuiltinSkillWithinLimit,
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
  createStrictRuntimeProjectFilesClient,
  type RuntimeProjectFilesClient,
  type RuntimeProjectFilesClientOptions,
  type RuntimeProjectFilesFetch,
  type RuntimeProjectFilesTrace,
} from "../runtime/project-files-client.ts";
import {
  type SkillDocumentParserProvider,
  snapshotSkillDocumentParserProvider,
} from "#veryfront/extensions/parser/skill-document-parser.ts";
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
import { resolveRuntimeSkillSelectorSnapshotForAgent } from "../runtime/skill-metadata.ts";
import {
  assertResolvedSkillSelector,
  createNoneSkillSelectorSnapshot,
  type ResolvedSkillSelectorPolicy,
} from "#veryfront/skill/selector.ts";

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
  skillDocumentParserProvider?: SkillDocumentParserProvider;
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
  skillSelectorPolicy?: ResolvedSkillSelectorPolicy;
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
  return createStrictRuntimeProjectFilesClient(createProjectFilesClientOptions(options));
}

function createDefaultProjectSkillLoader(
  options: HostedProjectSteeringAdapterOptions,
  projectFilesClient: RuntimeProjectFilesClient,
  skillDocumentParserProvider: Readonly<SkillDocumentParserProvider> | undefined,
): RuntimeProjectSkillLoader {
  return createRuntimeProjectSkillLoader({
    getProjectFile: projectFilesClient.getProjectFile,
    getProjectFiles: projectFilesClient.getProjectFiles,
    isAccessDeniedError: isHostedServiceAuthError,
    logger: options.logger,
    skillDocumentParserProvider,
  });
}

function createDefaultBuiltinStore(): RuntimeLoadSkillBuiltinStore {
  return {
    readSkill: readRuntimeBuiltinSkillWithinLimit,
    readReferenceFile: readRuntimeBuiltinSkillReferenceWithinLimit,
    listReferences: listRuntimeBuiltinSkillReferencesWithinLimit,
  };
}

function resolveRefreshedSkillSnapshot(input: {
  skills: readonly RuntimeSkillDefinition[];
  context: HostedProjectSkillIdsContext;
}) {
  const policy = input.context.skillSelectorPolicy;

  if (!policy || policy.kind === "all-visible") {
    return resolveRuntimeSkillSelectorSnapshotForAgent({
      skills: input.skills,
      agentId: input.context.agentId ?? "",
      selector: policy?.source === "true" ? true : undefined,
    });
  }

  if (policy.kind === "none") {
    return createNoneSkillSelectorSnapshot<RuntimeSkillDefinition>(policy);
  }

  return resolveRuntimeSkillSelectorSnapshotForAgent({
    skills: input.skills,
    agentId: input.context.agentId ?? "",
    selector: policy.entries,
  });
}

/** Create hosted project steering adapter. */
export function createHostedProjectSteeringAdapter(
  options: HostedProjectSteeringAdapterOptions,
): HostedProjectSteeringAdapter {
  const skillDocumentParserProvider = options.skillDocumentParserProvider === undefined
    ? undefined
    : snapshotSkillDocumentParserProvider(options.skillDocumentParserProvider);
  const projectFilesClient = options.projectFilesClient ??
    createDefaultProjectFilesClient(options);
  const projectSkillLoader = options.projectSkillLoader ??
    createDefaultProjectSkillLoader(options, projectFilesClient, skillDocumentParserProvider);
  const builtinSkills = options.builtinSkills ??
    loadRuntimeBuiltinSkillCatalog({
      skillsDir: options.skillsDir,
      logger: options.logger,
      skillDocumentParserProvider,
    });
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
      skillDocumentParserProvider,
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
        skillDocumentParserProvider,
      }),
    refreshProjectSkillIds: async (context) => {
      const skills = await getSkillsConfig({
        projectId: context.projectId,
        authToken: context.authToken,
        branchId: context.branchId,
      });

      const snapshot = resolveRefreshedSkillSnapshot({ skills, context });
      assertResolvedSkillSelector(snapshot);
      context.availableSkillIds = snapshot.allowedSkillIds;
      context.skillSelectorPolicy = snapshot.policy;
      context.skillSourcePaths = Object.keys(snapshot.skillSourcePaths).length > 0
        ? snapshot.skillSourcePaths
        : undefined;
    },
  };
}
