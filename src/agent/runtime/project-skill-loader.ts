import {
  DEFAULT_PROJECT_STEERING_PATHS,
  type ProjectSteeringPaths,
} from "../project-steering-mutation.ts";
import type {
  RuntimeGetProjectFileOptions,
  RuntimeProjectFile,
  RuntimeProjectFileListItem,
  RuntimeProjectFilesApiOptions,
} from "./project-files-client.ts";
import { normalizeRuntimeSkillReferencePath } from "./skill-metadata.ts";

export type RuntimeProjectSkillContext = {
  projectId?: string | null;
  authToken: string;
  branchId?: string | null;
};

export type RuntimeLoadedProjectSkill = {
  instructions: string;
  references: string[];
};

export type RuntimeProjectSkillLoaderLogger = {
  warn?: (message: string, metadata?: Record<string, unknown>) => void;
};

export type RuntimeProjectSkillLoaderOptions = {
  getProjectFile: (options: RuntimeGetProjectFileOptions) => Promise<RuntimeProjectFile | null>;
  getProjectFiles: (
    options: RuntimeProjectFilesApiOptions,
  ) => Promise<RuntimeProjectFileListItem[]>;
  steeringPaths?: Pick<ProjectSteeringPaths, "skills">;
  isAccessDeniedError?: (error: unknown) => boolean;
  logger?: RuntimeProjectSkillLoaderLogger;
};

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

async function listProjectSkillReferences(input: {
  options: RuntimeProjectSkillLoaderOptions;
  context: RuntimeProjectSkillContext;
  skillId: string;
}): Promise<string[]> {
  const projectId = input.context.projectId;
  if (!projectId) {
    return [];
  }

  const allFiles = await input.options.getProjectFiles({
    projectId,
    authToken: input.context.authToken,
    branchId: input.context.branchId,
  });
  const references = new Set<string>();

  for (const skillsPath of getSkillPaths(input.options)) {
    const skillPrefix = `${skillsPath}/${input.skillId}/`;
    const refsPrefix = `${skillPrefix}references/`;

    for (const file of allFiles) {
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
  }

  return [...references].sort();
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
          references: await listProjectSkillReferences(input),
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
    for (const skillsPath of getSkillPaths(input.options)) {
      const projectFile = await input.options.getProjectFile({
        projectId,
        authToken: input.context.authToken,
        branchId: input.context.branchId,
        path: `${skillsPath}/${input.skillId}/${input.normalizedFile}`,
      });
      if (projectFile?.content) {
        return projectFile.content;
      }
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
