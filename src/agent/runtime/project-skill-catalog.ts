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
  isRuntimeProjectFileContent,
  isRuntimeProjectFilePath,
  MAX_RUNTIME_PROJECT_FILES_TOTAL_ITEMS,
} from "./project-files-client.ts";
import {
  listRuntimeBuiltinSkillReferences,
  readRuntimeBuiltinDirectorySkill,
  readRuntimeBuiltinFlatSkill,
  readRuntimeBuiltinSkillEntries,
} from "./builtin-skill-files.ts";
import {
  buildLegacyRuntimeFlatSkillDefinition,
  buildRuntimeDirectorySkillDefinition,
  normalizeStrictRuntimeSkillReferencePath,
  type RuntimeSkillDefinition,
  type RuntimeSkillMetadataLogger,
} from "./skill-metadata.ts";
import {
  SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
  SKILL_STEERING_PATH_MAX_ENTRIES,
  SKILL_SUBDIR_MAX_ENTRIES,
} from "#veryfront/skill/limits.ts";
import { SKILL_READABLE_DIRS } from "#veryfront/skill/types.ts";

const PROJECT_SKILL_FETCH_CONCURRENCY = 16;

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
};

/** Options accepted by runtime project instructions. */
export type RuntimeProjectInstructionsOptions = {
  getProjectFile: (options: RuntimeGetProjectFileOptions) => Promise<RuntimeProjectFile | null>;
  steeringPaths?: Pick<ProjectSteeringPaths, "instructions">;
};

function sortSkillsById(skills: Iterable<RuntimeSkillDefinition>): RuntimeSkillDefinition[] {
  return [...skills].sort((a, b) => a.id.localeCompare(b.id));
}

function requireBuiltinSkills(
  value: readonly RuntimeSkillDefinition[],
): readonly RuntimeSkillDefinition[] {
  if (!Array.isArray(value)) {
    throw new TypeError("builtinSkills must be an array");
  }
  if (value.length > SKILL_SUBDIR_MAX_ENTRIES) {
    throw new RangeError(
      `builtinSkills accepts at most ${SKILL_SUBDIR_MAX_ENTRIES} definitions`,
    );
  }
  return value;
}

function snapshotProjectFileList(
  value: readonly RuntimeProjectFileListItem[] | null,
): readonly RuntimeProjectFileListItem[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) {
    throw new TypeError("Project file listing must be an array or null");
  }
  if (value.length > MAX_RUNTIME_PROJECT_FILES_TOTAL_ITEMS) {
    throw new RangeError(
      `Project file listing exceeds ${MAX_RUNTIME_PROJECT_FILES_TOTAL_ITEMS} files`,
    );
  }

  const snapshot: RuntimeProjectFileListItem[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const itemDescriptor = Object.getOwnPropertyDescriptor(value, index);
    const item = itemDescriptor && "value" in itemDescriptor ? itemDescriptor.value : undefined;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new TypeError(`Project file listing item ${index} must be an object`);
    }
    const pathDescriptor = Object.getOwnPropertyDescriptor(item, "path");
    const path = pathDescriptor && "value" in pathDescriptor ? pathDescriptor.value : undefined;
    if (!isRuntimeProjectFilePath(path)) {
      throw new TypeError(`Project file listing item ${index} has an invalid path`);
    }
    snapshot.push(Object.freeze({ path }));
  }
  return Object.freeze(snapshot);
}

