import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import { INPUT_VALIDATION_FAILED } from "#veryfront/errors";
import type { InferSchema, JsonSchema } from "#veryfront/extensions/schema/index.ts";
import type { Tool, ToolExecutionContext } from "#veryfront/tool/types.ts";
import {
  LOAD_SKILL_OVERRIDE_FORWARDING,
  LOAD_SKILL_POLICY_CLAUSES,
} from "#veryfront/skill/load-skill-policy.ts";
import {
  listRuntimeBuiltinSkillReferencesWithinLimit,
  readRuntimeBuiltinSkillReferenceWithinLimit,
  readRuntimeBuiltinSkillWithinLimit,
} from "./builtin-skill-files.ts";
import {
  createSkillOperationBudget,
  type SkillOperationBudget,
} from "#veryfront/skill/operation-budget.ts";
import {
  SKILL_DOCUMENT_MAX_CHARACTERS,
  SKILL_FILE_OPERATION_TIMEOUT_MS,
  SKILL_ID_MAX_LENGTH,
  SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
  SKILL_RELATIVE_PATH_MAX_LENGTH,
  SKILL_RUNTIME_AVAILABLE_TOOL_MAX_ENTRIES,
  SKILL_RUNTIME_LOADED_REFERENCE_CACHE_MAX_ENTRIES,
  SKILL_RUNTIME_LOADED_SKILL_CACHE_MAX_ENTRIES,
} from "#veryfront/skill/limits.ts";
import type {
  RuntimeLoadedProjectSkill,
  RuntimeProjectSkillContext,
  RuntimeProjectSkillLoader,
} from "./project-skill-loader.ts";
import {
  buildStrictRuntimeLoadedSkillResponse,
  normalizeStrictRuntimeSkillReferencePath,
  type RuntimeLoadedSkillResponse,
  type RuntimeSkillMetadataLogger,
} from "./skill-metadata.ts";
import type { ResolvedSkillSelectorPolicy } from "#veryfront/skill/selector.ts";
import type { SkillDocumentParserProvider } from "#veryfront/extensions/parser/skill-document-parser.ts";
import { hasControlCharacters, isWellFormedUtf16 } from "#veryfront/skill/string-safety.ts";
import {
  isOwnDataPropertyDescriptor,
  snapshotOwnDataPropertyArray,
} from "./data-property-descriptor.ts";

const ArrayIsArray = Array.isArray;
const ObjectDefineProperty = Object.defineProperty;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ReflectApply = Reflect.apply;

// A 60-ID page stays below the prompt inventory budget for maximum-length IDs
// and discovers the 1,000-entry selector limit in at most 17 tool calls.
const RUNTIME_SKILL_INVENTORY_PAGE_MAX_IDS = 60;

function isRuntimeLoadSkillArray(value: unknown): boolean {
  try {
    return ArrayIsArray(value);
  } catch {
    return false;
  }
}

/** Shared runtime load skill description value. */
export const RUNTIME_LOAD_SKILL_DESCRIPTION =
  `Load the full instructions for a skill. Use this when you need detailed guidance for a specific task type. load_skill does not perform the task by itself. ${LOAD_SKILL_POLICY_CLAUSES} ${LOAD_SKILL_OVERRIDE_FORWARDING} To discover authorized skill IDs, use the inventory object. Use a cursor listed in context when present, then follow each nextCursor value. To load a skill, use the load object with only skillId. Add the optional \`file\` field only after the skill is loaded and only for a reference file listed by that loaded skill.`;

