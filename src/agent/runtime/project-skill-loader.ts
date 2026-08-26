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
import { isRuntimeProjectFileContent, isRuntimeProjectFilePath } from "./project-files-client.ts";
import {
  buildLegacyRuntimeFlatSkillDefinition,
  isValidStrictRuntimeSkillFileDocument,
  normalizeStrictRuntimeSkillReferencePath,
} from "./skill-metadata.ts";
import {
  createSkillOperationBudget,
  type SkillOperationBudget,
} from "#veryfront/skill/operation-budget.ts";
import {
  SKILL_DOCUMENT_MAX_CHARACTERS,
  SKILL_FILE_OPERATION_TIMEOUT_MS,
  SKILL_ID_MAX_LENGTH,
  SKILL_LOADABLE_REFERENCE_LISTING_MAX_ENTRIES,
  SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
  SKILL_STEERING_PATH_MAX_ENTRIES,
  SKILL_SUBDIR_MAX_ENTRIES,
} from "#veryfront/skill/limits.ts";
import type { SkillDocumentParserProvider } from "#veryfront/extensions/parser/skill-document-parser.ts";
import { hasControlCharacters, isWellFormedUtf16 } from "#veryfront/skill/string-safety.ts";
import { SKILL_READABLE_DIRS } from "#veryfront/skill/types.ts";
import {
  isOwnDataPropertyDescriptor,
  readOwnDataProperty,
  snapshotOwnDataPropertyArray,
} from "./data-property-descriptor.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

const RUNTIME_SKILL_READABLE_DIR_SET = new Set<string>(SKILL_READABLE_DIRS);
const ArrayIsArray = Array.isArray;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ReflectApply = Reflect.apply;

function hasOwnProperty(value: Readonly<Record<string, string>>, key: PropertyKey): boolean {
  return ReflectApply(ObjectPrototypeHasOwnProperty, value, [key]) as boolean;
}

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

type RuntimeProjectSkillReadContext = {
  budget: SkillOperationBudget;
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
  skillDocumentParserProvider?: SkillDocumentParserProvider;
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
  return snapshotOwnDataPropertyArray(paths, {
    label: "Project skills paths",
    maximumEntries: SKILL_STEERING_PATH_MAX_ENTRIES,
    mapValue: (value, index) => {
      if (
        typeof value !== "string" ||
        normalizeStrictRuntimeSkillReferencePath(value) !== value
      ) {
        throw new TypeError(`Invalid project skills path at index ${index}`);
      }
      return value;
    },
  });
}

function isNonArrayObject(value: unknown): value is Record<PropertyKey, unknown> {
  if (!value || typeof value !== "object") return false;
  try {
    return !ArrayIsArray(value);
  } catch {
    return false;
  }
}

function snapshotProjectFileList(value: unknown): readonly RuntimeProjectFileListItem[] {
  return snapshotOwnDataPropertyArray(value, {
    label: "Project file listing",
    maximumEntries: SKILL_LOADABLE_REFERENCE_LISTING_MAX_ENTRIES,
    mapValue: (item, index) => {
      if (!isNonArrayObject(item)) {
        throw new TypeError(`Project file listing item ${index} must be an object`);
      }
      const path = readOwnDataProperty(
        item,
        "path",
        `Project file listing item ${index}`,
      );
      if (!isRuntimeProjectFilePath(path)) {
        throw new TypeError(`Project file listing item ${index} has an invalid path`);
      }
      return Object.freeze({ path });
    },
  });
}

function isAccessDeniedError(
  error: unknown,
  options: RuntimeProjectSkillLoaderOptions,
): boolean {
  return options.isAccessDeniedError?.(error) ?? false;
}