function normalizeSteeringPaths(
  value: readonly string[],
  label: string,
): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} paths must be an array`);
  }
  if (value.length > SKILL_STEERING_PATH_MAX_ENTRIES) {
    throw new RangeError(
      `${label} accepts at most ${SKILL_STEERING_PATH_MAX_ENTRIES} paths`,
    );
  }

  const paths: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (
      !descriptor ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "string" ||
      normalizeStrictRuntimeSkillReferencePath(descriptor.value) !== descriptor.value
    ) {
      throw new TypeError(`Invalid ${label} path at index ${index}`);
    }
    paths.push(descriptor.value);
  }
  return Object.freeze(paths);
}

function getSkillPaths(
  options: Pick<RuntimeProjectSkillCatalogOptions, "steeringPaths">,
): readonly string[] {
  return normalizeSteeringPaths(
    options.steeringPaths?.skills ?? DEFAULT_PROJECT_STEERING_PATHS.skills,
    "project skill steering",
  );
}

function getInstructionPaths(options: RuntimeProjectInstructionsOptions): readonly string[] {
  return normalizeSteeringPaths(
    options.steeringPaths?.instructions ?? DEFAULT_PROJECT_STEERING_PATHS.instructions,
    "project instruction steering",
  );
}

function claimProjectSkillId(claimedIds: Set<string>, id: string): boolean {
  if (claimedIds.has(id)) return false;
  if (claimedIds.size >= SKILL_SUBDIR_MAX_ENTRIES) {
    throw new RangeError(
      `Project may declare at most ${SKILL_SUBDIR_MAX_ENTRIES} skills`,
    );
  }
  claimedIds.add(id);
  return true;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  fn: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  let stopped = false;
  let didFail = false;
  let firstFailure: unknown;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (!stopped) {
        const index = nextIndex;
        if (index >= values.length) {
          return;
        }
        nextIndex += 1;
        try {
          results[index] = await fn(values[index]!, index);
        } catch (error) {
          if (!didFail) {
            didFail = true;
            firstFailure = error;
          }
          stopped = true;
        }
      }
    },
  );
  await Promise.all(workers);
  if (didFail) {
    throw firstFailure;
  }
  return results;
}

function isImmediateDirectorySkillPath(path: string, prefixWithSlash: string): boolean {
  if (!path.startsWith(prefixWithSlash)) {
    return false;
  }

  const segments = path.slice(prefixWithSlash.length).split("/");
  return segments.length === 2 && segments[0]!.length > 0 && segments[1] === "SKILL.md";
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

        const definition = buildLegacyRuntimeFlatSkillDefinition({
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

        const definition = buildRuntimeDirectorySkillDefinition({
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
  for (const filePath of getInstructionPaths(input)) {
    const file = await input.getProjectFile({
      projectId: input.projectId,
      authToken: input.authToken,
      branchId: input.branchId,
      path: filePath,
    });

    if (file !== null && file.path !== filePath) {
      throw new TypeError(
        `Project instruction response path "${file.path}" did not match requested path "${filePath}"`,
      );
    }
    if (file !== null && !isRuntimeProjectFileContent(file.content)) {
      throw new RangeError("Project instruction content exceeds the shared Skill file budget");
    }
    if (file?.content) {
      return file.content;
    }
  }

  return "";
}

/** Return runtime project skill catalog. */
export async function getRuntimeProjectSkillCatalog(
  input: RuntimeProjectSteeringLookup & RuntimeProjectSkillCatalogOptions,
): Promise<RuntimeSkillDefinition[]> {
  const builtinSkills = requireBuiltinSkills(input.builtinSkills);
  const allFiles = snapshotProjectFileList(
    await input.getProjectFiles({
      projectId: input.projectId,
      authToken: input.authToken,
      branchId: input.branchId,
    }),
  );
  if (!allFiles || allFiles.length === 0) {
    return [...builtinSkills];
  }

  const projectSkillsById = new Map<string, RuntimeSkillDefinition>();
  // A declared project skill shadows lower-precedence flat files and built-ins
  // even when its content is missing or invalid. Falling through on a broken
  // higher-precedence policy would re-enable capabilities unexpectedly.
  const claimedProjectSkillIds = new Set<string>();
  const agentIds = getProjectAgentIds(allFiles);
  assertUniqueCapabilityNamespaces(agentIds);

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
      .filter((file) => isImmediateDirectorySkillPath(file.path, prefixWithSlash))
      .map((file) => file.path);

    const candidates = [...dirPaths.sort(), ...flatPaths.sort()].flatMap((path) => {
      const isFlat = path.endsWith(".md") && !path.endsWith("/SKILL.md");
      const id = getProjectSkillId(path, isFlat);
      if (!id || !claimProjectSkillId(claimedProjectSkillIds, id)) return [];
      return [{ id, isFlat, path }];
    });
    if (candidates.length === 0) {
      continue;
    }

    const skillFiles = await mapWithConcurrency(
      candidates,
      PROJECT_SKILL_FETCH_CONCURRENCY,
      ({ path }) =>
        input.getProjectFile({
          projectId: input.projectId,
          authToken: input.authToken,
          branchId: input.branchId,
          path,
        }),
    );

    for (let index = 0; index < skillFiles.length; index += 1) {
      const candidate = candidates[index]!;
      const file = skillFiles[index];
      if (!file?.content) {
        continue;
      }
      if (file.path !== candidate.path) {
        input.logger?.error?.(
          "Project skill response path did not match its request; skipping skill",
          {
            expectedPath: candidate.path,
            responsePath: file.path,
          },
        );
        continue;
      }
      if (!isRuntimeProjectFileContent(file.content)) {
        input.logger?.error?.("Project skill content exceeded its budget; skipping skill", {
          path: candidate.path,
        });
        continue;
      }

      const definition = candidate.isFlat
        ? buildLegacyRuntimeFlatSkillDefinition({
          id: candidate.id,
          content: file.content,
          sourcePath: candidate.path,
          logger: input.logger,
        })
        : buildRuntimeDirectorySkillDefinition({
          id: candidate.id,
          content: file.content,
          references: getProjectSkillReferences({
            allFiles,
            file: { ...file, path: candidate.path },
            isFlat: false,
          }),
          sourcePath: candidate.path,
          logger: input.logger,
        });

      if (definition) {
        projectSkillsById.set(definition.id, definition);
      }
    }
  }

  // Colocated (agent-owned) skills: agents/{id}/SKILL.md (the agent's own
  // skill) and agents/{id}/skills/{sub}/SKILL.md. Registered with owner
  // metadata so per-run filtering and the source-path loader can apply the
  // one owner-aware rule; ids match framework/control-plane discovery.
  const colocatedCandidates = allFiles
    .map((file) => ({
      identity: getColocatedSkillIdentity(file.path),
      path: file.path,
    }))
    .filter(
      (
        candidate,
      ): candidate is { identity: ColocatedSkillIdentity; path: string } =>
        candidate.identity !== null && agentIds.has(candidate.identity.ownerAgentId),
    )
    .sort((left, right) => left.path.localeCompare(right.path))
    .filter((candidate) => {
      return claimProjectSkillId(claimedProjectSkillIds, candidate.identity.id);
    });

  if (colocatedCandidates.length > 0) {
    const colocatedFiles = await mapWithConcurrency(
      colocatedCandidates,
      PROJECT_SKILL_FETCH_CONCURRENCY,
      ({ path }) =>
        input.getProjectFile({
          projectId: input.projectId,
          authToken: input.authToken,
          branchId: input.branchId,
          path,
        }),
    );

    for (let index = 0; index < colocatedFiles.length; index += 1) {
      const candidate = colocatedCandidates[index]!;
      const file = colocatedFiles[index];
      if (!file?.content) {
        continue;
      }
      if (file.path !== candidate.path) {
        input.logger?.error?.(
          "Project skill response path did not match its request; skipping skill",
          {
            expectedPath: candidate.path,
            responsePath: file.path,
          },
        );
        continue;
      }
      if (!isRuntimeProjectFileContent(file.content)) {
        input.logger?.error?.("Project skill content exceeded its budget; skipping skill", {
          path: candidate.path,
        });
        continue;
      }

      const definition = buildRuntimeDirectorySkillDefinition({
        id: candidate.identity.id,
        content: file.content,
        references: getProjectSkillReferences({
          allFiles,
          file: { ...file, path: candidate.path },
          isFlat: false,
        }),
        ownerAgentId: candidate.identity.ownerAgentId,
        shortName: candidate.identity.shortName,
        sourcePath: candidate.path,
        logger: input.logger,
      });

      if (definition) {
        projectSkillsById.set(definition.id, definition);
      }
    }
  }

  const mergedSkillsById = new Map(
    builtinSkills
      .filter((skill) => !claimedProjectSkillIds.has(skill.id))
      .map((skill) => [skill.id, skill]),
  );
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
const COLOCATED_AGENT_DEFINITION_REGEX = /^agents\/([^/]+)\/AGENT\.md$/;

type ColocatedSkillIdentity = {
  id: string;
  ownerAgentId: string;
  shortName: string;
};

function getProjectAgentIds(
  allFiles: readonly RuntimeProjectFileListItem[],
): ReadonlySet<string> {
  const agentIds = new Set<string>();
  for (const file of allFiles) {
    const agentId = file.path.match(COLOCATED_AGENT_DEFINITION_REGEX)?.[1];
    if (agentId) {
      agentIds.add(agentId);
    }
  }
  return agentIds;
}

function assertUniqueCapabilityNamespaces(agentIds: ReadonlySet<string>): void {
  const ownersByNamespace = new Map<string, string>();
  for (const agentId of [...agentIds].sort()) {
    const namespace = sanitizeCapabilityNamespace(agentId);
    const existingAgentId = ownersByNamespace.get(namespace);
    if (existingAgentId && existingAgentId !== agentId) {
      throw new TypeError(
        `Agent ids "${existingAgentId}" and "${agentId}" collide after sanitized capability namespace "${namespace}"`,
      );
    }
    ownersByNamespace.set(namespace, agentId);
  }
}

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
  const references = new Set<string>();

  for (const directory of SKILL_READABLE_DIRS) {
    const directoryPrefix = `${skillRootPrefix}${directory}/`;
    let directoryEntryCount = 0;
    for (const file of input.allFiles) {
      if (!file.path.startsWith(directoryPrefix)) {
        continue;
      }

      const relativePath = file.path.slice(skillRootPrefix.length);
      if (references.has(relativePath)) {
        continue;
      }
      directoryEntryCount += 1;
      if (directoryEntryCount > SKILL_SUBDIR_MAX_ENTRIES) {
        throw new RangeError(
          `Project skill ${directory}/ may contain at most ${SKILL_SUBDIR_MAX_ENTRIES} entries`,
        );
      }

      references.add(relativePath);
      if (references.size > SKILL_LOADABLE_REFERENCE_MAX_ENTRIES) {
        throw new RangeError(
          `Project skill may advertise at most ${SKILL_LOADABLE_REFERENCE_MAX_ENTRIES} readable files`,
        );
      }
    }
  }

  return [...references].sort();
}