function rememberBoundedRecordValue<T>(
  record: Record<string, T>,
  key: string,
  value: T,
  maxEntries: number,
): void {
  const keys = Object.keys(record);
  const keyIsEnumerable = keys.includes(key);
  let removalsNeeded = Math.max(
    0,
    keys.length + (keyIsEnumerable ? 0 : 1) - maxEntries,
  );
  for (const oldestKey of keys) {
    if (removalsNeeded === 0) break;
    if (oldestKey === key) continue;
    if (!Reflect.deleteProperty(record, oldestKey)) {
      throw new TypeError("Runtime skill load cache could not evict its oldest entry");
    }
    removalsNeeded -= 1;
  }
  if (removalsNeeded !== 0) {
    throw new RangeError("Runtime skill load cache cannot satisfy its aggregate entry limit");
  }
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

type RuntimeSkillReferenceAuthorization = Readonly<{
  references: readonly string[];
  requiresActiveSkillContext: boolean;
  has(reference: string): boolean;
}>;

type RuntimeSkillPrivateArrayScope = Readonly<{
  identity: unknown;
  reusable: boolean;
  values: readonly unknown[] | null;
}>;

type RuntimeSkillPrivateScalarScope = Readonly<{
  reusable: boolean;
  value: unknown;
}>;

type RuntimeSkillPrivateLoaderScope = Readonly<{
  identity: unknown;
  listProjectSkillReferences: RuntimeSkillPrivateScalarScope;
  loadProjectSkill: RuntimeSkillPrivateScalarScope;
  loadProjectSkillReference: RuntimeSkillPrivateScalarScope;
  reusable: boolean;
}>;

type RuntimeSkillPrivateRecordScope = Readonly<{
  entries: readonly (readonly [string, unknown])[] | null;
  identity: unknown;
  reusable: boolean;
}>;

type RuntimeSkillPrivateAuthorityScope = Readonly<{
  authToken: RuntimeSkillPrivateScalarScope;
  agentId: RuntimeSkillPrivateScalarScope;
  projectId: RuntimeSkillPrivateScalarScope;
  branchId: RuntimeSkillPrivateScalarScope;
  skillsDir: RuntimeSkillPrivateScalarScope;
  projectSkillLoader: RuntimeSkillPrivateLoaderScope;
  skillSourcePaths: RuntimeSkillPrivateRecordScope;
  availableSkillIds: RuntimeSkillPrivateArrayScope;
  builtinSkillIds: RuntimeSkillPrivateArrayScope;
  availableToolNames: RuntimeSkillPrivateArrayScope;
  loadedSkillResponses: unknown;
  loadedSkillReferenceResponses: unknown;
}>;

type RuntimeSkillPrivateAuthorityGuard = Readonly<{
  scopeEpoch: number;
  scope: RuntimeSkillPrivateAuthorityScope;
}>;

type RuntimeSkillPrivatePublicationGuard = Readonly<{
  key: string;
  kind: "body" | "reference";
  version: number;
}>;

type RuntimeSkillPrivateAuthorityCommit<T> = Readonly<{
  guard: RuntimeSkillPrivateAuthorityGuard;
  value: T;
}>;

type RuntimeSkillPrivateAuthorityController = Readonly<{
  begin(): RuntimeSkillPrivateAuthorityGuard;
  captureBody(key: string): RuntimeSkillPrivatePublicationGuard;
  captureReference(key: string): RuntimeSkillPrivatePublicationGuard;
  isCurrent(guard: RuntimeSkillPrivateAuthorityGuard): boolean;
  commit<T>(
    guard: RuntimeSkillPrivateAuthorityGuard,
    target: RuntimeSkillPrivatePublicationGuard,
    dependencies: readonly RuntimeSkillPrivatePublicationGuard[],
    publish: () => T,
  ): RuntimeSkillPrivateAuthorityCommit<T> | null;
}>;

const RUNTIME_SKILL_PRIVATE_AUTHORITY_MAX_ATTEMPTS = 3;
const RUNTIME_SKILL_ID_PATTERN = /^[a-zA-Z0-9_-]+(?:\.md)?$/;

function createReferenceAuthorization(
  references: readonly string[] | undefined,
  requiresActiveSkillContext = false,
): RuntimeSkillReferenceAuthorization {
  const snapshot = Object.freeze([...(references ?? [])]);
  const referenceSet = new Set(snapshot);
  return Object.freeze({
    references: snapshot,
    requiresActiveSkillContext,
    has: (reference: string) => referenceSet.has(reference),
  });
}

function rememberBoundedPrivateValue<T>(
  store: Map<string, T>,
  key: string,
  value: T,
  maxEntries = SKILL_RUNTIME_LOADED_SKILL_CACHE_MAX_ENTRIES,
): void {
  store.delete(key);
  store.set(key, value);
  while (store.size > maxEntries) {
    const oldestKey = store.keys().next().value;
    if (typeof oldestKey !== "string") {
      throw new RangeError("Runtime skill private cache cannot satisfy its entry limit");
    }
    store.delete(oldestKey);
  }
}

function compactLoadedSkillResponse(
  response: RuntimeLoadedSkillResponse,
): RuntimeLoadedSkillResponse {
  const copy = copyLoadedSkillResponse(response);
  return {
    ...copy,
    instructions: "",
  };
}

function buildPublicLoadedSkillMarker(
  response: RuntimeLoadedSkillResponse,
): RuntimeLoadedSkillResponse {
  return {
    skillId: response.skillId,
    instructions: "",
    ...(response.references === undefined ? {} : { references: [...response.references] }),
  };
}

function copyLoadedSkillResponse(
  response: RuntimeLoadedSkillResponse,
): RuntimeLoadedSkillResponse {
  return {
    ...response,
    ...(response.references === undefined ? {} : { references: [...response.references] }),
  };
}

function rememberTrustedLoadedSkillResponse(
  authorizationStore: Map<string, RuntimeSkillReferenceAuthorization>,
  trustedResponseStore: Map<string, RuntimeLoadedSkillResponse>,
  loadedSkillResponses: Record<string, RuntimeLoadedSkillResponse>,
  key: string,
  response: RuntimeLoadedSkillResponse,
  rememberPublicMarker = true,
): RuntimeLoadedSkillResponse {
  const trustedResponse = compactLoadedSkillResponse(response);
  rememberBoundedPrivateValue(
    authorizationStore,
    key,
    createReferenceAuthorization(trustedResponse.references),
  );
  rememberBoundedPrivateValue(trustedResponseStore, key, trustedResponse);
  if (rememberPublicMarker) {
    rememberBoundedRecordValue(
      loadedSkillResponses,
      key,
      buildPublicLoadedSkillMarker(response),
      SKILL_RUNTIME_LOADED_SKILL_CACHE_MAX_ENTRIES,
    );
  }
  return trustedResponse;
}

/** Context for runtime load skill tool. */
export type RuntimeLoadSkillToolContext = RuntimeProjectSkillContext & {
  /** Agent identity used to enforce owner-scoped skill visibility. */
  agentId?: string;
  /**
   * Authoritative completed catalog snapshot when defined. An empty array
   * means the catalog was available but exposed no loadable skills. Omit this
   * field only when the catalog was unavailable or was not evaluated, which
   * permits direct builtin fallback.
   */
  availableSkillIds?: readonly string[];
  skillSelectorPolicy?: ResolvedSkillSelectorPolicy;
  availableToolNames?: readonly string[];
  loadedSkillResponses?: Record<string, RuntimeLoadedSkillResponse>;
  loadedSkillReferenceResponses?: Record<
    string,
    true | RuntimeLoadSkillReferenceFileOutput
  >;
};

/** Public API contract for runtime load skill builtin store. */
export type RuntimeLoadSkillBuiltinStore = {
  readSkill: (
    skillsDir: string,
    skillId: string,
    budget: SkillOperationBudget,
  ) => Promise<string | null>;
  readReferenceFile: (
    skillsDir: string,
    skillId: string,
    normalizedFile: string,
    budget: SkillOperationBudget,
  ) => Promise<string | null>;
  listReferences: (
    skillsDir: string,
    skillId: string,
    budget: SkillOperationBudget,
  ) => Promise<string[]>;
};

/** Public API contract for runtime load skill tool messages. */

/** Options accepted by runtime load skill tool. */
export type RuntimeLoadSkillToolOptions = {
  context: RuntimeLoadSkillToolContext;
  skillsDir: string;
  projectSkillLoader: RuntimeProjectSkillLoader;
  builtinSkillIds?: readonly string[];
  builtinStore?: RuntimeLoadSkillBuiltinStore;
  /** Override the static default description for direct consumers that supply their own discovery context. */
  description?: string;
  logger?: RuntimeSkillMetadataLogger;
  skillDocumentParserProvider?: SkillDocumentParserProvider;
};

const getRuntimeLoadSkillReferenceFileInputSchema = defineSchema((v) =>
  v.string()
    .min(1)
    .max(SKILL_RELATIVE_PATH_MAX_LENGTH)
    .refine(isWellFormedUtf16, "Reference file path must contain well-formed UTF-16")
    .refine(
      (path) => !hasControlCharacters(path),
      "Reference file path must not contain control characters",
    )
);

export const getRuntimeLoadSkillToolInputSchema = defineSchema((v) =>
  v.union([
    v.object({
      cursor: v.number().int().min(0).max(SKILL_RUNTIME_LOADED_SKILL_CACHE_MAX_ENTRIES)
        .optional()
        .describe(
          "Pagination cursor from the prompt or a previous skill inventory response.",
        ),
    }).strict(),
    v.object({
      skillId: v.string().max(SKILL_ID_MAX_LENGTH + ".md".length)
        .regex(
          /^[a-zA-Z0-9_-]+(?:\.md)?$/,
          'skillId must contain only letters, numbers, "_" or "-", with an optional lowercase ".md" suffix',
        )
        .describe(
          'The listed skill ID to load. A lowercase ".md" suffix is accepted when it is the canonical ID or an unambiguous alias (e.g., "react-components" or "react-components.md").',
        ),
      file: getRuntimeLoadSkillReferenceFileInputSchema().optional().describe(
        "Optional reference file to load. First load the skill with only skillId, then use file only for a reference path listed by that loaded skill.",
      ),
    }).strict(),
    v.object({
      inventory: v.object({
        cursor: v.number().int().min(0).max(SKILL_RUNTIME_LOADED_SKILL_CACHE_MAX_ENTRIES)
          .optional()
          .describe(
            "Pagination cursor from the prompt or a previous skill inventory response.",
          ),
      }).strict(),
    }).strict(),
    v.object({
      load: v.object({
        skillId: v.string().max(SKILL_ID_MAX_LENGTH + ".md".length)
          .regex(
            /^[a-zA-Z0-9_-]+(?:\.md)?$/,
            'skillId must contain only letters, numbers, "_" or "-", with an optional lowercase ".md" suffix',
          )
          .describe(
            'The listed skill ID to load. A lowercase ".md" suffix is accepted when it is the canonical ID or an unambiguous alias (e.g., "react-components" or "react-components.md").',
          ),
        file: getRuntimeLoadSkillReferenceFileInputSchema().optional().describe(
          "Optional reference file to load. First load the skill with only skillId, then use file only for a reference path listed by that loaded skill.",
        ),
      }).strict(),
    }).strict(),
  ])
);

/** @deprecated Use getRuntimeLoadSkillToolInputSchema() */
const runtimeLoadSkillToolInputSchema = lazySchema(getRuntimeLoadSkillToolInputSchema);

function createStaticRuntimeLoadSkillToolInputJsonSchema(): JsonSchema {
  return {
    type: "object",
    properties: {
      inventory: {
        type: "object",
        properties: {
          cursor: {
            type: "integer",
            minimum: 0,
            maximum: SKILL_RUNTIME_LOADED_SKILL_CACHE_MAX_ENTRIES,
            description:
              "Pagination cursor from the prompt or a previous skill inventory response.",
          },
        },
        additionalProperties: false,
      },
      load: {
        type: "object",
        properties: {
          skillId: {
            type: "string",
            maxLength: SKILL_ID_MAX_LENGTH + ".md".length,
            pattern: "^[a-zA-Z0-9_-]+(?:\\.md)?$",
            description:
              'The listed skill ID to load. A lowercase ".md" suffix is accepted for a listed ID.',
          },
          file: {
            type: "string",
            minLength: 1,
            maxLength: SKILL_RELATIVE_PATH_MAX_LENGTH,
            description:
              "Optional reference file to load. First load the skill with only skillId, then use file only for a reference path listed by that loaded skill.",
          },
        },
        required: ["skillId"],
        additionalProperties: false,
      },
    },
    minProperties: 1,
    maxProperties: 1,
    additionalProperties: false,
  };
}

/**
 * Input payload for runtime load skill tool.
 *
 * Provider calls use `{ inventory: { cursor? } }` to list authorized IDs and
 * `{ load: { skillId, file? } }` to load content. The legacy flat forms remain
 * accepted for direct consumers. Start inventory paging with a prompt-provided
 * `cursor` when present, or omit `cursor` for the first page.
 */
export type RuntimeLoadSkillToolInput = InferSchema<
  ReturnType<typeof getRuntimeLoadSkillToolInputSchema>
>;

type NormalizedRuntimeLoadSkillToolInput =
  | { cursor?: number }
  | { skillId: string; file?: string };

function normalizeRuntimeLoadSkillToolInput(
  input: RuntimeLoadSkillToolInput,
): NormalizedRuntimeLoadSkillToolInput {
  if ("inventory" in input) return input.inventory;
  if ("load" in input) return input.load;
  return input;
}

/** Output from runtime load skill reference file. */
export type RuntimeLoadSkillReferenceFileOutput = {
  skillId: string;
  file: string;
  content: string;
};

/** Output from runtime load skill error. */
export type RuntimeLoadSkillErrorOutput = {
  error: string;
};

/** One bounded page of authorized skill IDs returned by runtime load skill. */
export type RuntimeLoadSkillInventoryOutput = {
  skillIds: string[];
  nextCursor?: number;
};

/** Output from runtime load skill tool. */
export type RuntimeLoadSkillToolOutput =
  | RuntimeLoadedSkillResponse
  | RuntimeLoadSkillReferenceFileOutput
  | RuntimeLoadSkillInventoryOutput
  | RuntimeLoadSkillErrorOutput;

function getBuiltinStore(options: RuntimeLoadSkillToolOptions): RuntimeLoadSkillBuiltinStore {
  return {
    readSkill: options.builtinStore?.readSkill ?? readRuntimeBuiltinSkillWithinLimit,
    readReferenceFile: options.builtinStore?.readReferenceFile ??
      readRuntimeBuiltinSkillReferenceWithinLimit,
    listReferences: options.builtinStore?.listReferences ??
      listRuntimeBuiltinSkillReferencesWithinLimit,
  };
}

function assertRuntimeBoundaryCollections(options: RuntimeLoadSkillToolOptions): void {
  snapshotRuntimeLoadSkillAvailableToolNames(
    readRuntimeLoadSkillDataProperty(
      options.context,
      "availableToolNames",
      "Runtime load skill context",
    ),
  );
  const availableSkillIds = readRuntimeLoadSkillDataProperty(
    options.context,
    "availableSkillIds",
    "Runtime load skill context",
  );
  if (availableSkillIds !== undefined) {
    snapshotRuntimeSkillIdInventory(availableSkillIds, "availableSkillIds");
  }
}

function assertLoadedSkillInstructions(instructions: string): void {
  if (instructions.length > SKILL_DOCUMENT_MAX_CHARACTERS) {
    throw new RangeError(
      `Skill document may contain at most ${SKILL_DOCUMENT_MAX_CHARACTERS} characters`,
    );
  }
}

function readRuntimeLoadSkillDataProperty(
  value: unknown,
  key: PropertyKey,
  label: string,
): unknown {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    throw new TypeError(`${label} must be an object`);
  }
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
      value,
      key,
    ]) as PropertyDescriptor | undefined;
  } catch {
    throw new TypeError(`${label}.${String(key)} must be a data property`);
  }
  if (descriptor === undefined) return undefined;
  if (!isOwnDataPropertyDescriptor(descriptor)) {
    throw new TypeError(`${label}.${String(key)} must be a data property`);
  }
  return descriptor.value;
}

