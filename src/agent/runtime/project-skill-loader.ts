import {
  DEFAULT_PROJECT_STEERING_PATHS,
  type ProjectSteeringPaths,
} from "../project/steering-mutation.ts";
import type {
  RuntimeGetProjectFileOptions,
  RuntimeProjectFile,
  RuntimeProjectFileListItem,
  RuntimeProjectFilesApiOptions,
} from "./project-files-client.ts";
import { normalizeRuntimeSkillReferencePath } from "./skill-metadata.ts";
import {
  createSkillOperationBudget,
  type SkillOperationBudget,
} from "#veryfront/skill/operation-budget.ts";
import {
  SKILL_DOCUMENT_MAX_CHARACTERS,
  SKILL_FILE_OPERATION_TIMEOUT_MS,
  SKILL_STEERING_PATH_MAX_ENTRIES,
  SKILL_SUBDIR_MAX_ENTRIES,
} from "#veryfront/skill/limits.ts";

/** Context for runtime project skill. */
export type RuntimeProjectSkillContext = {
  projectId?: string | null;
  authToken: string;
  branchId?: string | null;
  /**
   * Per-run map of skill id to its discovered SKILL.md source path (from the
   * owner-aware catalog). When present for an id, the loader resolves the
   * skill and its references at that real path instead of probing
   * `{skillsPath}/{skillId}/...` — required for colocated skills whose
   * namespaced ids (e.g. `researcher--cite`) do not correspond to a
   * `skills/{id}/` directory.
   */
  skillSourcePaths?: Readonly<Record<string, string>>;
};

/** Shared resource budget supplied by the outer runtime tool call. */
export type RuntimeProjectSkillOperationOptions = {
  budget?: SkillOperationBudget;
};

/** Public API contract for runtime loaded project skill. */
export type RuntimeLoadedProjectSkill = {
  instructions: string;
  references: string[];
};

/** Public API contract for runtime project skill loader logger. */
export type RuntimeProjectSkillLoaderLogger = {
  warn?: (message: string, metadata?: Record<string, unknown>) => void;
};

/** Options accepted by runtime project skill loader. */
export type RuntimeProjectSkillLoaderOptions = {
  getProjectFile: (options: RuntimeGetProjectFileOptions) => Promise<RuntimeProjectFile | null>;
  getProjectFiles: (
    options: RuntimeProjectFilesApiOptions,
  ) => Promise<RuntimeProjectFileListItem[]>;
  steeringPaths?: Pick<ProjectSteeringPaths, "skills">;
  isAccessDeniedError?: (error: unknown) => boolean;
  logger?: RuntimeProjectSkillLoaderLogger;
};

/** Public API contract for runtime project skill loader. */
export type RuntimeProjectSkillLoader = {
  listProjectSkillReferences: (
    context: RuntimeProjectSkillContext,
    skillId: string,
    operation?: RuntimeProjectSkillOperationOptions,
  ) => Promise<string[]>;
  loadProjectSkill: (
    context: RuntimeProjectSkillContext,
    skillId: string,
    operation?: RuntimeProjectSkillOperationOptions,
  ) => Promise<RuntimeLoadedProjectSkill | null>;
  loadProjectSkillReference: (
    context: RuntimeProjectSkillContext,
    skillId: string,
    normalizedFile: string,
    operation?: RuntimeProjectSkillOperationOptions,
  ) => Promise<string | null>;
};

function getSkillPaths(options: RuntimeProjectSkillLoaderOptions): readonly string[] {
  const paths = options.steeringPaths?.skills ?? DEFAULT_PROJECT_STEERING_PATHS.skills;
  if (paths.length > SKILL_STEERING_PATH_MAX_ENTRIES) {
    throw new RangeError(
      `Skill steering paths may contain at most ${SKILL_STEERING_PATH_MAX_ENTRIES} entries`,
    );
  }
  return paths;
}

function assertRuntimeSkillContent(content: string, label: string): void {
  if (content.length > SKILL_DOCUMENT_MAX_CHARACTERS) {
    throw new RangeError(
      `${label} may contain at most ${SKILL_DOCUMENT_MAX_CHARACTERS} characters`,
    );
  }
}

function isAccessDeniedError(
  error: unknown,
  options: RuntimeProjectSkillLoaderOptions,
): boolean {
  return options.isAccessDeniedError?.(error) ?? false;
}

type ProjectSkillSource =
  | { kind: "directory"; skillsPath: string }
  | { kind: "flat"; skillsPath: string }
  | { kind: "explicit"; skillDir: string };

/** Directory containing the skill's files, per source kind. */
function getSkillDir(source: ProjectSkillSource, skillId: string): string | null {
  if (source.kind === "explicit") {
    return source.skillDir;
  }
  if (source.kind === "directory") {
    return `${source.skillsPath}/${skillId}`;
  }
  return null;
}

