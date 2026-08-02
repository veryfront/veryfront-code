import { basename } from "node:path";
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

/** Public API contract for runtime project steering lookup. */
export type RuntimeProjectSteeringLookup = {
  projectId: string;
  authToken: string;
  branchId?: string | null;
};

/** Options accepted by runtime project skill catalog. */
export type RuntimeProjectSkillCatalogOptions = {
  getProjectFile: (options: RuntimeGetProjectFileOptions) => Promise<RuntimeProjectFile | null>;
  getProjectFiles: (
    options: RuntimeProjectFilesApiOptions,
  ) => Promise<readonly RuntimeProjectFileListItem[] | null>;
  builtinSkills: readonly RuntimeSkillDefinition[];
  steeringPaths?: Pick<ProjectSteeringPaths, "skills">;
  logger?: RuntimeSkillMetadataLogger;
  operationBudget?: SkillOperationBudget;
};

/** Options accepted by runtime project instructions. */
export type RuntimeProjectInstructionsOptions = {
  getProjectFile: (options: RuntimeGetProjectFileOptions) => Promise<RuntimeProjectFile | null>;
  steeringPaths?: Pick<ProjectSteeringPaths, "instructions">;
  operationBudget?: SkillOperationBudget;
};

function sortSkillsById(skills: Iterable<RuntimeSkillDefinition>): RuntimeSkillDefinition[] {
  return [...skills].sort((a, b) => a.id.localeCompare(b.id));
}

function getSkillPaths(options: Pick<RuntimeProjectSkillCatalogOptions, "steeringPaths">) {
  const paths = options.steeringPaths?.skills ?? DEFAULT_PROJECT_STEERING_PATHS.skills;
  assertSteeringPathCount(paths);
  return paths;
}

function getInstructionPaths(options: RuntimeProjectInstructionsOptions) {
  const paths = options.steeringPaths?.instructions ?? DEFAULT_PROJECT_STEERING_PATHS.instructions;
  assertSteeringPathCount(paths);
  return paths;
}

function assertSteeringPathCount(paths: readonly string[]): void {
  if (paths.length > SKILL_STEERING_PATH_MAX_ENTRIES) {
    throw new RangeError(
      `Project steering paths may contain at most ${SKILL_STEERING_PATH_MAX_ENTRIES} entries`,
    );
  }
}

function assertCatalogContent(content: string, label: string): void {
  if (content.length > SKILL_DOCUMENT_MAX_CHARACTERS) {
    throw new RangeError(
      `${label} may contain at most ${SKILL_DOCUMENT_MAX_CHARACTERS} characters`,
    );
  }
}

function createCatalogBudget(existing?: SkillOperationBudget): SkillOperationBudget {
  return existing ?? createSkillOperationBudget({ timeoutMs: SKILL_FILE_OPERATION_TIMEOUT_MS });
}

/** Loads runtime builtin skill catalog. */
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

/** Return runtime project instructions. */
export async function getRuntimeProjectInstructions(
  input: RuntimeProjectSteeringLookup & RuntimeProjectInstructionsOptions,
): Promise<string> {
  const budget = createCatalogBudget(input.operationBudget);
  for (const filePath of getInstructionPaths(input)) {
    const file = await budget.run(() =>
      input.getProjectFile({
        projectId: input.projectId,
        authToken: input.authToken,
        branchId: input.branchId,
        path: filePath,
        maximumContentCharacters: SKILL_DOCUMENT_MAX_CHARACTERS,
      })
    );

    if (file?.content) {
      assertCatalogContent(file.content, "Project instructions");
      return file.content;
    }
  }

  return "";
}