function snapshotRuntimeLoadSkillAvailableToolNames(
  value: unknown,
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  return snapshotOwnDataPropertyArray(value, {
    label: "Runtime load skill availableToolNames",
    maximumEntries: SKILL_RUNTIME_AVAILABLE_TOOL_MAX_ENTRIES,
    mapValue: (toolName, index) => {
      if (typeof toolName !== "string") {
        throw new TypeError(
          `Runtime load skill available tool name ${index} must be a string data property`,
        );
      }
      return toolName;
    },
  });
}

function buildLoadedSkillResponse(input: {
  options: RuntimeLoadSkillToolOptions;
  skillId: string;
  instructions: string;
  references?: readonly string[];
}): RuntimeLoadedSkillResponse {
  assertLoadedSkillInstructions(input.instructions);
  const logger = readRuntimeLoadSkillDataProperty(
    input.options,
    "logger",
    "Runtime load skill options",
  ) as RuntimeSkillMetadataLogger | undefined;
  const skillDocumentParserProvider = readRuntimeLoadSkillDataProperty(
    input.options,
    "skillDocumentParserProvider",
    "Runtime load skill options",
  ) as SkillDocumentParserProvider | undefined;
  const response = buildStrictRuntimeLoadedSkillResponse({
    skillId: input.skillId,
    instructions: input.instructions,
    references: input.references,
    logger,
    skillDocumentParserProvider,
  });
  return response;
}

function buildAlreadyLoadedSkillResponse(
  skillId: string,
  response: RuntimeLoadedSkillResponse,
): RuntimeLoadedSkillResponse {
  return {
    ...copyLoadedSkillResponse(response),
    instructions:
      `Skill "${skillId}" is already loaded in this turn. Do not call load_skill for "${skillId}" again. ` +
      "Continue from the existing user request and any submitted tool results, then produce the next useful response now. " +
      "If a form_input result already exists, treat it as final for this turn and do not call form_input again.",
  };
}

function buildMissingSkillError(
  options: RuntimeLoadSkillToolOptions,
  skillId: string,
): RuntimeLoadSkillErrorOutput {
  const available = getKnownRuntimeSkillIds(options)?.join(", ") || "none";
  return {
    error: `Skill not found: ${skillId}. Available skills: ${available}`,
  };
}

function buildAlreadyLoadedSkillReferenceResponse(
  skillId: string,
  file: string,
): RuntimeLoadSkillReferenceFileOutput {
  return {
    skillId,
    file,
    content:
      `Reference file "${skillId}/${file}" is already loaded in this turn. Do not call load_skill for this file again. ` +
      "Continue from the existing reference content and produce the next useful response now.",
  };
}

function buildRuntimeSkillCacheKey(
  context: RuntimeLoadSkillToolContext,
  skillId: string,
): string {
  const skillSourcePaths = readOwnDataProperty(context, "skillSourcePaths");
  return JSON.stringify([
    skillId,
    readOwnDataProperty(context, "agentId") ?? null,
    readOwnDataProperty(context, "projectId") ?? null,
    readOwnDataProperty(context, "branchId") ?? null,
    readOwnDataProperty(skillSourcePaths, skillId) ?? null,
  ]);
}

function buildRuntimeSkillReferenceCacheKey(
  context: RuntimeLoadSkillToolContext,
  skillId: string,
  normalizedFile: string,
): string {
  return JSON.stringify([
    buildRuntimeSkillCacheKey(context, skillId),
    normalizedFile,
  ]);
}

function readOwnDataProperty(value: unknown, key: PropertyKey): unknown {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  try {
    const descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
      value,
      key,
    ]) as PropertyDescriptor | undefined;
    return isOwnDataPropertyDescriptor(descriptor) ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function hasOwnDataProperty(value: unknown, key: PropertyKey): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  try {
    const descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
      value,
      key,
    ]) as PropertyDescriptor | undefined;
    return isOwnDataPropertyDescriptor(descriptor);
  } catch {
    return false;
  }
}

function snapshotRuntimeSkillPrivateArrayScope(
  value: unknown,
): RuntimeSkillPrivateArrayScope {
  try {
    const values = snapshotOwnDataPropertyArray(value, {
      label: "Runtime skill private authority array",
      maximumEntries: SKILL_RUNTIME_LOADED_SKILL_CACHE_MAX_ENTRIES,
      mapValue: (entry) => entry,
    });
    return Object.freeze({
      identity: value,
      reusable: true,
      values,
    });
  } catch {
    return Object.freeze({
      identity: value,
      reusable: value === undefined || value === null,
      values: null,
    });
  }
}

function snapshotRuntimeSkillPrivateScalarScope(
  value: unknown,
  key: PropertyKey,
): RuntimeSkillPrivateScalarScope {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return Object.freeze({ reusable: false, value: undefined });
  }
  let current: object | null = value;
  for (let depth = 0; depth < 16; depth += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
        current,
        key,
      ]) as PropertyDescriptor | undefined;
    } catch {
      return Object.freeze({ reusable: false, value: undefined });
    }
    if (descriptor !== undefined) {
      return isOwnDataPropertyDescriptor(descriptor)
        ? Object.freeze({ reusable: true, value: descriptor.value })
        : Object.freeze({ reusable: false, value: undefined });
    }
    try {
      current = ReflectApply(ObjectGetPrototypeOf, undefined, [current]) as object | null;
    } catch {
      return Object.freeze({ reusable: false, value: undefined });
    }
    if (current === null) {
      return Object.freeze({ reusable: true, value: undefined });
    }
  }
  return Object.freeze({ reusable: false, value: undefined });
}

function hasSameRuntimeSkillPrivateScalarScope(
  left: RuntimeSkillPrivateScalarScope,
  right: RuntimeSkillPrivateScalarScope,
): boolean {
  return left.reusable && right.reusable && Object.is(left.value, right.value);
}

function snapshotRuntimeSkillPrivateArrayPropertyScope(
  value: unknown,
  key: PropertyKey,
): RuntimeSkillPrivateArrayScope {
  const property = snapshotRuntimeSkillPrivateScalarScope(value, key);
  return property.reusable
    ? snapshotRuntimeSkillPrivateArrayScope(property.value)
    : Object.freeze({ identity: property.value, reusable: false, values: null });
}

function hasSameRuntimeSkillPrivateArrayScope(
  left: RuntimeSkillPrivateArrayScope,
  right: RuntimeSkillPrivateArrayScope,
): boolean {
  if (left.identity !== right.identity) return false;
  if (!left.reusable || !right.reusable) return false;
  if (left.values === null || right.values === null) {
    return left.values === right.values;
  }
  return left.values.length === right.values.length &&
    left.values.every((value, index) => value === right.values?.[index]);
}

function snapshotRuntimeSkillPrivateRecordScope(
  value: unknown,
): RuntimeSkillPrivateRecordScope {
  if (value === undefined || value === null) {
    return Object.freeze({ entries: null, identity: value, reusable: true });
  }
  if (typeof value !== "object" || isRuntimeLoadSkillArray(value)) {
    return Object.freeze({ entries: null, identity: value, reusable: false });
  }

  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = ReflectApply(ObjectGetOwnPropertyDescriptors, undefined, [
      value,
    ]) as PropertyDescriptorMap;
  } catch {
    return Object.freeze({ entries: null, identity: value, reusable: false });
  }
  const keys = Object.keys(descriptors).sort();
  if (keys.length > SKILL_RUNTIME_LOADED_SKILL_CACHE_MAX_ENTRIES) {
    return Object.freeze({ entries: null, identity: value, reusable: false });
  }

  const entries: Array<readonly [string, unknown]> = [];
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!isOwnDataPropertyDescriptor(descriptor)) {
      return Object.freeze({ entries: null, identity: value, reusable: false });
    }
    entries.push(Object.freeze([key, descriptor.value] as const));
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    identity: value,
    reusable: true,
  });
}

function snapshotRuntimeSkillPrivateRecordPropertyScope(
  value: unknown,
  key: PropertyKey,
): RuntimeSkillPrivateRecordScope {
  const property = snapshotRuntimeSkillPrivateScalarScope(value, key);
  return property.reusable
    ? snapshotRuntimeSkillPrivateRecordScope(property.value)
    : Object.freeze({ entries: null, identity: property.value, reusable: false });
}

function hasSameRuntimeSkillPrivateRecordScope(
  left: RuntimeSkillPrivateRecordScope,
  right: RuntimeSkillPrivateRecordScope,
): boolean {
  if (left.identity !== right.identity || !left.reusable || !right.reusable) return false;
  if (left.entries === null || right.entries === null) {
    return left.entries === right.entries;
  }
  return left.entries.length === right.entries.length &&
    left.entries.every((entry, index) => {
      const other = right.entries?.[index];
      return other !== undefined && entry[0] === other[0] && entry[1] === other[1];
    });
}