/** Resolves a skill's directory from the per-run catalog source path, if any. */
function resolveCatalogSkillDir(
  context: RuntimeProjectSkillContext,
  skillId: string,
): string | null {
  const sourcePath = context.skillSourcePaths?.[skillId];
  if (!sourcePath || !sourcePath.endsWith("/SKILL.md")) {
    return null;
  }
  return sourcePath.slice(0, -"/SKILL.md".length);
}

function getRemainingSkillOperationMs(budget: SkillOperationBudget): number | undefined {
  budget.throwIfTerminated();
  return budget.remainingMs();
}

function getBoundedProjectSkillReadOptions(
  budget: SkillOperationBudget,
): Pick<RuntimeGetProjectFileOptions, "abortSignal" | "maximumContentCharacters" | "timeoutMs"> {
  return {
    abortSignal: budget.abortSignal,
    maximumContentCharacters: SKILL_DOCUMENT_MAX_CHARACTERS,
    timeoutMs: getRemainingSkillOperationMs(budget),
  };
}

async function findProjectSkillSource(input: {
  options: RuntimeProjectSkillLoaderOptions;
  context: RuntimeProjectSkillContext;
  skillId: string;
  budget: SkillOperationBudget;
}): Promise<ProjectSkillSource | null> {
  const projectId = input.context.projectId;
  if (!projectId) {
    return null;
  }

  const catalogSkillDir = resolveCatalogSkillDir(input.context, input.skillId);
  if (catalogSkillDir) {
    return { kind: "explicit", skillDir: catalogSkillDir };
  }

  for (const skillsPath of getSkillPaths(input.options)) {
    const directorySkill = await input.options.getProjectFile({
      projectId,
      authToken: input.context.authToken,
      branchId: input.context.branchId,
      path: `${skillsPath}/${input.skillId}/SKILL.md`,
      ...getBoundedProjectSkillReadOptions(input.budget),
    });
    if (directorySkill?.content) {
      return { kind: "directory", skillsPath };
    }

    const flatSkill = await input.options.getProjectFile({
      projectId,
      authToken: input.context.authToken,
      branchId: input.context.branchId,
      path: `${skillsPath}/${input.skillId}.md`,
      ...getBoundedProjectSkillReadOptions(input.budget),
    });
    if (flatSkill?.content) {
      return { kind: "flat", skillsPath };
    }
  }

  return null;
}

function collectProjectSkillReferences(input: {
  allFiles: readonly RuntimeProjectFileListItem[];
  skillDir: string;
}): string[] {
  if (input.allFiles.length > SKILL_SUBDIR_MAX_ENTRIES) {
    throw new RangeError(
      `Project skill file listing may contain at most ${SKILL_SUBDIR_MAX_ENTRIES} entries`,
    );
  }
  const skillPrefix = `${input.skillDir}/`;
  const refsPrefix = `${skillPrefix}references/`;
  const references = new Set<string>();

  for (const file of input.allFiles) {
    if (!file.path.startsWith(refsPrefix)) {
      continue;
    }

    const relativePath = file.path.slice(skillPrefix.length);
    if (!relativePath.includes("/")) {
      continue;
    }

    const normalizedReference = normalizeRuntimeSkillReferencePath(relativePath);
    if (normalizedReference) {
      references.add(normalizedReference);
      if (references.size > SKILL_SUBDIR_MAX_ENTRIES) {
        throw new RangeError(
          `Skill references may contain at most ${SKILL_SUBDIR_MAX_ENTRIES} entries`,
        );
      }
    }
  }

  return [...references].sort();
}

async function listProjectSkillReferences(input: {
  options: RuntimeProjectSkillLoaderOptions;
  context: RuntimeProjectSkillContext;
  skillId: string;
  budget: SkillOperationBudget;
  skillsPath?: string;
}): Promise<string[]> {
  const projectId = input.context.projectId;
  if (!projectId) {
    return [];
  }

  const source: ProjectSkillSource | null = input.skillsPath
    ? { kind: "directory", skillsPath: input.skillsPath }
    : await findProjectSkillSource(input);
  const skillDir = source ? getSkillDir(source, input.skillId) : null;
  if (!skillDir) {
    return [];
  }

  const allFiles = await input.options.getProjectFiles({
    projectId,
    authToken: input.context.authToken,
    branchId: input.context.branchId,
    maximumEntries: SKILL_SUBDIR_MAX_ENTRIES,
    pathPrefix: `${skillDir}/references`,
    abortSignal: input.budget.abortSignal,
    timeoutMs: getRemainingSkillOperationMs(input.budget),
  });

  return collectProjectSkillReferences({
    allFiles,
    skillDir,
  });
}

