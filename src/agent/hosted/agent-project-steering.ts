import { ensureBuiltinSchemaValidator } from "../../extensions/builtin-extensions.ts";
import { defineSchema } from "../../schemas/define.ts";
import { lazySchema } from "../../schemas/lazy.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import {
  createHostedProjectSteeringAdapter,
  type HostedProjectSkillIdsContext,
  type HostedProjectSteeringAdapter,
  type HostedProjectSteeringLogger,
} from "./project-steering-adapter.ts";
import {
  loadRuntimeAgentMarkdownDefinitionFromFile,
  resolveRuntimeAgentDefinitionsDir,
  resolveRuntimeAgentMarkdownDefinitionFilePath,
} from "../runtime/agent-definition-files.ts";
import type { RuntimeAgentMarkdownDefinition } from "../runtime/agent-definition.ts";
import { resolveRuntimeBuiltinSkillsDir } from "../runtime/builtin-skill-files.ts";
import type {
  RuntimeProjectFilesFetch,
  RuntimeProjectFilesTrace,
} from "../runtime/project-files-client.ts";
import type { RuntimeProjectSteeringLookup } from "../runtime/project-skill-catalog.ts";
import type { RuntimeLoadSkillToolContext } from "../runtime/load-skill-tool.ts";
import type { RuntimeSkillDefinition } from "../runtime/skill-metadata.ts";

/** Public API contract for hosted agent project steering options data. */
export type HostedAgentProjectSteeringOptionsData = {
  baseDir: string;
  agentId: string;
  fileName?: string;
  skillsDir?: string;
};

/** Zod schema for hosted agent project steering options. */
export const hostedAgentProjectSteeringOptionsSchema: Schema<
  HostedAgentProjectSteeringOptionsData
> = lazySchema(
  defineSchema<HostedAgentProjectSteeringOptionsData>((v) => {
    const runtimeAgentFileIdSchema = v.string().min(1).regex(/^[A-Za-z0-9._-]+$/);
    const runtimeAgentDefinitionFileNameSchema = v.string().min(1).regex(
      /^[A-Za-z0-9._-]+\.md$/,
    );

    return v.object({
      baseDir: v.string().min(1),
      agentId: runtimeAgentFileIdSchema,
      fileName: runtimeAgentDefinitionFileNameSchema.optional(),
      skillsDir: v.string().min(1).optional(),
    });
  }),
);

/** Public API contract for hosted agent project steering logger. */
export type HostedAgentProjectSteeringLogger = HostedProjectSteeringLogger & {
  error?: (message: string, metadata?: Record<string, unknown>) => void;
};

/** Options accepted by hosted agent project steering. */
export type HostedAgentProjectSteeringOptions = HostedAgentProjectSteeringOptionsData & {
  getApiUrl: () => string | URL;
  logger?: HostedAgentProjectSteeringLogger;
  trace?: RuntimeProjectFilesTrace;
  fetch?: RuntimeProjectFilesFetch;
};

/** Public API contract for hosted agent project steering. */
export type HostedAgentProjectSteering = {
  getAgentConfig: () => RuntimeAgentMarkdownDefinition;
  getProjectInstructions: (lookup: RuntimeProjectSteeringLookup) => Promise<string>;
  getSkillsConfig: (lookup: RuntimeProjectSteeringLookup) => Promise<RuntimeSkillDefinition[]>;
  createLoadSkillTool: (
    context: RuntimeLoadSkillToolContext,
  ) => ReturnType<HostedProjectSteeringAdapter["createLoadSkillTool"]>;
  refreshProjectSkillIds: (context: HostedProjectSkillIdsContext) => Promise<void>;
  getProjectSteeringAdapter: () => HostedProjectSteeringAdapter;
};

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Create hosted agent project steering. */
export function createHostedAgentProjectSteering(
  options: HostedAgentProjectSteeringOptions,
): HostedAgentProjectSteering {
  ensureBuiltinSchemaValidator();
  const parsedOptions = hostedAgentProjectSteeringOptionsSchema.parse(options);
  const agentsDir = resolveRuntimeAgentDefinitionsDir({
    baseDir: parsedOptions.baseDir,
    id: parsedOptions.agentId,
    fileName: parsedOptions.fileName,
  });
  const agentFilePath = resolveRuntimeAgentMarkdownDefinitionFilePath({
    agentsDir,
    id: parsedOptions.agentId,
    fileName: parsedOptions.fileName,
  });
  const skillsDir = parsedOptions.skillsDir ??
    resolveRuntimeBuiltinSkillsDir(parsedOptions.baseDir);

  let cachedAgentConfig: RuntimeAgentMarkdownDefinition | null = null;
  let cachedProjectSteeringAdapter: HostedProjectSteeringAdapter | null = null;

  function getAgentConfig(): RuntimeAgentMarkdownDefinition {
    if (cachedAgentConfig) {
      return cachedAgentConfig;
    }

    try {
      cachedAgentConfig = loadRuntimeAgentMarkdownDefinitionFromFile({
        agentsDir,
        id: parsedOptions.agentId,
        fileName: parsedOptions.fileName,
      });
      return cachedAgentConfig;
    } catch (error) {
      options.logger?.error?.("Failed to load agent config", {
        error: stringifyError(error),
        filePath: agentFilePath,
      });
      throw error;
    }
  }

  function getProjectSteeringAdapter(): HostedProjectSteeringAdapter {
    if (cachedProjectSteeringAdapter) {
      return cachedProjectSteeringAdapter;
    }

    cachedProjectSteeringAdapter = createHostedProjectSteeringAdapter({
      apiUrl: options.getApiUrl(),
      skillsDir,
      logger: options.logger,
      trace: options.trace,
      fetch: options.fetch,
    });

    return cachedProjectSteeringAdapter;
  }

  return {
    getAgentConfig,
    getProjectSteeringAdapter,
    getProjectInstructions: (lookup) => getProjectSteeringAdapter().getProjectInstructions(lookup),
    getSkillsConfig: (lookup) => getProjectSteeringAdapter().getSkillsConfig(lookup),
    createLoadSkillTool: (context) => getProjectSteeringAdapter().createLoadSkillTool(context),
    refreshProjectSkillIds: (context) =>
      getProjectSteeringAdapter().refreshProjectSkillIds(context),
  };
}
