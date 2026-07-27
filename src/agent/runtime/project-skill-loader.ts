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
  buildLegacyRuntimeFlatSkillDefinition,
  normalizeStrictRuntimeSkillReferencePath,
  parseStrictRuntimeSkillMetadata,
} from "./skill-metadata.ts";
import {
  SKILL_ID_MAX_LENGTH,
  SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
  SKILL_STEERING_PATH_MAX_ENTRIES,
  SKILL_SUBDIR_MAX_ENTRIES,
} from "#veryfront/skill/limits.ts";
import { parseSkillFileFrontmatter, validateSkillFileMetadata } from "#veryfront/skill/parser.ts";
import { hasControlCharacters, isWellFormedUtf16 } from "#veryfront/skill/string-safety.ts";
import { SKILL_READABLE_DIRS } from "#veryfront/skill/types.ts";

const RUNTIME_SKILL_READABLE_DIR_SET = new Set<string>(SKILL_READABLE_DIRS);

function isRuntimeSkillReadableFilePath(path: string): boolean {
  const separatorIndex = path.indexOf("/");
  return separatorIndex > 0 &&
    RUNTIME_SKILL_READABLE_DIR_SET.has(path.slice(0, separatorIndex));
}

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

/** Public API contract for runtime loaded project skill. */
export type RuntimeLoadedProjectSkill = {
  instructions: string;
  references: string[];
};

/** Public API contract for runtime project skill loader logger. */
export type RuntimeProjectSkillLoaderLogger = {
  warn?: (message: string, metadata?: Record<string, unknown>) => void;
};

type RuntimeProjectSkillReadContext = {
  signal?: AbortSignal;
};

/** Options accepted by runtime project skill loader. */
export type RuntimeProjectSkillLoaderOptions = {
  getProjectFile: (
    options: RuntimeGetProjectFileOptions & { signal?: AbortSignal },
  ) => Promise<RuntimeProjectFile | null>;
  getProjectFiles: (
    options: RuntimeProjectFilesApiOptions & { signal?: AbortSignal },
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
    signal?: AbortSignal,
  ) => Promise<string[]>;
  loadProjectSkill: (
    context: RuntimeProjectSkillContext,
    skillId: string,
    signal?: AbortSignal,
  ) => Promise<RuntimeLoadedProjectSkill | null>;
  loadProjectSkillReference: (
    context: RuntimeProjectSkillContext,
    skillId: string,
    normalizedFile: string,
    signal?: AbortSignal,
  ) => Promise<string | null>;
};

function getSkillPaths(options: RuntimeProjectSkillLoaderOptions): readonly string[] {
  const paths = options.steeringPaths?.skills ?? DEFAULT_PROJECT_STEERING_PATHS.skills;
  if (!Array.isArray(paths)) {
    throw new TypeError("Project skills paths must be an array");
  }
  if (paths.length > SKILL_STEERING_PATH_MAX_ENTRIES) {
    throw new RangeError(
      `Project skills accepts at most ${SKILL_STEERING_PATH_MAX_ENTRIES} paths`,
    );
  }

  const snapshot: string[] = [];
  for (let index = 0; index < paths.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(paths, index);
    if (
      !descriptor ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "string" ||
      normalizeStrictRuntimeSkillReferencePath(descriptor.value) !== descriptor.value
    ) {
      throw new TypeError(`Invalid project skills path at index ${index}`);
    }
    snapshot.push(descriptor.value);
  }
  return Object.freeze(snapshot);
}

function snapshotProjectFileList(value: unknown): readonly RuntimeProjectFileListItem[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Project file listing must be an array");
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

function isAccessDeniedError(
  error: unknown,
  options: RuntimeProjectSkillLoaderOptions,
): boolean {
  return options.isAccessDeniedError?.(error) ?? false;
}

function throwIfProjectSkillReadAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason === undefined
      ? new DOMException("The operation was aborted", "AbortError")
      : signal.reason;
  }
}