async function loadProjectSkill(input: {
  options: RuntimeProjectSkillLoaderOptions;
  context: RuntimeProjectSkillContext;
  skillId: string;
  budget: SkillOperationBudget;
}): Promise<RuntimeLoadedProjectSkill | null> {
  const projectId = input.context.projectId;
  if (!projectId) {
    return null;
  }

  try {
    const catalogSkillDir = resolveCatalogSkillDir(input.context, input.skillId);
    if (catalogSkillDir) {
      const catalogSkill = await input.options.getProjectFile({
        projectId,
        authToken: input.context.authToken,
        branchId: input.context.branchId,
        path: `${catalogSkillDir}/SKILL.md`,
        ...getBoundedProjectSkillReadOptions(input.budget),
      });
      if (catalogSkill?.content) {
        assertRuntimeSkillContent(catalogSkill.content, "Skill document");
        return {
          instructions: catalogSkill.content,
          references: await listProjectSkillReferences(input),
        };
      }
    }

    for (const skillsPath of getSkillPaths(input.options)) {
      const directorySkill = await input.options.getProjectFile({
        projectId,
        authToken: input.context.authToken,
        branchId: input.context.branchId,
        path: `${skillsPath}/${input.skillId}/SKILL.md`,
        ...getBoundedProjectSkillReadOptions(input.budget),
      });

      if (directorySkill?.content) {
        assertRuntimeSkillContent(directorySkill.content, "Skill document");
        return {
          instructions: directorySkill.content,
          references: await listProjectSkillReferences({ ...input, skillsPath }),
        };
      }

      const flatSkill = await input.options.getProjectFile({
        projectId,
        authToken: input.context.authToken,
        branchId: input.context.branchId,
        path: `${skillsPath}/${input.skillId}.md`,
        ...getBoundedProjectSkillReadOptions(input.budget),
      });

      if (flatSkill?.content) {
        assertRuntimeSkillContent(flatSkill.content, "Skill document");
        return {
          instructions: flatSkill.content,
          references: [],
        };
      }
    }
  } catch (error) {
    if (isAccessDeniedError(error, input.options)) {
      input.options.logger?.warn?.(
        "Falling back to builtin skill after project skill lookup was denied",
        {
          projectId,
          branchId: input.context.branchId ?? null,
          skillId: input.skillId,
        },
      );
      return null;
    }

    throw error;
  }

  return null;
}

async function loadProjectSkillReference(input: {
  options: RuntimeProjectSkillLoaderOptions;
  context: RuntimeProjectSkillContext;
  skillId: string;
  normalizedFile: string;
  budget: SkillOperationBudget;
}): Promise<string | null> {
  const projectId = input.context.projectId;
  if (!projectId) {
    return null;
  }

  try {
    const source = await findProjectSkillSource(input);
    const skillDir = source ? getSkillDir(source, input.skillId) : null;
    if (!skillDir) {
      return null;
    }

    const projectFile = await input.options.getProjectFile({
      projectId,
      authToken: input.context.authToken,
      branchId: input.context.branchId,
      path: `${skillDir}/${input.normalizedFile}`,
      ...getBoundedProjectSkillReadOptions(input.budget),
    });
    if (projectFile?.content) {
      assertRuntimeSkillContent(projectFile.content, "Skill reference");
      return projectFile.content;
    }
  } catch (error) {
    if (!isAccessDeniedError(error, input.options)) {
      throw error;
    }

    input.options.logger?.warn?.(
      "Falling back to builtin skill reference after project skill lookup was denied",
      {
        projectId,
        branchId: input.context.branchId ?? null,
        skillId: input.skillId,
        file: input.normalizedFile,
      },
    );
  }

  return null;
}

/** Create runtime project skill loader. */
export function createRuntimeProjectSkillLoader(
  options: RuntimeProjectSkillLoaderOptions,
): RuntimeProjectSkillLoader {
  const withBudget = <T>(
    operation: RuntimeProjectSkillOperationOptions | undefined,
    fn: (budget: SkillOperationBudget) => Promise<T>,
  ): Promise<T> => {
    const budget = operation?.budget ?? createSkillOperationBudget({
      timeoutMs: SKILL_FILE_OPERATION_TIMEOUT_MS,
    });
    return budget.run(() => fn(budget));
  };
  return {
    listProjectSkillReferences: (context, skillId, operation) =>
      withBudget(
        operation,
        (budget) => listProjectSkillReferences({ options, context, skillId, budget }),
      ),
    loadProjectSkill: (context, skillId, operation) =>
      withBudget(
        operation,
        (budget) => loadProjectSkill({ options, context, skillId, budget }),
      ),
    loadProjectSkillReference: (context, skillId, normalizedFile, operation) =>
      withBudget(
        operation,
        (budget) =>
          loadProjectSkillReference({ options, context, skillId, normalizedFile, budget }),
      ),
  };
}