function getProjectSkillCancellationOptions(
  budget: SkillOperationBudget,
): Pick<RuntimeProjectFilesApiOptions, "abortSignal" | "timeoutMs"> & {
  signal?: AbortSignal;
} {
  budget.throwIfTerminated();
  const timeoutMs = budget.remainingMs();
  if (timeoutMs === 0) {
    budget.throwIfTerminated();
  }
  return {
    ...(budget.abortSignal === undefined
      ? {}
      : { abortSignal: budget.abortSignal, signal: budget.abortSignal }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

function getBoundedProjectSkillFileOptions(
  budget: SkillOperationBudget,
): Pick<RuntimeGetProjectFileOptions, "abortSignal" | "maximumContentCharacters" | "timeoutMs"> & {
  signal?: AbortSignal;
} {
  return {
    ...getProjectSkillCancellationOptions(budget),
    maximumContentCharacters: SKILL_DOCUMENT_MAX_CHARACTERS,
  };
}

type ProjectSkillSource =
  | { kind: "directory"; skillsPath: string }
  | { kind: "flat"; skillsPath: string }
  | { kind: "explicit"; skillDir: string }
  | { kind: "explicit-flat"; skillPath: string };

function isProviderSafeCatalogSkillSource(source: ProjectSkillSource): boolean {
  return source.kind === "explicit" &&
    /^agents\/[^/]+(?:\/skills\/[^/]+)?$/.test(source.skillDir);
}

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
  const { budget, ...fileRequest } = request;
  const file = await budget.run(() =>
    options.getProjectFile({
      ...fileRequest,
      ...getBoundedProjectSkillFileOptions(budget),
    })
  );
  if (
    file !== null &&
    (
      !isRuntimeProjectFilePath(file.path) ||
      file.path !== fileRequest.path
    )
  ) {
    throw new TypeError(
      `Project file response path "${file.path}" did not match requested path "${fileRequest.path}"`,
    );
  }
  if (file !== null && !isRuntimeProjectFileContent(file.content)) {
    throw new RangeError(`Project file "${fileRequest.path}" exceeded its content budget`);
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

/** Resolves a skill's exact source from the per-run catalog snapshot, if any. */
function resolveCatalogSkillSource(
  context: RuntimeProjectSkillContext,
  skillId: string,
): ProjectSkillSource | null {
  const sourcePaths = context.skillSourcePaths;
  if (!sourcePaths) {
    return null;
  }

  const descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
    sourcePaths,
    skillId,
  ]) as PropertyDescriptor | undefined;
  if (!descriptor) {
    return null;
  }
  if (!isOwnDataPropertyDescriptor(descriptor) || typeof descriptor.value !== "string") {
    throw new TypeError(
      `Catalog source path for skill "${skillId}" must be a string data property`,
    );
  }

  const sourcePath = descriptor.value;
  if (normalizeStrictRuntimeSkillReferencePath(sourcePath) !== sourcePath) {
    throw new TypeError(`Catalog source path for skill "${skillId}" is invalid`);
  }
  if (sourcePath.endsWith("/SKILL.md")) {
    return {
      kind: "explicit",
      skillDir: sourcePath.slice(0, -"/SKILL.md".length),
    };
  }
  if (sourcePath.endsWith(".md")) {
    return { kind: "explicit-flat", skillPath: sourcePath };
  }
  throw new TypeError(`Catalog source path for skill "${skillId}" is not a Skill definition`);
}

async function findProjectSkillSource(
  input: {
    options: RuntimeProjectSkillLoaderOptions;
    context: RuntimeProjectSkillContext;
    skillId: string;
  } & RuntimeProjectSkillReadContext,
): Promise<ProjectSkillSource | null> {
  const projectId = input.context.projectId;
  if (!projectId || !isSafeRuntimeSkillId(input.skillId)) {
    return null;
  }

  const catalogSkillSource = resolveCatalogSkillSource(input.context, input.skillId);
  if (catalogSkillSource) {
    return catalogSkillSource;
  }

  for (const skillsPath of getSkillPaths(input.options)) {
    const directorySkill = await getExpectedProjectFile(input.options, {
      projectId,
      authToken: input.context.authToken,
      branchId: input.context.branchId,
      path: `${skillsPath}/${input.skillId}/SKILL.md`,
      budget: input.budget,
    });
    if (directorySkill?.content) {
      return { kind: "directory", skillsPath };
    }

    const flatSkill = await getExpectedProjectFile(input.options, {
      projectId,
      authToken: input.context.authToken,
      branchId: input.context.branchId,
      path: `${skillsPath}/${input.skillId}.md`,
      budget: input.budget,
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
  if (input.allFiles.length > SKILL_LOADABLE_REFERENCE_LISTING_MAX_ENTRIES) {
    throw new RangeError(
      `Project skill file listing may contain at most ${SKILL_LOADABLE_REFERENCE_LISTING_MAX_ENTRIES} entries`,
    );
  }
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

  return [...references].sort(compareStrings);
}

async function listProjectSkillReferences(
  input: {
    options: RuntimeProjectSkillLoaderOptions;
    context: RuntimeProjectSkillContext;
    skillId: string;
    skillsPath?: string;
  } & RuntimeProjectSkillReadContext,
): Promise<string[]> {
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
    await input.budget.run(() =>
      input.options.getProjectFiles({
        projectId,
        authToken: input.context.authToken,
        branchId: input.context.branchId,
        pathPrefix: skillDir,
        maximumEntries: SKILL_LOADABLE_REFERENCE_LISTING_MAX_ENTRIES,
        ...getProjectSkillCancellationOptions(input.budget),
      })
    ),
  );

  return collectProjectSkillReferences({
    allFiles,
    skillDir,
  });
}

function isValidLoadedProjectSkill(input: {
  options: RuntimeProjectSkillLoaderOptions;
  source: ProjectSkillSource;
  skillId: string;
  content: string;
}): boolean {
  if (input.source.kind === "flat" || input.source.kind === "explicit-flat") {
    const valid = buildLegacyRuntimeFlatSkillDefinition({
      id: input.skillId,
      content: input.content,
      skillDocumentParserProvider: input.options.skillDocumentParserProvider,
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
  if (
    !directoryName ||
    !isValidStrictRuntimeSkillFileDocument(input.content, directoryName, {
      skillDocumentParserProvider: input.options.skillDocumentParserProvider,
      providerSafeName: isProviderSafeCatalogSkillSource(input.source),
    })
  ) {
    input.options.logger?.warn?.(
      "Project skill changed to invalid runtime metadata; refusing to load it",
      { skillId: input.skillId },
    );
    return false;
  }

  return true;
}

async function loadProjectSkill(
  input: {
    options: RuntimeProjectSkillLoaderOptions;
    context: RuntimeProjectSkillContext;
    skillId: string;
  } & RuntimeProjectSkillReadContext,
): Promise<RuntimeLoadedProjectSkill | null> {
  const projectId = input.context.projectId;
  if (!projectId || !isSafeRuntimeSkillId(input.skillId)) {
    return null;
  }

  try {
    const catalogSkillSource = resolveCatalogSkillSource(input.context, input.skillId);
    if (catalogSkillSource?.kind === "explicit-flat") {
      const catalogSkill = await getExpectedProjectFile(input.options, {
        projectId,
        authToken: input.context.authToken,
        branchId: input.context.branchId,
        path: catalogSkillSource.skillPath,
        budget: input.budget,
      });
      if (
        catalogSkill?.content &&
        isValidLoadedProjectSkill({
          options: input.options,
          source: catalogSkillSource,
          skillId: input.skillId,
          content: catalogSkill.content,
        })
      ) {
        return { instructions: catalogSkill.content, references: [] };
      }
      return null;
    }
    if (catalogSkillSource?.kind === "explicit") {
      const catalogSkill = await getExpectedProjectFile(input.options, {
        projectId,
        authToken: input.context.authToken,
        branchId: input.context.branchId,
        path: `${catalogSkillSource.skillDir}/SKILL.md`,
        budget: input.budget,
      });
      if (
        catalogSkill?.content &&
        isValidLoadedProjectSkill({
          options: input.options,
          source: catalogSkillSource,
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
        budget: input.budget,
      });

      if (directorySkill?.content) {
        if (
          !isValidLoadedProjectSkill({
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
        budget: input.budget,
      });

      if (flatSkill?.content) {
        if (
          !isValidLoadedProjectSkill({
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
    input.budget.throwIfTerminated();
    if (isAccessDeniedError(error, input.options)) {
      if (
        hasOwnProperty(input.context.skillSourcePaths ?? {}, input.skillId)
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

async function loadProjectSkillReference(
  input: {
    options: RuntimeProjectSkillLoaderOptions;
    context: RuntimeProjectSkillContext;
    skillId: string;
    normalizedFile: string;
  } & RuntimeProjectSkillReadContext,
): Promise<string | null> {
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
      budget: input.budget,
    });
    if (projectFile !== null) {
      return projectFile.content;
    }
  } catch (error) {
    input.budget.throwIfTerminated();
    if (!isAccessDeniedError(error, input.options)) {
      throw error;
    }
    if (hasOwnProperty(input.context.skillSourcePaths ?? {}, input.skillId)) {
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