async function readProjectSkillValue<T>(
  signal: AbortSignal | undefined,
  read: () => Promise<T>,
): Promise<T> {
  throwIfProjectSkillReadAborted(signal);
  try {
    const value = await read();
    throwIfProjectSkillReadAborted(signal);
    return value;
  } catch (error) {
    throwIfProjectSkillReadAborted(signal);
    throw error;
  }
}

type ProjectSkillSource =
  | { kind: "directory"; skillsPath: string }
  | { kind: "flat"; skillsPath: string }
  | { kind: "explicit"; skillDir: string };

function isSafeRuntimeSkillId(skillId: unknown): skillId is string {
  if (
    typeof skillId !== "string" ||
    skillId.length === 0 ||
    skillId.length > SKILL_ID_MAX_LENGTH ||
    skillId === "." ||
    skillId === ".." ||
    skillId.includes("/") ||
    skillId.includes("\\")
  ) {
    return false;
  }
  return isWellFormedUtf16(skillId) && !hasControlCharacters(skillId);
}

async function getExpectedProjectFile(
  options: RuntimeProjectSkillLoaderOptions,
  request: RuntimeGetProjectFileOptions & RuntimeProjectSkillReadContext,
): Promise<RuntimeProjectFile | null> {
  const file = await readProjectSkillValue(
    request.signal,
    () => options.getProjectFile(request),
  );
  if (
    file !== null &&
    (
      !isRuntimeProjectFilePath(file.path) ||
      file.path !== request.path
    )
  ) {
    throw new TypeError(
      `Project file response path "${file.path}" did not match requested path "${request.path}"`,
    );
  }
  if (file !== null && !isRuntimeProjectFileContent(file.content)) {
    throw new RangeError(`Project file "${request.path}" exceeded its content budget`);
  }
  return file;
}

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
  const sourcePaths = context.skillSourcePaths;
  if (!sourcePaths) {
    return null;
  }

  const descriptor = Object.getOwnPropertyDescriptor(sourcePaths, skillId);
  if (!descriptor) {
    return null;
  }
  if (!("value" in descriptor) || typeof descriptor.value !== "string") {
    throw new TypeError(
      `Catalog source path for skill "${skillId}" must be a string data property`,
    );
  }

  const sourcePath = descriptor.value;
  if (normalizeStrictRuntimeSkillReferencePath(sourcePath) !== sourcePath) {
    throw new TypeError(`Catalog source path for skill "${skillId}" is invalid`);
  }
  if (sourcePath.endsWith("/SKILL.md")) {
    return sourcePath.slice(0, -"/SKILL.md".length);
  }
  if (sourcePath.endsWith(".md")) {
    return null;
  }
  throw new TypeError(`Catalog source path for skill "${skillId}" is not a Skill definition`);
}

