import { basename } from "#veryfront/compat/path";
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
import { createRuntimeProjectFileListingBudget } from "./project-files-client.ts";
import { isRuntimeProjectFileContent, isRuntimeProjectFilePath } from "./project-files-client.ts";
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
  createSkillOperationBudget,
  type SkillOperationBudget,
} from "#veryfront/skill/operation-budget.ts";
import {
  SKILL_ALLOWED_TOOL_MAX_PATTERNS,
  SKILL_CATALOG_MAX_DOCUMENT_CHARACTERS,
  SKILL_CATALOG_MAX_DOCUMENT_UTF8_BYTES,
  SKILL_CATALOG_MAX_METADATA_CHARACTERS,
  SKILL_CATALOG_MAX_PATH_ENTRIES,
  SKILL_CATALOG_MAX_SKILLS,
  SKILL_DOCUMENT_MAX_CHARACTERS,
  SKILL_FILE_OPERATION_TIMEOUT_MS,
  SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
  SKILL_STEERING_PATH_MAX_ENTRIES,
  SKILL_SUBDIR_MAX_ENTRIES,
} from "#veryfront/skill/limits.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { readOwnDataProperty, snapshotOwnDataPropertyArray } from "./data-property-descriptor.ts";
import type { SkillDocumentParserProvider } from "#veryfront/extensions/parser/skill-document-parser.ts";
import { SkillIdAdmission } from "#veryfront/skill/id-admission.ts";
import { SKILL_READABLE_DIRS } from "#veryfront/skill/types.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";

const ArrayIsArray = Array.isArray;
const NumberIsFinite = Number.isFinite;
const NumberIsSafeInteger = Number.isSafeInteger;
const ObjectDefineProperty = Object.defineProperty;
const ObjectFreeze = Object.freeze;
const ObjectKeys = Object.keys;
const ReflectApply = Reflect.apply;

const PROJECT_SKILL_FETCH_CONCURRENCY = 16;

class RuntimeSkillCatalogBudget {
  private documentCharacters = 0;
  private documentUtf8Bytes = 0;
  private metadataCharacters = 0;
  private pathEntries = 0;
  private skills = 0;

  retainDocument(content: string): void {
    const characters = this.documentCharacters + content.length;
    if (characters > SKILL_CATALOG_MAX_DOCUMENT_CHARACTERS) {
      throw new RangeError(
        `Skill catalog documents may contain at most ${SKILL_CATALOG_MAX_DOCUMENT_CHARACTERS} characters`,
      );
    }
    const remainingUtf8Bytes = SKILL_CATALOG_MAX_DOCUMENT_UTF8_BYTES - this.documentUtf8Bytes;
    const addedUtf8Bytes = utf8ByteLength(content, remainingUtf8Bytes);
    if (addedUtf8Bytes > remainingUtf8Bytes) {
      throw new RangeError(
        `Skill catalog documents may contain at most ${SKILL_CATALOG_MAX_DOCUMENT_UTF8_BYTES} UTF-8 bytes`,
      );
    }
    this.documentCharacters = characters;
    this.documentUtf8Bytes += addedUtf8Bytes;
  }

  retainPath(): void {
    if (this.pathEntries >= SKILL_CATALOG_MAX_PATH_ENTRIES) {
      throw new RangeError(
        `Skill catalog paths may contain at most ${SKILL_CATALOG_MAX_PATH_ENTRIES} entries`,
      );
    }
    this.pathEntries += 1;
  }

  retainDefinition(definition: RuntimeSkillDefinition): void {
    if (this.skills >= SKILL_CATALOG_MAX_SKILLS) {
      throw new RangeError(`Skill catalog may contain at most ${SKILL_CATALOG_MAX_SKILLS} skills`);
    }
    const metadataCharacters = this.metadataCharacters + getRetainedMetadataCharacters(definition);
    if (metadataCharacters > SKILL_CATALOG_MAX_METADATA_CHARACTERS) {
      throw new RangeError(
        `Skill catalog metadata may contain at most ${SKILL_CATALOG_MAX_METADATA_CHARACTERS} characters`,
      );
    }
    this.skills += 1;
    this.metadataCharacters = metadataCharacters;
  }
}