function snapshotRuntimeSkillPrivateLoaderMethod(
  loader: unknown,
  key: keyof RuntimeProjectSkillLoader,
): RuntimeSkillPrivateScalarScope {
  let current = loader;
  for (let depth = 0; depth < 16; depth += 1) {
    if (!current || (typeof current !== "object" && typeof current !== "function")) break;
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
        current,
        key,
      ]) as PropertyDescriptor | undefined;
    } catch {
      return Object.freeze({ reusable: false, value: undefined });
    }
    if (descriptor !== undefined) {
      return isOwnDataPropertyDescriptor(descriptor)
        ? Object.freeze({ reusable: true, value: descriptor.value })
        : Object.freeze({ reusable: false, value: undefined });
    }
    try {
      current = ReflectApply(ObjectGetPrototypeOf, undefined, [current]) as object | null;
    } catch {
      return Object.freeze({ reusable: false, value: undefined });
    }
  }
  return Object.freeze({ reusable: false, value: undefined });
}

function snapshotRuntimeSkillPrivateLoaderScope(
  options: RuntimeLoadSkillToolOptions,
): RuntimeSkillPrivateLoaderScope {
  const property = snapshotRuntimeSkillPrivateScalarScope(options, "projectSkillLoader");
  const loader = property.value;
  if (
    !property.reusable ||
    !loader ||
    (typeof loader !== "object" && typeof loader !== "function")
  ) {
    const invalid = Object.freeze({ reusable: false, value: undefined });
    return Object.freeze({
      identity: loader,
      listProjectSkillReferences: invalid,
      loadProjectSkill: invalid,
      loadProjectSkillReference: invalid,
      reusable: false,
    });
  }
  const listProjectSkillReferences = snapshotRuntimeSkillPrivateLoaderMethod(
    loader,
    "listProjectSkillReferences",
  );
  const loadProjectSkill = snapshotRuntimeSkillPrivateLoaderMethod(loader, "loadProjectSkill");
  const loadProjectSkillReference = snapshotRuntimeSkillPrivateLoaderMethod(
    loader,
    "loadProjectSkillReference",
  );
  return Object.freeze({
    identity: loader,
    listProjectSkillReferences,
    loadProjectSkill,
    loadProjectSkillReference,
    reusable: listProjectSkillReferences.reusable &&
      loadProjectSkill.reusable &&
      loadProjectSkillReference.reusable,
  });
}

function hasSameRuntimeSkillPrivateLoaderScope(
  left: RuntimeSkillPrivateLoaderScope,
  right: RuntimeSkillPrivateLoaderScope,
): boolean {
  return left.reusable && right.reusable && left.identity === right.identity &&
    hasSameRuntimeSkillPrivateScalarScope(
      left.listProjectSkillReferences,
      right.listProjectSkillReferences,
    ) &&
    hasSameRuntimeSkillPrivateScalarScope(left.loadProjectSkill, right.loadProjectSkill) &&
    hasSameRuntimeSkillPrivateScalarScope(
      left.loadProjectSkillReference,
      right.loadProjectSkillReference,
    );
}

function getOrCreateRuntimeCacheRecord<T>(
  context: RuntimeLoadSkillToolContext,
  key: "loadedSkillResponses" | "loadedSkillReferenceResponses",
): Record<string, T> {
  const existing = readOwnDataProperty(context, key);
  if (existing && typeof existing === "object" && !isRuntimeLoadSkillArray(existing)) {
    return existing as Record<string, T>;
  }

  const record: Record<string, T> = {};
  try {
    Object.defineProperty(context, key, {
      configurable: true,
      enumerable: true,
      value: record,
      writable: true,
    });
  } catch {
    throw new TypeError(`Runtime skill ${key} cache must be a writable data property`);
  }
  return record;
}

function snapshotRuntimeSkillPrivateAuthorityScope(
  options: RuntimeLoadSkillToolOptions,
  loadedSkillResponses: unknown = readOwnDataProperty(
    options.context,
    "loadedSkillResponses",
  ),
  loadedSkillReferenceResponses: unknown = readOwnDataProperty(
    options.context,
    "loadedSkillReferenceResponses",
  ),
): RuntimeSkillPrivateAuthorityScope {
  const context = options.context;
  return Object.freeze({
    authToken: snapshotRuntimeSkillPrivateScalarScope(context, "authToken"),
    agentId: snapshotRuntimeSkillPrivateScalarScope(context, "agentId"),
    projectId: snapshotRuntimeSkillPrivateScalarScope(context, "projectId"),
    branchId: snapshotRuntimeSkillPrivateScalarScope(context, "branchId"),
    skillsDir: snapshotRuntimeSkillPrivateScalarScope(options, "skillsDir"),
    projectSkillLoader: snapshotRuntimeSkillPrivateLoaderScope(options),
    skillSourcePaths: snapshotRuntimeSkillPrivateRecordPropertyScope(
      context,
      "skillSourcePaths",
    ),
    availableSkillIds: snapshotRuntimeSkillPrivateArrayPropertyScope(
      context,
      "availableSkillIds",
    ),
    builtinSkillIds: snapshotRuntimeSkillPrivateArrayPropertyScope(
      options,
      "builtinSkillIds",
    ),
    availableToolNames: snapshotRuntimeSkillPrivateArrayPropertyScope(
      context,
      "availableToolNames",
    ),
    loadedSkillResponses,
    loadedSkillReferenceResponses,
  });
}

function hasSameRuntimeSkillPrivateAuthorityScope(
  left: RuntimeSkillPrivateAuthorityScope,
  right: RuntimeSkillPrivateAuthorityScope,
): boolean {
  return hasSameRuntimeSkillPrivateScalarScope(left.authToken, right.authToken) &&
    hasSameRuntimeSkillPrivateScalarScope(left.agentId, right.agentId) &&
    hasSameRuntimeSkillPrivateScalarScope(left.projectId, right.projectId) &&
    hasSameRuntimeSkillPrivateScalarScope(left.branchId, right.branchId) &&
    hasSameRuntimeSkillPrivateScalarScope(left.skillsDir, right.skillsDir) &&
    hasSameRuntimeSkillPrivateLoaderScope(left.projectSkillLoader, right.projectSkillLoader) &&
    hasSameRuntimeSkillPrivateRecordScope(left.skillSourcePaths, right.skillSourcePaths) &&
    hasSameRuntimeSkillPrivateArrayScope(left.availableSkillIds, right.availableSkillIds) &&
    hasSameRuntimeSkillPrivateArrayScope(left.builtinSkillIds, right.builtinSkillIds) &&
    hasSameRuntimeSkillPrivateArrayScope(left.availableToolNames, right.availableToolNames) &&
    left.loadedSkillResponses === right.loadedSkillResponses &&
    left.loadedSkillReferenceResponses === right.loadedSkillReferenceResponses;
}

function hasSameRuntimeSkillPrivateAttemptArrayScope(
  left: RuntimeSkillPrivateArrayScope,
  right: RuntimeSkillPrivateArrayScope,
): boolean {
  if (left.identity !== right.identity || left.reusable !== right.reusable) return false;
  if (left.values === null || right.values === null) {
    return left.values === right.values;
  }
  return left.values.length === right.values.length &&
    left.values.every((value, index) => Object.is(value, right.values?.[index]));
}

function hasSameRuntimeSkillPrivateAttemptScalarScope(
  left: RuntimeSkillPrivateScalarScope,
  right: RuntimeSkillPrivateScalarScope,
): boolean {
  return left.reusable === right.reusable && Object.is(left.value, right.value);
}

function hasSameRuntimeSkillPrivateAttemptRecordScope(
  left: RuntimeSkillPrivateRecordScope,
  right: RuntimeSkillPrivateRecordScope,
): boolean {
  if (left.identity !== right.identity || left.reusable !== right.reusable) return false;
  if (left.entries === null || right.entries === null) {
    return left.entries === right.entries;
  }
  return left.entries.length === right.entries.length &&
    left.entries.every((entry, index) => {
      const other = right.entries?.[index];
      return other !== undefined && entry[0] === other[0] && Object.is(entry[1], other[1]);
    });
}

function hasSameRuntimeSkillPrivateAttemptLoaderScope(
  left: RuntimeSkillPrivateLoaderScope,
  right: RuntimeSkillPrivateLoaderScope,
): boolean {
  return left.identity === right.identity && left.reusable === right.reusable &&
    hasSameRuntimeSkillPrivateAttemptScalarScope(
      left.listProjectSkillReferences,
      right.listProjectSkillReferences,
    ) &&
    hasSameRuntimeSkillPrivateAttemptScalarScope(
      left.loadProjectSkill,
      right.loadProjectSkill,
    ) &&
    hasSameRuntimeSkillPrivateAttemptScalarScope(
      left.loadProjectSkillReference,
      right.loadProjectSkillReference,
    );
}

function hasSameRuntimeSkillPrivateAttemptScope(
  left: RuntimeSkillPrivateAuthorityScope,
  right: RuntimeSkillPrivateAuthorityScope,
): boolean {
  return hasSameRuntimeSkillPrivateAttemptScalarScope(left.authToken, right.authToken) &&
    hasSameRuntimeSkillPrivateAttemptScalarScope(left.agentId, right.agentId) &&
    hasSameRuntimeSkillPrivateAttemptScalarScope(left.projectId, right.projectId) &&
    hasSameRuntimeSkillPrivateAttemptScalarScope(left.branchId, right.branchId) &&
    hasSameRuntimeSkillPrivateAttemptScalarScope(left.skillsDir, right.skillsDir) &&
    hasSameRuntimeSkillPrivateAttemptLoaderScope(
      left.projectSkillLoader,
      right.projectSkillLoader,
    ) &&
    hasSameRuntimeSkillPrivateAttemptRecordScope(
      left.skillSourcePaths,
      right.skillSourcePaths,
    ) &&
    hasSameRuntimeSkillPrivateAttemptArrayScope(
      left.availableSkillIds,
      right.availableSkillIds,
    ) &&
    hasSameRuntimeSkillPrivateAttemptArrayScope(
      left.builtinSkillIds,
      right.builtinSkillIds,
    ) &&
    hasSameRuntimeSkillPrivateAttemptArrayScope(
      left.availableToolNames,
      right.availableToolNames,
    ) &&
    left.loadedSkillResponses === right.loadedSkillResponses &&
    left.loadedSkillReferenceResponses === right.loadedSkillReferenceResponses;
}