async function findProjectSkillSource(input: {
  options: RuntimeProjectSkillLoaderOptions;
  context: RuntimeProjectSkillContext;
  skillId: string;
  signal?: AbortSignal;
}): Promise<ProjectSkillSource | null> {
  const projectId = input.context.projectId;
  if (!projectId || !isSafeRuntimeSkillId(input.skillId)) {
    return null;
  }

  const catalogSkillDir = resolveCatalogSkillDir(input.context, input.skillId);
  if (catalogSkillDir) {
    return { kind: "explicit", skillDir: catalogSkillDir };
  }

  for (const skillsPath of getSkillPaths(input.options)) {
    const directorySkill = await getExpectedProjectFile(input.options, {
      projectId,
      authToken: input.context.authToken,
      branchId: input.context.branchId,
      path: `${skillsPath}/${input.skillId}/SKILL.md`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (directorySkill?.content) {
      return { kind: "directory", skillsPath };
    }

    const flatSkill = await getExpectedProjectFile(input.options, {
      projectId,
      authToken: input.context.authToken,
      branchId: input.context.branchId,
      path: `${skillsPath}/${input.skillId}.md`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
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
  const skillPrefix = `${input.skillDir}/`;
  const references = new Set<string>();
  const entryCountsByDirectory = new Map<string, number>();

  for (const file of input.allFiles) {
    if (!file.path.startsWith(skillPrefix)) {
      continue;
    }

    const relativePath = file.path.slice(skillPrefix.length);
    const separatorIndex = relativePath.indexOf("/");
    if (separatorIndex <= 0) {
      continue;
    }
    const directory = relativePath.slice(0, separatorIndex);
    if (!RUNTIME_SKILL_READABLE_DIR_SET.has(directory)) {
      continue;
    }

    const normalizedReference = normalizeStrictRuntimeSkillReferencePath(relativePath);
    if (!normalizedReference || references.has(normalizedReference)) {
      continue;
    }

    const directoryEntryCount = (entryCountsByDirectory.get(directory) ?? 0) + 1;
    if (directoryEntryCount > SKILL_SUBDIR_MAX_ENTRIES) {
      throw new RangeError(
        `Project skill ${directory}/ may contain at most ${SKILL_SUBDIR_MAX_ENTRIES} entries`,
      );
    }
    entryCountsByDirectory.set(directory, directoryEntryCount);

    references.add(normalizedReference);
    if (references.size > SKILL_LOADABLE_REFERENCE_MAX_ENTRIES) {
      throw new RangeError(
        `Project skill may advertise at most ${SKILL_LOADABLE_REFERENCE_MAX_ENTRIES} readable files`,
      );
    }
  }

  return [...references].sort();
}

async function listProjectSkillReferences(input: {
  options: RuntimeProjectSkillLoaderOptions;
  context: RuntimeProjectSkillContext;
  skillId: string;
  skillsPath?: string;
  signal?: AbortSignal;
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

  const allFiles = snapshotProjectFileList(
    await readProjectSkillValue(input.signal, () =>
      input.options.getProjectFiles({
        projectId,
        authToken: input.context.authToken,
        branchId: input.context.branchId,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      })),
  );

  return collectProjectSkillReferences({
    allFiles,
    skillDir,
  });
}

async function isValidLoadedProjectSkill(input: {
  options: RuntimeProjectSkillLoaderOptions;
  source: ProjectSkillSource;
  skillId: string;
  content: string;
}): Promise<boolean> {
  if (input.source.kind === "flat") {
    const valid = buildLegacyRuntimeFlatSkillDefinition({
      id: input.skillId,
      content: input.content,
    }) !== null;
    if (!valid) {
      input.options.logger?.warn?.(
        "Project flat skill changed to invalid metadata; refusing to load it",
        { skillId: input.skillId },
      );
    }
    return valid;
  }

  const skillDir = getSkillDir(input.source, input.skillId);
  const directoryName = skillDir?.split("/").at(-1);
  if (!directoryName || parseStrictRuntimeSkillMetadata(input.content) === null) {
    input.options.logger?.warn?.(
      "Project skill changed to invalid runtime metadata; refusing to load it",
      { skillId: input.skillId },
    );
    return false;
  }

  try {
    const parsed = await parseSkillFileFrontmatter(input.content);
    validateSkillFileMetadata(parsed.frontmatter, directoryName);
    return true;
  } catch (error) {
    input.options.logger?.warn?.("Project skill changed to invalid metadata; refusing to load it", {
      skillId: input.skillId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function loadProjectSkill(input: {
  options: RuntimeProjectSkillLoaderOptions;
  context: RuntimeProjectSkillContext;
  skillId: string;
  signal?: AbortSignal;
}): Promise<RuntimeLoadedProjectSkill | null> {
  const projectId = input.context.projectId;
  if (!projectId || !isSafeRuntimeSkillId(input.skillId)) {
    return null;
  }

  try {
    const catalogSkillDir = resolveCatalogSkillDir(input.context, input.skillId);
    if (catalogSkillDir) {
      const source: ProjectSkillSource = { kind: "explicit", skillDir: catalogSkillDir };
      const catalogSkill = await getExpectedProjectFile(input.options, {
        projectId,
        authToken: input.context.authToken,
        branchId: input.context.branchId,
        path: `${catalogSkillDir}/SKILL.md`,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
      if (
        catalogSkill?.content &&
        await isValidLoadedProjectSkill({
          options: input.options,
          source,
          skillId: input.skillId,
          content: catalogSkill.content,
        })
      ) {
        return {
          instructions: catalogSkill.content,
          references: await listProjectSkillReferences(input),
        };
      }
      return null;
    }

    for (const skillsPath of getSkillPaths(input.options)) {
      const directorySource: ProjectSkillSource = { kind: "directory", skillsPath };
      const directorySkill = await getExpectedProjectFile(input.options, {
        projectId,
        authToken: input.context.authToken,
        branchId: input.context.branchId,
        path: `${skillsPath}/${input.skillId}/SKILL.md`,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });

      if (directorySkill?.content) {
        if (
          !await isValidLoadedProjectSkill({
            options: input.options,
            source: directorySource,
            skillId: input.skillId,
            content: directorySkill.content,
          })
        ) {
          return null;
        }
        return {
          instructions: directorySkill.content,
          references: await listProjectSkillReferences({ ...input, skillsPath }),
        };
      }

      const flatSource: ProjectSkillSource = { kind: "flat", skillsPath };
      const flatSkill = await getExpectedProjectFile(input.options, {
        projectId,
        authToken: input.context.authToken,
        branchId: input.context.branchId,
        path: `${skillsPath}/${input.skillId}.md`,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });

      if (flatSkill?.content) {
        if (
          !await isValidLoadedProjectSkill({
            options: input.options,
            source: flatSource,
            skillId: input.skillId,
            content: flatSkill.content,
          })
        ) {
          return null;
        }
        return {
          instructions: flatSkill.content,
          references: [],
        };
      }
    }
  } catch (error) {
    throwIfProjectSkillReadAborted(input.signal);
    if (isAccessDeniedError(error, input.options)) {
      if (
        Object.prototype.hasOwnProperty.call(input.context.skillSourcePaths ?? {}, input.skillId)
      ) {
        throw error;
      }
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
  signal?: AbortSignal;
}): Promise<string | null> {
  const projectId = input.context.projectId;
  if (
    !projectId ||
    !isSafeRuntimeSkillId(input.skillId) ||
    normalizeStrictRuntimeSkillReferencePath(input.normalizedFile) !== input.normalizedFile ||
    !isRuntimeSkillReadableFilePath(input.normalizedFile)
  ) {
    return null;
  }

  try {
    const source = await findProjectSkillSource(input);
    const skillDir = source ? getSkillDir(source, input.skillId) : null;
    if (!skillDir) {
      return null;
    }

    const projectFile = await getExpectedProjectFile(input.options, {
      projectId,
      authToken: input.context.authToken,
      branchId: input.context.branchId,
      path: `${skillDir}/${input.normalizedFile}`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (projectFile !== null) {
      return projectFile.content;
    }
  } catch (error) {
    throwIfProjectSkillReadAborted(input.signal);
    if (!isAccessDeniedError(error, input.options)) {
      throw error;
    }
    if (Object.prototype.hasOwnProperty.call(input.context.skillSourcePaths ?? {}, input.skillId)) {
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
    listProjectSkillReferences: (context, skillId, signal) =>
      listProjectSkillReferences({ options, context, skillId, signal }),
    loadProjectSkill: (context, skillId, signal) =>
      loadProjectSkill({ options, context, skillId, signal }),
    loadProjectSkillReference: (context, skillId, normalizedFile, signal) =>
      loadProjectSkillReference({ options, context, skillId, normalizedFile, signal }),
  };
}
