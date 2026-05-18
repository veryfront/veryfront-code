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

/** Context for runtime project skill. */
export type RuntimeProjectSkillContext = {
  projectId?: string | null;
  authToken: string;
  branchId?: string | null;
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
};

function getSkillPaths(options: RuntimeProjectSkillLoaderOptions): readonly string[] {
  return options.steeringPaths?.skills ?? DEFAULT_PROJECT_STEERING_PATHS.skills;
}

function isAccessDeniedError(
  error: unknown,
  options: RuntimeProjectSkillLoaderOptions,
): boolean {
  return options.isAccessDeniedError?.(error) ?? false;
}

type ProjectSkillSource =
  | { kind: "directory"; skillsPath: string }
  | { kind: "flat"; skillsPath: string };

async function findProjectSkillSource(input: {
  options: RuntimeProjectSkillLoaderOptions;
  context: RuntimeProjectSkillContext;
  skillId: string;
}): Promise<ProjectSkillSource | null> {
  const projectId = input.context.projectId;
  if (!projectId) {
    return null;
  }

  for (const skillsPath of getSkillPaths(input.options)) {
    const directorySkill = await input.options.getProjectFile({
      projectId,
      authToken: input.context.authToken,
      branchId: input.context.branchId,
      path: `${skillsPath}/${input.skillId}/SKILL.md`,
    });
    if (directorySkill?.content) {
      return { kind: "directory", skillsPath };
    }

    const flatSkill = await input.options.getProjectFile({
      projectId,
      authToken: input.context.authToken,
      branchId: input.context.branchId,
      path: `${skillsPath}/${input.skillId}.md`,
    });
    if (flatSkill?.content) {
      return { kind: "flat", skillsPath };
    }
  }

  return null;
}

function collectProjectSkillReferences(input: {
  allFiles: readonly RuntimeProjectFileListItem[];
  skillsPath: string;
  skillId: string;
}): string[] {
  const skillPrefix = `${input.skillsPath}/${input.skillId}/`;
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
    }
  }

  return [...references].sort();
}

async function listProjectSkillReferences(input: {
  options: RuntimeProjectSkillLoaderOptions;
  context: RuntimeProjectSkillContext;
  skillId: string;
  skillsPath?: string;
}): Promise<string[]> {
  const projectId = input.context.projectId;
  if (!projectId) {
    return [];
  }

  const source: ProjectSkillSource | null = input.skillsPath
    ? { kind: "directory", skillsPath: input.skillsPath }
    : await findProjectSkillSource(input);
  if (source?.kind !== "directory") {
    return [];
  }

  const allFiles = await input.options.getProjectFiles({
    projectId,
    authToken: input.context.authToken,
    branchId: input.context.branchId,
  });

  return collectProjectSkillReferences({
    allFiles,
    skillsPath: source.skillsPath,
    skillId: input.skillId,
  });
}

async function loadProjectSkill(input: {
  options: RuntimeProjectSkillLoaderOptions;
  context: RuntimeProjectSkillContext;
  skillId: string;
}): Promise<RuntimeLoadedProjectSkill | null> {
  const projectId = input.context.projectId;
  if (!projectId) {
    return null;
  }

  try {
    for (const skillsPath of getSkillPaths(input.options)) {
      const directorySkill = await input.options.getProjectFile({
        projectId,
        authToken: input.context.authToken,
        branchId: input.context.branchId,
        path: `${skillsPath}/${input.skillId}/SKILL.md`,
      });

      if (directorySkill?.content) {
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
      });

      if (flatSkill?.content) {
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
}): Promise<string | null> {
  const projectId = input.context.projectId;
  if (!projectId) {
    return null;
  }

  try {
    const source = await findProjectSkillSource(input);
    if (source?.kind !== "directory") {
      return null;
    }

    const projectFile = await input.options.getProjectFile({
      projectId,
      authToken: input.context.authToken,
      branchId: input.context.branchId,
      path: `${source.skillsPath}/${input.skillId}/${input.normalizedFile}`,
    });
    if (projectFile?.content) {
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
  return {
    listProjectSkillReferences: (context, skillId) =>
      listProjectSkillReferences({ options, context, skillId }),
    loadProjectSkill: (context, skillId) => loadProjectSkill({ options, context, skillId }),
    loadProjectSkillReference: (context, skillId, normalizedFile) =>
      loadProjectSkillReference({ options, context, skillId, normalizedFile }),
  };
}