type RuntimeLoadedSkillMarker = Readonly<{
  skillId: string;
  hasAdvertisedReferences: boolean;
}>;

function snapshotLoadedSkillMarker(
  response: unknown,
  expectedSkillId: string,
): RuntimeLoadedSkillMarker | undefined {
  const skillId = readOwnDataProperty(response, "skillId");
  if (skillId !== expectedSkillId) return undefined;
  const references = readOwnDataProperty(response, "references");
  const referenceLength = isRuntimeLoadSkillArray(references)
    ? readOwnDataProperty(references, "length")
    : undefined;
  return Object.freeze({
    skillId,
    hasAdvertisedReferences: typeof referenceLength === "number" && referenceLength > 0,
  });
}

function isScopedRuntimeSkillCacheKey(cacheKey: string, skillId: string): boolean {
  try {
    const parsed = JSON.parse(cacheKey);
    return isRuntimeLoadSkillArray(parsed) &&
      (parsed.length === 4 || parsed.length === 5) &&
      parsed[0] === skillId;
  } catch {
    return false;
  }
}

function snapshotLoadedSkillMarkers(
  context: RuntimeLoadSkillToolContext,
  skillIds: readonly string[],
): readonly RuntimeLoadedSkillMarker[] {
  const record = readOwnDataProperty(context, "loadedSkillResponses");
  if (!record || typeof record !== "object" || isRuntimeLoadSkillArray(record)) {
    return [];
  }

  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = ReflectApply(ObjectGetOwnPropertyDescriptors, undefined, [
      record,
    ]) as PropertyDescriptorMap;
  } catch {
    return [];
  }

  const markers: RuntimeLoadedSkillMarker[] = [];
  for (const expectedSkillId of skillIds) {
    const currentCacheKey = buildRuntimeSkillCacheKey(context, expectedSkillId);
    const currentDescriptor = descriptors[currentCacheKey];
    if (isOwnDataPropertyDescriptor(currentDescriptor)) {
      const marker = snapshotLoadedSkillMarker(currentDescriptor.value, expectedSkillId);
      if (marker) {
        markers.push(marker);
        continue;
      }
    }

    for (const [cacheKey, descriptor] of Object.entries(descriptors)) {
      if (
        cacheKey === currentCacheKey ||
        isScopedRuntimeSkillCacheKey(cacheKey, expectedSkillId) ||
        !descriptor.enumerable ||
        !isOwnDataPropertyDescriptor(descriptor)
      ) {
        continue;
      }
      const marker = snapshotLoadedSkillMarker(descriptor.value, expectedSkillId);
      if (!marker) continue;
      markers.push(marker);
      break;
    }
  }
  return Object.freeze(markers);
}

function hasLoadedSkillResponseMarker(
  loadedSkillResponses: Record<string, RuntimeLoadedSkillResponse>,
  cacheKey: string,
): boolean {
  return hasOwnDataProperty(loadedSkillResponses, cacheKey);
}

function executionContextAdvertisesReference(
  context: ToolExecutionContext | undefined,
  skillId: string,
  file: string,
  normalizedFile: string,
): boolean {
  if (
    file !== normalizedFile ||
    readOwnDataProperty(context, "activeSkillId") !== skillId
  ) {
    return false;
  }

  const availability = readOwnDataProperty(context, "activeSkillToolAvailability");
  const references = readOwnDataProperty(availability, "references");
  if (!isRuntimeLoadSkillArray(references)) {
    return false;
  }

  try {
    const lengthDescriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
      references,
      "length",
    ]) as PropertyDescriptor | undefined;
    const length = isOwnDataPropertyDescriptor(lengthDescriptor)
      ? lengthDescriptor.value
      : undefined;
    if (
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > SKILL_LOADABLE_REFERENCE_MAX_ENTRIES
    ) {
      return false;
    }

    let isAdvertised = false;
    for (let index = 0; index < length; index += 1) {
      const descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
        references,
        index,
      ]) as PropertyDescriptor | undefined;
      const reference = isOwnDataPropertyDescriptor(descriptor) ? descriptor.value : undefined;
      if (
        typeof reference !== "string" ||
        normalizeStrictRuntimeSkillReferencePath(reference) !== reference
      ) {
        return false;
      }
      isAdvertised ||= reference === normalizedFile;
    }
    return isAdvertised;
  } catch {
    return false;
  }
}

function hasClaimedProjectSkill(
  context: RuntimeLoadSkillToolContext,
  skillId: string,
): boolean {
  const sourcePaths = snapshotRuntimeSkillPrivateRecordPropertyScope(
    context,
    "skillSourcePaths",
  );
  if (!sourcePaths.reusable) {
    return true;
  }
  return sourcePaths.entries?.some(([key]) => key === skillId) ?? false;
}

function buildRuntimeLoadSkillDescription(options: RuntimeLoadSkillToolOptions): string {
  if (options.description) {
    return options.description;
  }

  // Validate the skill inventory (bounds + data-property/proxy safety) at
  // construction, as before — the IDs are no longer listed in the description,
  // but the guardrails this call enforces must still run.
  getKnownRuntimeSkillIds(options);

  // Static, project-independent: the per-project ID list lives in the
  // generated skill context, not in the tool definition. Keeping skill IDs out
  // of the description (and the advertised input schema) lets the tools array
  // join the shared cache prefix. See RFC 0001 (layered context).
  return `${RUNTIME_LOAD_SKILL_DESCRIPTION} Skill IDs may be listed in the <available_skills> or <authorized_skill_ids> context block. Direct consumers can omit skillId to page authorized IDs or provide equivalent context. You must not invent IDs.`;
}

function snapshotRuntimeSkillIdInventory(
  value: unknown,
  label: "availableSkillIds" | "builtinSkillIds",
): string[] {
  const snapshot = snapshotOwnDataPropertyArray(value, {
    label: `Runtime load skill ${label}`,
    maximumEntries: SKILL_RUNTIME_LOADED_SKILL_CACHE_MAX_ENTRIES,
    mapValue: (skillId, index) => {
      if (
        typeof skillId !== "string" ||
        skillId.length === 0 ||
        skillId.length > SKILL_ID_MAX_LENGTH ||
        !RUNTIME_SKILL_ID_PATTERN.test(skillId)
      ) {
        throw new TypeError(
          `Runtime load skill ${label} entry ${index} must be a valid bounded skill ID`,
        );
      }
      return skillId;
    },
  });
  return [...new Set(snapshot)];
}

function getKnownRuntimeSkillIds(options: RuntimeLoadSkillToolOptions): string[] | null {
  const availableSkillIds = snapshotRuntimeSkillPrivateScalarScope(
    options.context,
    "availableSkillIds",
  );
  if (!availableSkillIds.reusable) {
    throw new TypeError("Runtime load skill availableSkillIds must be a data property");
  }
  if (availableSkillIds.value !== undefined) {
    return snapshotRuntimeSkillIdInventory(
      availableSkillIds.value,
      "availableSkillIds",
    );
  }

  const builtinSkillIds = snapshotRuntimeSkillPrivateScalarScope(
    options,
    "builtinSkillIds",
  );
  if (!builtinSkillIds.reusable) {
    throw new TypeError("Runtime load skill builtinSkillIds must be a data property");
  }
  if (builtinSkillIds.value === undefined) {
    return null;
  }
  return snapshotRuntimeSkillIdInventory(builtinSkillIds.value, "builtinSkillIds");
}

function buildRuntimeSkillInventoryPage(
  options: RuntimeLoadSkillToolOptions,
  cursor: number,
): RuntimeLoadSkillInventoryOutput | RuntimeLoadSkillErrorOutput {
  const knownSkillIds = getKnownRuntimeSkillIds(options);
  if (knownSkillIds === null) {
    return {
      error: "The authorized skill inventory is unavailable. Call load_skill with a known skillId.",
    };
  }

  const skillIds: string[] = [];
  const end = Math.min(knownSkillIds.length, cursor + RUNTIME_SKILL_INVENTORY_PAGE_MAX_IDS);
  for (let index = cursor; index < end; index += 1) {
    ObjectDefineProperty(skillIds, skillIds.length, {
      configurable: true,
      enumerable: true,
      value: knownSkillIds[index],
      writable: true,
    });
  }
  const nextCursor = cursor + skillIds.length;
  return nextCursor < knownSkillIds.length ? { skillIds, nextCursor } : { skillIds };
}

function getLoadedRuntimeSkillIds(
  markers: readonly RuntimeLoadedSkillMarker[],
): string[] {
  return [
    ...new Set(
      markers.map((marker) => marker.skillId),
    ),
  ].sort();
}

function getReferenceableLoadedRuntimeSkillIds(
  markers: readonly RuntimeLoadedSkillMarker[],
  options: RuntimeLoadSkillToolOptions,
  authorizationStore: ReadonlyMap<string, RuntimeSkillReferenceAuthorization>,
): string[] {
  return [
    ...new Set(
      markers
        .filter((marker) =>
          marker.hasAdvertisedReferences ||
          (authorizationStore.get(buildRuntimeSkillCacheKey(options.context, marker.skillId))
              ?.references.length ?? 0) > 0
        )
        .map((marker) => marker.skillId),
    ),
  ].sort();
}

