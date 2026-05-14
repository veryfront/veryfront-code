import { basename } from "node:path";
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
import {
  listRuntimeBuiltinSkillReferences,
  readRuntimeBuiltinDirectorySkill,
  readRuntimeBuiltinFlatSkill,
  readRuntimeBuiltinSkillEntries,
} from "./builtin-skill-files.ts";
import {
  buildRuntimeSkillDefinition,
  type RuntimeSkillDefinition,
  type RuntimeSkillMetadataLogger,
} from "./skill-metadata.ts";

export type RuntimeProjectSteeringLookup = {
  projectId: string;
  authToken: string;
  branchId?: string | null;
};

export type RuntimeProjectSkillCatalogOptions = {
  getProjectFile: (options: RuntimeGetProjectFileOptions) => Promise<RuntimeProjectFile | null>;
  getProjectFiles: (
    options: RuntimeProjectFilesApiOptions,
  ) => Promise<readonly RuntimeProjectFileListItem[] | null>;
  builtinSkills: readonly RuntimeSkillDefinition[];
  steeringPaths?: Pick<ProjectSteeringPaths, "skills">;
  logger?: RuntimeSkillMetadataLogger;
};

export type RuntimeProjectInstructionsOptions = {
  getProjectFile: (options: RuntimeGetProjectFileOptions) => Promise<RuntimeProjectFile | null>;
  steeringPaths?: Pick<ProjectSteeringPaths, "instructions">;
};

function sortSkillsById(skills: Iterable<RuntimeSkillDefinition>): RuntimeSkillDefinition[] {
  return [...skills].sort((a, b) => a.id.localeCompare(b.id));
}

function getSkillPaths(options: Pick<RuntimeProjectSkillCatalogOptions, "steeringPaths">) {
  return options.steeringPaths?.skills ?? DEFAULT_PROJECT_STEERING_PATHS.skills;
}

function getInstructionPaths(options: RuntimeProjectInstructionsOptions) {
  return options.steeringPaths?.instructions ?? DEFAULT_PROJECT_STEERING_PATHS.instructions;
}

export function loadRuntimeBuiltinSkillCatalog(input: {
  skillsDir: string;
  logger?: RuntimeSkillMetadataLogger;
}): RuntimeSkillDefinition[] {
  const entriesResult = readRuntimeBuiltinSkillEntries(input.skillsDir);
  if (!entriesResult.ok) {
    input.logger?.error?.("Failed to load built-in skills", {
      error: entriesResult.errorMessage,
      skillsDir: input.skillsDir,
    });
    return [];
  }

  return sortSkillsById(
    entriesResult.entries.flatMap((entry) => {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const id = basename(entry.name, ".md");
        const content = readRuntimeBuiltinFlatSkill(input.skillsDir, id);
        if (content === null) {
          return [];
        }

        const definition = buildRuntimeSkillDefinition({
          id,
          content,
          logger: input.logger,
        });

        return definition ? [definition] : [];
      }

      if (entry.isDirectory()) {
        const content = readRuntimeBuiltinDirectorySkill(input.skillsDir, entry.name);
        if (content === null) {
          return [];
        }

        const definition = buildRuntimeSkillDefinition({
          id: entry.name,
          content,
          references: listRuntimeBuiltinSkillReferences(input.skillsDir, entry.name),
          logger: input.logger,
        });

        return definition ? [definition] : [];
      }

      return [];
    }),
  );
}

export async function getRuntimeProjectInstructions(
  input: RuntimeProjectSteeringLookup & RuntimeProjectInstructionsOptions,
): Promise<string> {
  for (const filePath of getInstructionPaths(input)) {
    const file = await input.getProjectFile({
      projectId: input.projectId,
      authToken: input.authToken,
      branchId: input.branchId,
      path: filePath,
    });

    if (file?.content) {
      return file.content;
    }
  }

  return "";
}

export async function getRuntimeProjectSkillCatalog(
  input: RuntimeProjectSteeringLookup & RuntimeProjectSkillCatalogOptions,
): Promise<RuntimeSkillDefinition[]> {
  const allFiles = await input.getProjectFiles({
    projectId: input.projectId,
    authToken: input.authToken,
    branchId: input.branchId,
  });
  if (!allFiles || allFiles.length === 0) {
    return [...input.builtinSkills];
  }

  const projectSkillsById = new Map<string, RuntimeSkillDefinition>();

  for (const prefix of getSkillPaths(input)) {
    const prefixWithSlash = `${prefix}/`;

    const flatPaths = allFiles
      .filter((file) => {
        if (!file.path.startsWith(prefixWithSlash) || !file.path.endsWith(".md")) {
          return false;
        }

        const relative = file.path.slice(prefixWithSlash.length);
        return !relative.includes("/");
      })
      .map((file) => file.path);

    const dirPaths = allFiles
      .filter((file) => file.path.startsWith(prefixWithSlash) && file.path.endsWith("/SKILL.md"))
      .map((file) => file.path);

    const skillPaths = [...dirPaths.sort(), ...flatPaths.sort()];
    if (skillPaths.length === 0) {
      continue;
    }

    const skillFiles = await Promise.all(
      skillPaths.map((path) =>
        input.getProjectFile({
          projectId: input.projectId,
          authToken: input.authToken,
          branchId: input.branchId,
          path,
        })
      ),
    );

    for (const file of skillFiles) {
      if (!file?.content) {
        continue;
      }

      const isFlat = file.path.endsWith(".md") && !file.path.endsWith("/SKILL.md");
      const id = getProjectSkillId(file.path, isFlat);
      if (!id) {
        continue;
      }

      const definition = buildRuntimeSkillDefinition({
        id,
        content: file.content,
        references: getProjectSkillReferences({ allFiles, file, isFlat }),
        logger: input.logger,
      });

      if (definition && !projectSkillsById.has(definition.id)) {
        projectSkillsById.set(definition.id, definition);
      }
    }
  }

  if (projectSkillsById.size === 0) {
    return [...input.builtinSkills];
  }

  const mergedSkillsById = new Map(input.builtinSkills.map((skill) => [skill.id, skill]));
  for (const skill of projectSkillsById.values()) {
    mergedSkillsById.set(skill.id, skill);
  }

  return sortSkillsById(mergedSkillsById.values());
}

function getProjectSkillId(path: string, isFlat: boolean): string | null {
  const pathParts = path.split("/");
  const fileName = pathParts.at(-1);
  if (isFlat) {
    return fileName ? basename(fileName, ".md") : null;
  }

  return pathParts.at(-2) ?? null;
}

function getProjectSkillReferences(input: {
  allFiles: readonly RuntimeProjectFileListItem[];
  file: RuntimeProjectFile;
  isFlat: boolean;
}): string[] {
  if (input.isFlat) {
    return [];
  }

  const skillRootPrefix = input.file.path.replace(/SKILL\.md$/, "");
  const refsPrefix = `${skillRootPrefix}references/`;

  return input.allFiles
    .filter((file) => file.path.startsWith(refsPrefix))
    .map((file) => file.path.slice(skillRootPrefix.length))
    .sort();
}