function getRetainedMetadataCharacters(definition: RuntimeSkillDefinition): number {
  let total = definition.id.length + definition.name.length + definition.description.length;
  for (
    const value of [
      definition.displayName,
      definition.model,
      definition.ownerAgentId,
      definition.shortName,
      definition.sourcePath,
    ]
  ) {
    total += value?.length ?? 0;
  }
  for (const value of definition.allowedTools ?? []) total += value.length;
  for (const value of definition.references ?? []) total += value.length;
  for (const [key, value] of Object.entries(definition.metadata ?? {})) {
    total += key.length + value.length;
  }
  return total;
}

function retainExistingDefinition(
  budget: RuntimeSkillCatalogBudget,
  definition: RuntimeSkillDefinition,
): void {
  budget.retainDocument(definition.instructions);
  for (const _reference of definition.references ?? []) budget.retainPath();
  budget.retainDefinition(definition);
}

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
  skillDocumentParserProvider?: SkillDocumentParserProvider;
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

function requireBuiltinSkills(
  value: readonly RuntimeSkillDefinition[],
  budget: RuntimeSkillCatalogBudget,
): readonly RuntimeSkillDefinition[] {
  return snapshotOwnDataPropertyArray(value, {
    label: "builtinSkills",
    maximumEntries: SKILL_CATALOG_MAX_SKILLS,
    mapValue: (definition, index) => {
      const snapshot = snapshotBuiltinSkillDefinition(definition, index);
      retainExistingDefinition(budget, snapshot);
      return snapshot;
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

function requireBuiltinString(
  definition: unknown,
  key: keyof RuntimeSkillDefinition,
  index: number,
  required: boolean,
): string | undefined {
  const value = readOwnDataProperty(
    definition,
    key,
    `builtinSkills entry ${index}`,
    required,
  );
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string") {
    throw new TypeError(`builtinSkills entry ${index}.${key} must be a string`);
  }
  return value;
}

function snapshotBuiltinStringArray(
  value: unknown,
  label: string,
  maximumEntries: number,
  validate?: (value: string) => boolean,
): readonly string[] {
  return snapshotOwnDataPropertyArray(value, {
    label,
    maximumEntries,
    mapValue: (entry, index) => {
      if (typeof entry !== "string" || (validate !== undefined && !validate(entry))) {
        throw new TypeError(`${label} entry ${index} must be a valid string`);
      }
      return entry;
    },
  });
}

function snapshotBuiltinReferences(value: unknown, label: string): readonly string[] {
  const references = snapshotBuiltinStringArray(
    value,
    label,
    SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
    (reference) =>
      normalizeStrictRuntimeSkillReferencePath(reference) === reference &&
      SKILL_READABLE_DIRS.some((directory) => reference.startsWith(`${directory}/`)),
  );
  const counts = new Map<string, number>();
  for (const reference of references) {
    const directory = reference.slice(0, reference.indexOf("/"));
    const count = (counts.get(directory) ?? 0) + 1;
    if (count > SKILL_SUBDIR_MAX_ENTRIES) {
      throw new RangeError(
        `${label} ${directory}/ may contain at most ${SKILL_SUBDIR_MAX_ENTRIES} entries`,
      );
    }
    counts.set(directory, count);
  }
  return references;
}

function snapshotBuiltinMetadata(value: unknown, index: number): Readonly<Record<string, string>> {
  if (!isNonArrayObject(value) || isProxyWithoutHooks(value)) {
    throw new TypeError(`builtinSkills entry ${index}.metadata must be an object`);
  }
  let keys: string[];
  try {
    keys = ReflectApply(ObjectKeys, undefined, [value]) as string[];
  } catch {
    throw new TypeError(`builtinSkills entry ${index}.metadata must be readable`);
  }
  if (keys.length > SKILL_SUBDIR_MAX_ENTRIES) {
    throw new RangeError(
      `builtinSkills entry ${index}.metadata may contain at most ${SKILL_SUBDIR_MAX_ENTRIES} entries`,
    );
  }

  const snapshot: Record<string, string> = {};
  for (const key of keys) {
    const metadataValue = readOwnDataProperty(
      value,
      key,
      `builtinSkills entry ${index}.metadata`,
    );
    if (typeof metadataValue !== "string") {
      throw new TypeError(`builtinSkills entry ${index}.metadata.${key} must be a string`);
    }
    ReflectApply(ObjectDefineProperty, undefined, [snapshot, key, {
      configurable: false,
      enumerable: true,
      value: metadataValue,
      writable: false,
    }]);
  }
  return ObjectFreeze(snapshot);
}

function snapshotBuiltinSkillDefinition(
  value: unknown,
  index: number,
): RuntimeSkillDefinition {
  if (!isNonArrayObject(value)) {
    throw new TypeError(`builtinSkills entry ${index} must be an object`);
  }
  const label = `builtinSkills entry ${index}`;
  const allowedTools = snapshotBuiltinStringArray(
    readOwnDataProperty(value, "allowedTools", label),
    `${label}.allowedTools`,
    SKILL_ALLOWED_TOOL_MAX_PATTERNS,
  );
  const rawReferences = readOwnDataProperty(value, "references", label, false);
  const references = rawReferences === undefined ? undefined : snapshotBuiltinReferences(
    rawReferences,
    `${label}.references`,
  );
  const rawMetadata = readOwnDataProperty(value, "metadata", label, false);
  const metadata = rawMetadata === undefined
    ? undefined
    : snapshotBuiltinMetadata(rawMetadata, index);
  const thinking = readOwnDataProperty(value, "thinking", label, false);
  if (
    thinking !== undefined &&
    thinking !== false &&
    (typeof thinking !== "number" || !NumberIsFinite(thinking) || thinking < 0)
  ) {
    throw new TypeError(`${label}.thinking must be false or a non-negative finite number`);
  }
  const maxSteps = readOwnDataProperty(value, "maxSteps", label, false);
  if (
    maxSteps !== undefined &&
    (typeof maxSteps !== "number" || !NumberIsSafeInteger(maxSteps) || maxSteps <= 0)
  ) {
    throw new TypeError(`${label}.maxSteps must be a positive safe integer`);
  }

  return ObjectFreeze({
    id: requireBuiltinString(value, "id", index, true)!,
    name: requireBuiltinString(value, "name", index, true)!,
    description: requireBuiltinString(value, "description", index, true)!,
    instructions: requireBuiltinString(value, "instructions", index, true)!,
    allowedTools: allowedTools as string[],
    ...(metadata === undefined ? {} : { metadata: metadata as Record<string, string> }),
    ...(thinking === undefined ? {} : { thinking: thinking as false | number }),
    ...(maxSteps === undefined ? {} : { maxSteps }),
    ...(references === undefined ? {} : { references: references as string[] }),
    ...snapshotOptionalBuiltinStrings(value, index),
  });
}

function snapshotOptionalBuiltinStrings(
  value: unknown,
  index: number,
): Pick<
  RuntimeSkillDefinition,
  "displayName" | "model" | "ownerAgentId" | "shortName" | "sourcePath"
> {
  const snapshot: Pick<
    RuntimeSkillDefinition,
    "displayName" | "model" | "ownerAgentId" | "shortName" | "sourcePath"
  > = {};
  for (
    const key of ["displayName", "model", "ownerAgentId", "shortName", "sourcePath"] as const
  ) {
    const property = requireBuiltinString(value, key, index, false);
    if (property !== undefined) snapshot[key] = property;
  }
  return snapshot;
}

function snapshotProjectFileList(
  value: readonly RuntimeProjectFileListItem[] | null,
): readonly RuntimeProjectFileListItem[] | null {
  if (value === null) return null;
  return snapshotOwnDataPropertyArray(value, {
    label: "Project file listing",
    maximumEntries: SKILL_CATALOG_MAX_PATH_ENTRIES,
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
      return ObjectFreeze({ path });
    },
  });
}

function normalizeSteeringPaths(
  value: readonly string[],
  label: string,
): readonly string[] {
  return snapshotOwnDataPropertyArray(value, {
    label: `${label} paths`,
    maximumEntries: SKILL_STEERING_PATH_MAX_ENTRIES,
    mapValue: (path, index) => {
      if (
        typeof path !== "string" ||
        normalizeStrictRuntimeSkillReferencePath(path) !== path
      ) {
        throw new TypeError(`Invalid ${label} path at index ${index}`);
      }
      return path;
    },
  });
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

async function fetchProjectSkillDocument(
  input:
    & RuntimeProjectSteeringLookup
    & Pick<RuntimeProjectSkillCatalogOptions, "getProjectFile" | "logger">,
  requestedPath: string,
  operationBudget: SkillOperationBudget,
  catalogBudget: RuntimeSkillCatalogBudget,
): Promise<RuntimeProjectFile | null> {
  const value = await operationBudget.run((abortSignal) =>
    input.getProjectFile({
      projectId: input.projectId,
      authToken: input.authToken,
      branchId: input.branchId,
      path: requestedPath,
      maximumContentCharacters: SKILL_DOCUMENT_MAX_CHARACTERS,
      abortSignal,
      timeoutMs: operationBudget.remainingMs(),
    })
  );
  if (value === null) return null;
  if (typeof value !== "object" || ArrayIsArray(value)) {
    throw new TypeError("Project skill response must be an object or null");
  }

  const responsePath = readOwnDataProperty(value, "path", "Project skill response");
  const content = readOwnDataProperty(value, "content", "Project skill response");
  if (!isRuntimeProjectFilePath(responsePath)) {
    input.logger?.error?.("Project skill response had an invalid path; skipping skill", {
      expectedPath: requestedPath,
    });
    return null;
  }
  if (responsePath !== requestedPath) {
    input.logger?.error?.(
      "Project skill response path did not match its request; skipping skill",
      { expectedPath: requestedPath, responsePath },
    );
    return null;
  }
  if (content === "") return null;
  if (!isRuntimeProjectFileContent(content)) {
    input.logger?.error?.("Project skill content exceeded its budget; skipping skill", {
      path: requestedPath,
    });
    return null;
  }

  assertCatalogContent(content, "Skill document");
  // Charge the shared catalog before returning the document to the concurrent
  // result set. This caps retained completed reads to the aggregate budget;
  // only the fixed-size worker set can still be in flight.
  catalogBudget.retainDocument(content);
  return Object.freeze({ path: responsePath, content });
}

/** Loads runtime builtin skill catalog. */
export function loadRuntimeBuiltinSkillCatalog(input: {
  skillsDir: string;
  logger?: RuntimeSkillMetadataLogger;
  skillDocumentParserProvider?: SkillDocumentParserProvider;
}): RuntimeSkillDefinition[] {
  const catalogBudget = new RuntimeSkillCatalogBudget();
  const entriesResult = readRuntimeBuiltinSkillEntries(input.skillsDir);
  if (!entriesResult.ok) {
    input.logger?.error?.("Failed to load built-in skills", {
      error: entriesResult.errorMessage,
    });
    return [];
  }

  const definitionsById = new Map<string, RuntimeSkillDefinition>();
  for (const entry of entriesResult.entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const id = basename(entry.name, ".md");
    const content = readRuntimeBuiltinFlatSkill(input.skillsDir, id);
    if (content === null) continue;
    catalogBudget.retainDocument(content);
    const definition = buildLegacyRuntimeFlatSkillDefinition({
      id,
      content,
      logger: input.logger,
      skillDocumentParserProvider: input.skillDocumentParserProvider,
    });
    if (definition) {
      catalogBudget.retainPath();
      catalogBudget.retainDefinition(definition);
      definitionsById.set(id, definition);
    }
  }

  for (const entry of entriesResult.entries) {
    if (!entry.isDirectory()) continue;
    const content = readRuntimeBuiltinDirectorySkill(input.skillsDir, entry.name);
    if (content === null) continue;
    catalogBudget.retainDocument(content);
    definitionsById.delete(entry.name);
    const references = listRuntimeBuiltinSkillReferences(input.skillsDir, entry.name);
    for (const _reference of references) catalogBudget.retainPath();
    const definition = buildRuntimeDirectorySkillDefinition({
      id: entry.name,
      content,
      references,
      logger: input.logger,
      skillDocumentParserProvider: input.skillDocumentParserProvider,
    });
    if (definition) {
      catalogBudget.retainPath();
      catalogBudget.retainDefinition(definition);
      definitionsById.set(entry.name, definition);
    }
  }

  return sortSkillsById(definitionsById.values());
}

/** Return runtime project instructions. */
export async function getRuntimeProjectInstructions(
  input: RuntimeProjectSteeringLookup & RuntimeProjectInstructionsOptions,
): Promise<string> {
  const budget = createCatalogBudget(input.operationBudget);
  for (const filePath of getInstructionPaths(input)) {
    const file = await budget.run((abortSignal) =>
      input.getProjectFile({
        projectId: input.projectId,
        authToken: input.authToken,
        branchId: input.branchId,
        path: filePath,
        maximumContentCharacters: SKILL_DOCUMENT_MAX_CHARACTERS,
        abortSignal,
        timeoutMs: budget.remainingMs(),
      })
    );

    if (file !== null && file.path !== filePath) {
      throw new TypeError(
        `Project instruction response path "${file.path}" did not match requested path "${filePath}"`,
      );
    }
    if (file !== null && !isRuntimeProjectFileContent(file.content)) {
      throw new RangeError("Project instruction content exceeds the shared Skill file budget");
    }
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
  const catalogBudget = new RuntimeSkillCatalogBudget();
  const builtinSkills = requireBuiltinSkills(input.builtinSkills, catalogBudget);
  const skillPrefixes = getSkillPaths(input);
  const filesByPath = new Map<string, RuntimeProjectFileListItem>();
  const listingBudget = createRuntimeProjectFileListingBudget();
  let hasAvailableListing = false;
  for (const prefix of new Set([...skillPrefixes, "agents"])) {
    const prefixWithSlash = `${prefix}/`;
    const files = snapshotProjectFileList(
      await budget.run((abortSignal) =>
        input.getProjectFiles({
          projectId: input.projectId,
          authToken: input.authToken,
          branchId: input.branchId,
          pathPrefix: prefix,
          maximumEntries: SKILL_CATALOG_MAX_PATH_ENTRIES,
          listingBudget,
          abortSignal,
          timeoutMs: budget.remainingMs(),
        })
      ),
    );
    if (!files) continue;
    hasAvailableListing = true;
    for (const file of files) {
      // Custom clients may ignore the server-side catalog filter.
      if (!file.path.startsWith(prefixWithSlash)) continue;
      if (!filesByPath.has(file.path)) catalogBudget.retainPath();
      filesByPath.set(file.path, file);
    }
  }
  if (!hasAvailableListing) {
    return [...builtinSkills];
  }
  const allFiles = Object.freeze([...filesByPath.values()]);
  if (allFiles.length === 0) {
    return [...builtinSkills];
  }

  const projectSkillsById = new Map<string, RuntimeSkillDefinition>();
  // A declared project skill shadows lower-precedence flat files and built-ins
  // even when its content is missing or invalid. Falling through on a broken
  // higher-precedence policy would re-enable capabilities unexpectedly.
  const claimedProjectSkillIds = new Set<string>();
  const agentIds = getProjectAgentIds(allFiles);
  assertUniqueCapabilityNamespaces(agentIds);

  for (const prefix of skillPrefixes) {
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
      ({ path }) => fetchProjectSkillDocument(input, path, budget, catalogBudget),
    );

    for (let index = 0; index < skillFiles.length; index += 1) {
      budget.throwIfTerminated();
      const candidate = candidates[index]!;
      const file = skillFiles[index];
      if (!file?.content) {
        continue;
      }

      const definition = candidate.isFlat
        ? buildLegacyRuntimeFlatSkillDefinition({
          id: candidate.id,
          content: file.content,
          sourcePath: candidate.path,
          logger: input.logger,
          skillDocumentParserProvider: input.skillDocumentParserProvider,
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
          skillDocumentParserProvider: input.skillDocumentParserProvider,
        });

      if (definition) {
        catalogBudget.retainDefinition(definition);
        projectSkillsById.set(definition.id, definition);
      }
    }
  }

  const skillIdAdmission = new SkillIdAdmission();
  for (const id of claimedProjectSkillIds) {
    skillIdAdmission.claim({ id, source: "project-global skill" });
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
      const admission = skillIdAdmission.claim({
        id: candidate.identity.id,
        source: `agent-owned skill for agent "${candidate.identity.ownerAgentId}"`,
        ownerAgentId: candidate.identity.ownerAgentId,
      });
      if (!admission.accepted) {
        projectSkillsById.delete(candidate.identity.id);
        input.logger?.error?.(admission.error.message, {
          skillId: candidate.identity.id,
          existingOwnerAgentId: admission.error.existing.ownerAgentId,
          incomingOwnerAgentId: admission.error.incoming.ownerAgentId,
        });
        return false;
      }
      return claimProjectSkillId(claimedProjectSkillIds, candidate.identity.id);
    })
    .filter((candidate) => !skillIdAdmission.isRejected(candidate.identity.id));

  if (colocatedCandidates.length > 0) {
    const colocatedFiles = await mapWithConcurrency(
      colocatedCandidates,
      PROJECT_SKILL_FETCH_CONCURRENCY,
      ({ path }) => fetchProjectSkillDocument(input, path, budget, catalogBudget),
    );

    for (let index = 0; index < colocatedFiles.length; index += 1) {
      budget.throwIfTerminated();
      const candidate = colocatedCandidates[index]!;
      const file = colocatedFiles[index];
      if (!file?.content) {
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
        skillDocumentParserProvider: input.skillDocumentParserProvider,
      });

      if (definition) {
        catalogBudget.retainDefinition(definition);
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

  budget.throwIfTerminated();
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