function getRuntimeSkillIdInputValues(
  skillIds: readonly [string, ...string[]],
  knownSkillIds: readonly string[],
): [string, ...string[]] {
  const knownSkillIdSet = new Set(knownSkillIds);
  const values = skillIds.flatMap((skillId) => {
    const alias = `${skillId}.md`;
    return skillId.endsWith(".md") || knownSkillIdSet.has(alias) ? [skillId] : [skillId, alias];
  });
  return values as [string, ...string[]];
}

function normalizeRuntimeLoadSkillInputSkillId(
  options: RuntimeLoadSkillToolOptions,
  skillId: string,
): string {
  const knownSkillIds = getKnownRuntimeSkillIds(options);
  if (knownSkillIds?.includes(skillId)) {
    return skillId;
  }

  const aliasTarget = skillId.endsWith(".md") ? skillId.slice(0, -3) : null;
  if (aliasTarget && (!knownSkillIds || knownSkillIds.includes(aliasTarget))) {
    return aliasTarget;
  }

  return skillId;
}

function buildRuntimeLoadSkillInputSchema(
  options: RuntimeLoadSkillToolOptions,
  authorizationStore: ReadonlyMap<string, RuntimeSkillReferenceAuthorization>,
) {
  const knownIds = getKnownRuntimeSkillIds(options);
  if (!knownIds) {
    return runtimeLoadSkillToolInputSchema;
  }

  if (knownIds.length === 0) {
    return defineSchema((v) =>
      v.object({
        skillId: v.string().refine(
          () => false,
          "No skills are available in this run.",
        ).describe("No skills are available in this run."),
        file: getRuntimeLoadSkillReferenceFileInputSchema().optional(),
      }).strict()
    )();
  }

  const knownIdSet = new Set(knownIds);
  const loadedMarkers = snapshotLoadedSkillMarkers(options.context, knownIds);
  const loadedIds = getLoadedRuntimeSkillIds(loadedMarkers).filter((skillId) =>
    knownIdSet.has(skillId)
  );
  const loadedIdSet = new Set(loadedIds);
  const referenceableLoadedIds = getReferenceableLoadedRuntimeSkillIds(
    loadedMarkers,
    options,
    authorizationStore,
  )
    .filter((skillId) => knownIdSet.has(skillId));
  const unloadedIds = knownIds.filter((skillId) => !loadedIdSet.has(skillId));

  if (
    loadedIds.length > 0 && unloadedIds.length === 0 && referenceableLoadedIds.length === 0
  ) {
    const [firstLoaded, ...restLoaded] = loadedIds as [string, ...string[]];
    const loadedEnumValues = getRuntimeSkillIdInputValues(
      [firstLoaded, ...restLoaded],
      knownIds,
    );
    return defineSchema((v) =>
      v.object({
        skillId: v.enum(loadedEnumValues).describe(
          `Already-loaded skill ID with no advertised reference files. Calling load_skill again is a no-op. Loaded skill IDs: ${
            loadedEnumValues.join(", ")
          }`,
        ),
      }).strict()
    )();
  }

  if (referenceableLoadedIds.length > 0 && unloadedIds.length === 0) {
    const [firstLoaded, ...restLoaded] = referenceableLoadedIds as [string, ...string[]];
    const loadedEnumValues = getRuntimeSkillIdInputValues(
      [firstLoaded, ...restLoaded],
      knownIds,
    );
    return defineSchema((v) =>
      v.object({
        skillId: v.enum(loadedEnumValues).describe(
          `Already-loaded skill ID. Body reloads are not allowed; use this only with file for listed references. Loaded skill IDs: ${
            loadedEnumValues.join(", ")
          }`,
        ),
        file: getRuntimeLoadSkillReferenceFileInputSchema().describe(
          "Required reference file to load from an already-loaded skill. Do not call load_skill again for the skill body.",
        ),
      })
    )();
  }

  if (referenceableLoadedIds.length > 0) {
    const [firstUnloaded, ...restUnloaded] = unloadedIds as [string, ...string[]];
    const unloadedEnumValues = getRuntimeSkillIdInputValues(
      [firstUnloaded, ...restUnloaded],
      knownIds,
    );
    const [firstLoaded, ...restLoaded] = referenceableLoadedIds as [string, ...string[]];
    const loadedEnumValues = getRuntimeSkillIdInputValues(
      [firstLoaded, ...restLoaded],
      knownIds,
    );
    return defineSchema((v) =>
      v.union([
        v.object({
          skillId: v.enum(unloadedEnumValues).describe(
            `Unloaded skill ID to load. Available unloaded skill IDs: ${
              unloadedEnumValues.join(", ")
            }`,
          ),
          file: getRuntimeLoadSkillReferenceFileInputSchema().optional().describe(
            "Optional reference file to load. First load the skill with only skillId, then use file only for a reference path listed by that loaded skill.",
          ),
        }),
        v.object({
          skillId: v.enum(loadedEnumValues).describe(
            `Already-loaded skill ID. Body reloads are not allowed; use this only with file for listed references. Loaded skill IDs: ${
              loadedEnumValues.join(", ")
            }`,
          ),
          file: getRuntimeLoadSkillReferenceFileInputSchema().describe(
            "Required reference file to load from an already-loaded skill. Do not call load_skill again for the skill body.",
          ),
        }),
      ])
    )();
  }

  const [first, ...rest] = unloadedIds as [string, ...string[]];
  const enumValues = getRuntimeSkillIdInputValues([first, ...rest], knownIds);
  return defineSchema((v) =>
    v.object({
      skillId: v.enum(enumValues).describe(
        `Unloaded skill ID to load. Available unloaded skill IDs: ${enumValues.join(", ")}`,
      ),
      file: getRuntimeLoadSkillReferenceFileInputSchema().optional().describe(
        "Optional reference file to load. First load the skill with only skillId, then use file only for a reference path listed by that loaded skill.",
      ),
    })
  )();
}