/** Return runtime project skill catalog. */
export async function getRuntimeProjectSkillCatalog(
  input: RuntimeProjectSteeringLookup & RuntimeProjectSkillCatalogOptions,
): Promise<RuntimeSkillDefinition[]> {
  const budget = createCatalogBudget(input.operationBudget);
  if (input.builtinSkills.length > SKILL_SUBDIR_MAX_ENTRIES) {
    throw new RangeError(`Skill catalog may contain at most ${SKILL_SUBDIR_MAX_ENTRIES} entries`);
  }
  const allFiles = await budget.run(() =>
    input.getProjectFiles({
      projectId: input.projectId,
      authToken: input.authToken,
      branchId: input.branchId,
      maximumEntries: SKILL_SUBDIR_MAX_ENTRIES,
    })
  );
  if (!allFiles || allFiles.length === 0) {
    return [...input.builtinSkills];
  }
  if (allFiles.length > SKILL_SUBDIR_MAX_ENTRIES) {
    throw new RangeError(
      `Project skill file listing may contain at most ${SKILL_SUBDIR_MAX_ENTRIES} entries`,
    );
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

    for (const path of skillPaths) {
      const file = await budget.run(() =>
        input.getProjectFile({
          projectId: input.projectId,
          authToken: input.authToken,
          branchId: input.branchId,
          path,
          maximumContentCharacters: SKILL_DOCUMENT_MAX_CHARACTERS,
        })
      );
      if (!file?.content) {
        continue;
      }
      assertCatalogContent(file.content, "Skill document");

      const isFlat = file.path.endsWith(".md") && !file.path.endsWith("/SKILL.md");
      const id = getProjectSkillId(file.path, isFlat);
      if (!id) {
        continue;
      }

      const definition = buildRuntimeSkillDefinition({
        id,
        content: file.content,
        references: getProjectSkillReferences({ allFiles, file, isFlat }),
        sourcePath: file.path,
        logger: input.logger,
      });

      if (definition && !projectSkillsById.has(definition.id)) {
        projectSkillsById.set(definition.id, definition);
      }
    }
  }

  // Colocated (agent-owned) skills: agents/{id}/SKILL.md (the agent's own
  // skill) and agents/{id}/skills/{sub}/SKILL.md. Registered with owner
  // metadata so per-run filtering and the source-path loader can apply the
  // one owner-aware rule; ids match framework/control-plane discovery.
  const colocatedPaths = allFiles
    .map((file) => file.path)
    .filter((path) => getColocatedSkillIdentity(path) !== null)
    .sort();

  if (colocatedPaths.length > 0) {
    for (const path of colocatedPaths) {
      const file = await budget.run(() =>
        input.getProjectFile({
          projectId: input.projectId,
          authToken: input.authToken,
          branchId: input.branchId,
          path,
          maximumContentCharacters: SKILL_DOCUMENT_MAX_CHARACTERS,
        })
      );
      if (!file?.content) {
        continue;
      }
      assertCatalogContent(file.content, "Colocated skill document");
      const identity = getColocatedSkillIdentity(file.path);
      if (!identity) {
        continue;
      }

      const definition = buildRuntimeSkillDefinition({
        id: identity.id,
        content: file.content,
        references: getProjectSkillReferences({ allFiles, file, isFlat: false }),
        ownerAgentId: identity.ownerAgentId,
        shortName: identity.shortName,
        sourcePath: file.path,
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

/**
 * Owned-capability namespace rule. Mirrors discovery
 * (src/discovery/agent-scoped-capabilities.ts) and the control plane's skill
 * source derivation; duplicated locally because the runtime layer must not
 * import from discovery.
 */
const AGENT_CAPABILITY_NAMESPACE_SEPARATOR = "--";

function sanitizeCapabilityNamespace(agentId: string): string {
  return agentId.replace(/[^A-Za-z0-9_-]/g, "_");
}

const COLOCATED_OWN_SKILL_REGEX = /^agents\/([^/]+)\/SKILL\.md$/;
const COLOCATED_NESTED_SKILL_REGEX = /^agents\/([^/]+)\/skills\/([^/]+)\/SKILL\.md$/;

type ColocatedSkillIdentity = {
  id: string;
  ownerAgentId: string;
  shortName: string;
};

function getColocatedSkillIdentity(path: string): ColocatedSkillIdentity | null {
  const nested = path.match(COLOCATED_NESTED_SKILL_REGEX);
  const nestedAgentId = nested?.[1];
  const nestedShortName = nested?.[2];
  if (nestedAgentId && nestedShortName) {
    return {
      id: `${
        sanitizeCapabilityNamespace(nestedAgentId)
      }${AGENT_CAPABILITY_NAMESPACE_SEPARATOR}${nestedShortName}`,
      ownerAgentId: nestedAgentId,
      shortName: nestedShortName,
    };
  }

  const ownAgentId = path.match(COLOCATED_OWN_SKILL_REGEX)?.[1];
  if (ownAgentId) {
    return { id: ownAgentId, ownerAgentId: ownAgentId, shortName: ownAgentId };
  }

  return null;
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

  const references = input.allFiles
    .filter((file) => file.path.startsWith(refsPrefix))
    .map((file) => file.path.slice(skillRootPrefix.length))
    .sort();
  if (references.length > SKILL_SUBDIR_MAX_ENTRIES) {
    throw new RangeError(
      `Skill references may contain at most ${SKILL_SUBDIR_MAX_ENTRIES} entries`,
    );
  }
  return references;
}