async function loadRuntimeSkillReferenceFile(
  options: RuntimeLoadSkillToolOptions,
  builtinStore: RuntimeLoadSkillBuiltinStore,
  privateAuthority: RuntimeSkillPrivateAuthorityController,
  authorizationStore: Map<string, RuntimeSkillReferenceAuthorization>,
  trustedResponseStore: Map<string, RuntimeLoadedSkillResponse>,
  trustedReferenceStore: Map<string, true>,
  loadedSkillResponses: Record<string, RuntimeLoadedSkillResponse>,
  loadedSkillReferenceResponses: Record<string, true | RuntimeLoadSkillReferenceFileOutput>,
  skillId: string,
  file: string,
  executionContext: ToolExecutionContext | undefined,
  budget: SkillOperationBudget,
): Promise<RuntimeLoadSkillReferenceFileOutput | RuntimeLoadSkillErrorOutput> {
  const normalizedFile = normalizeStrictRuntimeSkillReferencePath(file);
  if (!normalizedFile) {
    return { error: `Invalid reference file path: ${file}` };
  }

  authorityAttempts:
  for (
    let attempt = 0;
    attempt < RUNTIME_SKILL_PRIVATE_AUTHORITY_MAX_ATTEMPTS;
    attempt += 1
  ) {
    let authorityGuard = privateAuthority.begin();
    const loadedSkillKey = buildRuntimeSkillCacheKey(options.context, skillId);
    const hasLoadedSkillResponse = hasLoadedSkillResponseMarker(
      loadedSkillResponses,
      loadedSkillKey,
    );
    const cachedAuthorization = authorizationStore.get(loadedSkillKey);
    const resumedReferenceIsAdvertised: boolean = !hasLoadedSkillResponse &&
      executionContextAdvertisesReference(
        executionContext,
        skillId,
        file,
        normalizedFile,
      );
    const reusableCachedAuthorization: RuntimeSkillReferenceAuthorization | undefined =
      cachedAuthorization &&
        (!cachedAuthorization.requiresActiveSkillContext || resumedReferenceIsAdvertised)
        ? cachedAuthorization
        : undefined;
    if (
      !reusableCachedAuthorization &&
      !hasLoadedSkillResponse &&
      !resumedReferenceIsAdvertised
    ) {
      return {
        error: `Skill "${skillId}" must be loaded before reference file "${normalizedFile}". ` +
          `Call load_skill with {"load":{"skillId":"${skillId}"}} first, then request one of the listed reference files.`,
      };
    }

    let authorization: RuntimeSkillReferenceAuthorization | undefined = reusableCachedAuthorization;
    if (!authorization) {
      const requiresActiveSkillContext = !hasLoadedSkillResponse && resumedReferenceIsAdvertised;
      const bodyPublication = privateAuthority.captureBody(loadedSkillKey);
      const projectSkill = await loadRuntimeSkillBody(options, skillId, budget);
      budget.throwIfTerminated();
      if (!privateAuthority.isCurrent(authorityGuard)) {
        continue;
      }

      let responseToRemember: RuntimeLoadedSkillResponse | undefined;
      if (projectSkill) {
        responseToRemember = buildLoadedSkillResponse({
          options,
          skillId,
          instructions: projectSkill.instructions,
          references: projectSkill.references,
        });
        if (!privateAuthority.isCurrent(authorityGuard)) {
          continue;
        }
        authorization = createReferenceAuthorization(
          responseToRemember.references,
          requiresActiveSkillContext,
        );
      } else {
        const projectSkillIsClaimed = hasClaimedProjectSkill(options.context, skillId);
        if (!privateAuthority.isCurrent(authorityGuard)) {
          continue;
        }
        if (!projectSkillIsClaimed) {
          const localContent = await builtinStore.readSkill(options.skillsDir, skillId, budget);
          budget.throwIfTerminated();
          if (!privateAuthority.isCurrent(authorityGuard)) {
            continue;
          }
          if (localContent !== null) {
            const references = await builtinStore.listReferences(
              options.skillsDir,
              skillId,
              budget,
            );
            budget.throwIfTerminated();
            if (!privateAuthority.isCurrent(authorityGuard)) {
              continue;
            }
            responseToRemember = buildLoadedSkillResponse({
              options,
              skillId,
              instructions: localContent,
              references,
            });
            if (!privateAuthority.isCurrent(authorityGuard)) {
              continue;
            }
          }
        }
        authorization = createReferenceAuthorization(
          responseToRemember?.references,
          requiresActiveSkillContext,
        );
      }

      const authorizationToRemember = authorization;
      const published = privateAuthority.commit(
        authorityGuard,
        bodyPublication,
        [],
        () => {
          if (responseToRemember) {
            rememberTrustedLoadedSkillResponse(
              authorizationStore,
              trustedResponseStore,
              loadedSkillResponses,
              loadedSkillKey,
              responseToRemember,
              hasLoadedSkillResponse,
            );
          }
          rememberBoundedPrivateValue(
            authorizationStore,
            loadedSkillKey,
            authorizationToRemember,
          );
          return authorizationToRemember;
        },
      );
      if (!published) {
        continue;
      }
      authorityGuard = published.guard;
      authorization = published.value;
    }
    if (!authorization.has(normalizedFile)) {
      const availableReferences = authorization.references.length > 0
        ? authorization.references.join(", ")
        : "none";
      return {
        error: `Reference file not advertised by loaded skill "${skillId}": ${normalizedFile}. ` +
          `Available references: ${availableReferences}`,
      };
    }

    const referenceKey = buildRuntimeSkillReferenceCacheKey(
      options.context,
      skillId,
      normalizedFile,
    );
    if (trustedReferenceStore.has(referenceKey)) {
      return buildAlreadyLoadedSkillReferenceResponse(skillId, normalizedFile);
    }

    const bodyDependency = privateAuthority.captureBody(loadedSkillKey);
    const referencePublication = privateAuthority.captureReference(referenceKey);
    const projectFileContent = await options.projectSkillLoader.loadProjectSkillReference(
      options.context,
      skillId,
      normalizedFile,
      { budget },
    );
    budget.throwIfTerminated();
    if (!privateAuthority.isCurrent(authorityGuard)) {
      continue;
    }
    if (projectFileContent !== null) {
      const response = { skillId, file: normalizedFile, content: projectFileContent };
      const published = privateAuthority.commit(
        authorityGuard,
        referencePublication,
        [bodyDependency],
        () => {
          rememberBoundedRecordValue(
            loadedSkillReferenceResponses,
            referenceKey,
            true,
            SKILL_RUNTIME_LOADED_REFERENCE_CACHE_MAX_ENTRIES,
          );
          rememberBoundedPrivateValue(
            trustedReferenceStore,
            referenceKey,
            true,
            SKILL_RUNTIME_LOADED_REFERENCE_CACHE_MAX_ENTRIES,
          );
          return response;
        },
      );
      if (!published) {
        continue;
      }
      return published.value;
    }

    const projectSkillIsClaimed = hasClaimedProjectSkill(options.context, skillId);
    if (!privateAuthority.isCurrent(authorityGuard)) {
      continue;
    }
    if (projectSkillIsClaimed) {
      return { error: `Project skill reference not found: ${skillId}/${normalizedFile}` };
    }

    const localContent = await builtinStore.readReferenceFile(
      options.skillsDir,
      skillId,
      normalizedFile,
      budget,
    );
    budget.throwIfTerminated();
    if (!privateAuthority.isCurrent(authorityGuard)) {
      continue authorityAttempts;
    }
    if (localContent !== null) {
      const response = { skillId, file: normalizedFile, content: localContent };
      const published = privateAuthority.commit(
        authorityGuard,
        referencePublication,
        [bodyDependency],
        () => {
          rememberBoundedRecordValue(
            loadedSkillReferenceResponses,
            referenceKey,
            true,
            SKILL_RUNTIME_LOADED_REFERENCE_CACHE_MAX_ENTRIES,
          );
          rememberBoundedPrivateValue(
            trustedReferenceStore,
            referenceKey,
            true,
            SKILL_RUNTIME_LOADED_REFERENCE_CACHE_MAX_ENTRIES,
          );
          return response;
        },
      );
      if (!published) {
        continue;
      }
      return published.value;
    }

    return { error: `Reference file not found: ${skillId}/${normalizedFile}` };
  }

  return {
    error:
      `Skill authorization context changed repeatedly while loading "${skillId}". Request was not completed.`,
  };
}

async function loadRuntimeSkillBody(
  options: RuntimeLoadSkillToolOptions,
  skillId: string,
  budget: SkillOperationBudget,
): Promise<RuntimeLoadedProjectSkill | null> {
  return await options.projectSkillLoader.loadProjectSkill(options.context, skillId, { budget });
}

/**
 * Create runtime load skill tool for prompts that provide skill context.
 *
 * Use this with {@link buildAgentCallContext} or an equivalent system prompt
 * that supplies `<available_skills>` or `<authorized_skill_ids>`. Direct tool
 * consumers that do not use that prompt context must pass `description` with
 * their own authorized skill discovery text.
 */
export function createRuntimeLoadSkillTool(
  options: RuntimeLoadSkillToolOptions,
): Tool<RuntimeLoadSkillToolInput, RuntimeLoadSkillToolOutput> {
  const builtinStore = getBuiltinStore(options);
  const authorizationStore = new Map<string, RuntimeSkillReferenceAuthorization>();
  const trustedResponseStore = new Map<string, RuntimeLoadedSkillResponse>();
  const trustedReferenceStore = new Map<string, true>();
  const bodyPublicationVersions = new Map<string, number>();
  const referencePublicationVersions = new Map<string, number>();
  let authorityScope: RuntimeSkillPrivateAuthorityScope | undefined;
  // This per-tool epoch orders runtime-observed complete-scope transitions.
  // Descriptor rechecks also catch direct mutations whose final scope differs;
  // they intentionally do not claim to observe an otherwise invisible direct ABA.
  let authorityScopeEpoch = 0;
  // Per-key versions arbitrate same-skill publications without invalidating
  // stable work for unrelated skills in the same complete authority scope.
  let authorityPublicationSequence = 0;

  function nextAuthorityPublicationVersion(): number {
    if (authorityPublicationSequence >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError("Runtime skill authority publication sequence is exhausted");
    }
    authorityPublicationSequence += 1;
    return authorityPublicationSequence;
  }

  function clearPrivateAuthorityStores(): void {
    authorizationStore.clear();
    trustedResponseStore.clear();
    trustedReferenceStore.clear();
    bodyPublicationVersions.clear();
    referencePublicationVersions.clear();
  }

  function refreshPrivateAuthorityScope(
    loadedSkillResponses?: Record<string, RuntimeLoadedSkillResponse>,
    loadedSkillReferenceResponses?: Record<
      string,
      true | RuntimeLoadSkillReferenceFileOutput
    >,
  ): RuntimeSkillPrivateAuthorityGuard {
    const nextScope = snapshotRuntimeSkillPrivateAuthorityScope(
      options,
      loadedSkillResponses,
      loadedSkillReferenceResponses,
    );
    if (
      authorityScope !== undefined &&
      hasSameRuntimeSkillPrivateAuthorityScope(authorityScope, nextScope)
    ) {
      return Object.freeze({ scope: authorityScope, scopeEpoch: authorityScopeEpoch });
    }
    authorityScopeEpoch += 1;
    clearPrivateAuthorityStores();
    authorityScope = nextScope;
    return Object.freeze({ scope: nextScope, scopeEpoch: authorityScopeEpoch });
  }

  function isPrivateAuthorityGuardCurrent(
    guard: RuntimeSkillPrivateAuthorityGuard,
    loadedSkillResponses?: Record<string, RuntimeLoadedSkillResponse>,
    loadedSkillReferenceResponses?: Record<
      string,
      true | RuntimeLoadSkillReferenceFileOutput
    >,
  ): boolean {
    if (guard.scopeEpoch !== authorityScopeEpoch) {
      return false;
    }
    const currentScope = snapshotRuntimeSkillPrivateAuthorityScope(
      options,
      loadedSkillResponses,
      loadedSkillReferenceResponses,
    );
    return hasSameRuntimeSkillPrivateAttemptScope(guard.scope, currentScope);
  }

  function getPrivatePublicationStore(
    kind: RuntimeSkillPrivatePublicationGuard["kind"],
  ): Map<string, number> {
    return kind === "body" ? bodyPublicationVersions : referencePublicationVersions;
  }

  function getPrivatePublicationLimit(
    kind: RuntimeSkillPrivatePublicationGuard["kind"],
  ): number {
    return kind === "body"
      ? SKILL_RUNTIME_LOADED_SKILL_CACHE_MAX_ENTRIES
      : SKILL_RUNTIME_LOADED_REFERENCE_CACHE_MAX_ENTRIES;
  }

  function capturePrivatePublication(
    kind: RuntimeSkillPrivatePublicationGuard["kind"],
    key: string,
  ): RuntimeSkillPrivatePublicationGuard {
    const store = getPrivatePublicationStore(kind);
    let version = store.get(key);
    if (version === undefined) {
      version = nextAuthorityPublicationVersion();
      rememberBoundedPrivateValue(
        store,
        key,
        version,
        getPrivatePublicationLimit(kind),
      );
    }
    return Object.freeze({ key, kind, version });
  }

  function isPrivatePublicationCurrent(
    guard: RuntimeSkillPrivatePublicationGuard,
  ): boolean {
    return getPrivatePublicationStore(guard.kind).get(guard.key) === guard.version;
  }

  function commitPrivateAuthority<T>(
    guard: RuntimeSkillPrivateAuthorityGuard,
    target: RuntimeSkillPrivatePublicationGuard,
    dependencies: readonly RuntimeSkillPrivatePublicationGuard[],
    publish: () => T,
    loadedSkillResponses?: Record<string, RuntimeLoadedSkillResponse>,
    loadedSkillReferenceResponses?: Record<
      string,
      true | RuntimeLoadSkillReferenceFileOutput
    >,
  ): RuntimeSkillPrivateAuthorityCommit<T> | null {
    if (
      !isPrivateAuthorityGuardCurrent(
        guard,
        loadedSkillResponses,
        loadedSkillReferenceResponses,
      ) ||
      !isPrivatePublicationCurrent(target) ||
      dependencies.some((dependency) => !isPrivatePublicationCurrent(dependency))
    ) {
      return null;
    }

    let value: T;
    let committedTarget: RuntimeSkillPrivatePublicationGuard;
    try {
      const committedVersion = nextAuthorityPublicationVersion();
      rememberBoundedPrivateValue(
        getPrivatePublicationStore(target.kind),
        target.key,
        committedVersion,
        getPrivatePublicationLimit(target.kind),
      );
      committedTarget = Object.freeze({ ...target, version: committedVersion });
      value = publish();
    } catch (error) {
      authorityScopeEpoch += 1;
      clearPrivateAuthorityStores();
      authorityScope = undefined;
      throw error;
    }
    if (
      !isPrivateAuthorityGuardCurrent(
        guard,
        loadedSkillResponses,
        loadedSkillReferenceResponses,
      ) ||
      !isPrivatePublicationCurrent(committedTarget) ||
      dependencies.some((dependency) => !isPrivatePublicationCurrent(dependency))
    ) {
      return null;
    }
    return Object.freeze({ guard, value });
  }

  function bindPrivateAuthority(
    loadedSkillResponses: Record<string, RuntimeLoadedSkillResponse>,
    loadedSkillReferenceResponses: Record<
      string,
      true | RuntimeLoadSkillReferenceFileOutput
    >,
  ): RuntimeSkillPrivateAuthorityController {
    return Object.freeze({
      begin: () =>
        refreshPrivateAuthorityScope(
          loadedSkillResponses,
          loadedSkillReferenceResponses,
        ),
      captureBody: (key) => capturePrivatePublication("body", key),
      captureReference: (key) => capturePrivatePublication("reference", key),
      isCurrent: (guard) =>
        isPrivateAuthorityGuardCurrent(
          guard,
          loadedSkillResponses,
          loadedSkillReferenceResponses,
        ),
      commit: <T>(
        guard: RuntimeSkillPrivateAuthorityGuard,
        target: RuntimeSkillPrivatePublicationGuard,
        dependencies: readonly RuntimeSkillPrivatePublicationGuard[],
        publish: () => T,
      ) =>
        commitPrivateAuthority(
          guard,
          target,
          dependencies,
          publish,
          loadedSkillResponses,
          loadedSkillReferenceResponses,
        ),
    });
  }

  async function execute(
    input: RuntimeLoadSkillToolInput,
    executionContext?: ToolExecutionContext,
  ) {
    assertRuntimeBoundaryCollections(options);
    let request: NormalizedRuntimeLoadSkillToolInput;
    try {
      request = normalizeRuntimeLoadSkillToolInput(runtimeLoadSkillToolInputSchema.parse(input));
    } catch (error) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: `Tool "load_skill" input validation failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
    if (!("skillId" in request)) {
      return buildRuntimeSkillInventoryPage(options, request.cursor ?? 0);
    }

    let skillId = request.skillId;
    let file = request.file;
    const budget = createSkillOperationBudget({
      abortSignal: executionContext?.abortSignal,
      timeoutMs: SKILL_FILE_OPERATION_TIMEOUT_MS,
    });
    const loadedSkillResponses = getOrCreateRuntimeCacheRecord<RuntimeLoadedSkillResponse>(
      options.context,
      "loadedSkillResponses",
    );
    const loadedSkillReferenceResponses = getOrCreateRuntimeCacheRecord<
      true | RuntimeLoadSkillReferenceFileOutput
    >(options.context, "loadedSkillReferenceResponses");
    const privateAuthority = bindPrivateAuthority(
      loadedSkillResponses,
      loadedSkillReferenceResponses,
    );
    privateAuthority.begin();
    let parsed: NormalizedRuntimeLoadSkillToolInput;
    try {
      parsed = normalizeRuntimeLoadSkillToolInput(
        buildRuntimeLoadSkillInputSchema(options, authorizationStore).parse(
          file === undefined ? { skillId } : { skillId, file },
        ),
      );
    } catch (error) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: `Tool "load_skill" input validation failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
    if (!("skillId" in parsed)) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: 'Tool "load_skill" input validation failed: skillId is required.',
      });
    }
    skillId = normalizeRuntimeLoadSkillInputSkillId(options, parsed.skillId);
    file = "file" in parsed ? parsed.file : undefined;

    const knownSkillIds = getKnownRuntimeSkillIds(options);
    if (knownSkillIds !== null && !knownSkillIds.includes(skillId)) {
      return buildMissingSkillError(options, skillId);
    }

    if (file) {
      return await loadRuntimeSkillReferenceFile(
        options,
        builtinStore,
        privateAuthority,
        authorizationStore,
        trustedResponseStore,
        trustedReferenceStore,
        loadedSkillResponses,
        loadedSkillReferenceResponses,
        skillId,
        file,
        executionContext,
        budget,
      );
    }

    for (
      let attempt = 0;
      attempt < RUNTIME_SKILL_PRIVATE_AUTHORITY_MAX_ATTEMPTS;
      attempt += 1
    ) {
      const authorityGuard = privateAuthority.begin();
      const loadedSkillKey = buildRuntimeSkillCacheKey(options.context, skillId);
      const trustedResponse = trustedResponseStore.get(loadedSkillKey);
      if (trustedResponse) {
        return buildAlreadyLoadedSkillResponse(skillId, trustedResponse);
      }

      const bodyPublication = privateAuthority.captureBody(loadedSkillKey);
      const projectSkill = await loadRuntimeSkillBody(options, skillId, budget);
      budget.throwIfTerminated();
      if (!privateAuthority.isCurrent(authorityGuard)) {
        continue;
      }
      if (projectSkill) {
        const response = buildLoadedSkillResponse({
          options,
          skillId,
          instructions: projectSkill.instructions,
          references: projectSkill.references,
        });
        if (!privateAuthority.isCurrent(authorityGuard)) {
          continue;
        }
        const published = privateAuthority.commit(
          authorityGuard,
          bodyPublication,
          [],
          () => {
            rememberTrustedLoadedSkillResponse(
              authorizationStore,
              trustedResponseStore,
              loadedSkillResponses,
              loadedSkillKey,
              response,
            );
            return response;
          },
        );
        if (!published) {
          continue;
        }
        return published.value;
      }

      const projectSkillIsClaimed = hasClaimedProjectSkill(options.context, skillId);
      if (!privateAuthority.isCurrent(authorityGuard)) {
        continue;
      }
      if (projectSkillIsClaimed) {
        return {
          error:
            `Project skill "${skillId}" is unavailable or no longer satisfies its validated catalog contract.`,
        };
      }

      const localContent = await builtinStore.readSkill(options.skillsDir, skillId, budget);
      budget.throwIfTerminated();
      if (!privateAuthority.isCurrent(authorityGuard)) {
        continue;
      }
      if (localContent !== null) {
        const references = await builtinStore.listReferences(options.skillsDir, skillId, budget);
        budget.throwIfTerminated();
        if (!privateAuthority.isCurrent(authorityGuard)) {
          continue;
        }
        const response = buildLoadedSkillResponse({
          options,
          skillId,
          instructions: localContent,
          references,
        });
        if (!privateAuthority.isCurrent(authorityGuard)) {
          continue;
        }
        const published = privateAuthority.commit(
          authorityGuard,
          bodyPublication,
          [],
          () => {
            rememberTrustedLoadedSkillResponse(
              authorizationStore,
              trustedResponseStore,
              loadedSkillResponses,
              loadedSkillKey,
              response,
            );
            return response;
          },
        );
        if (!published) {
          continue;
        }
        return published.value;
      }

      return buildMissingSkillError(options, skillId);
    }

    return {
      error:
        `Skill authorization context changed repeatedly while loading "${skillId}". Request was not completed.`,
    };
  }

  return {
    id: "load_skill",
    type: "function",
    description: buildRuntimeLoadSkillDescription(options),
    inputSchema: runtimeLoadSkillToolInputSchema,
    get inputSchemaJson() {
      // Keep refreshing the private reference-authorization scope on schema
      // access (its side effect is relied upon), but advertise the STATIC
      // schema so the tool definition is byte-identical across projects
      // (shared cache prefix — RFC 0001). The per-project dynamic schema is
      // still used for `.parse()` validation at execution, so all runtime
      // enforcement (valid IDs, reload/body rules) is preserved; the model
      // just no longer sees the per-project enum.
      refreshPrivateAuthorityScope();
      return createStaticRuntimeLoadSkillToolInputJsonSchema();
    },
    execute,
  };
}
