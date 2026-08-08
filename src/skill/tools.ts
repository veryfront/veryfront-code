/**
 * Skill Tools
 *
 * Three tools exposed to agents for interacting with skills:
 * - load_skill: Load a skill's full instructions
 * - load_skill_reference: Read a reference file from a skill
 * - execute_skill_script: Execute a script from a skill
 *
 * @module
 */

import { defineSchema } from "#veryfront/schemas/index.ts";
import { LOAD_SKILL_POLICY_CLAUSES } from "./load-skill-policy.ts";
import { tool } from "#veryfront/tool/factory.ts";
import type { Tool, ToolExecutionContext } from "#veryfront/tool";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import {
  captureByteReadCapabilities,
  captureSnapshotReadCapability,
} from "#veryfront/platform/adapters/file-system-capabilities.ts";
import { createError, toError } from "#veryfront/errors";
import { join, relative } from "#veryfront/compat/path";
import { skillRegistryInternal } from "./registry.ts";
import { parseSkillFrontmatter } from "./parser.ts";
import {
  listStrictSkillSubdir,
  listStrictSkillTree,
  validateStrictSkillPath,
} from "./path-safety.ts";
import { createSkillOperationBudget, type SkillOperationBudget } from "./operation-budget.ts";
import {
  isValidSkillScriptEnvironmentKey,
  SKILL_DOCUMENT_MAX_CHARACTERS,
  SKILL_FILE_OPERATION_TIMEOUT_MS,
  SKILL_SCRIPT_MAX_ARG_BYTES_TOTAL,
  SKILL_SCRIPT_MAX_ARG_LENGTH,
  SKILL_SCRIPT_MAX_ARGS,
  SKILL_SCRIPT_MAX_CONTENT_BYTES,
  SKILL_SCRIPT_MAX_ENV_BYTES_TOTAL,
  SKILL_SCRIPT_MAX_ENV_ENTRIES,
  SKILL_SCRIPT_MAX_ENV_KEY_LENGTH,
  SKILL_SCRIPT_MAX_ENV_VALUE_LENGTH,
  SKILL_SCRIPT_MAX_OUTPUT_BYTES,
  SKILL_SCRIPT_MAX_TIMEOUT_MS,
  SKILL_SCRIPT_SNAPSHOT_MAX_BYTES,
  SKILL_SCRIPT_SNAPSHOT_MAX_FILES,
  SKILL_TEXT_FILE_MAX_BYTES,
} from "./limits.ts";
import { getSkillScriptExecutor } from "./executor.ts";
import type {
  Skill,
  SkillContent,
  SkillScriptExecutor,
  SkillScriptResult,
  SkillScriptSnapshot,
  SkillScriptSnapshotFile,
} from "./types.ts";
import {
  isValidProviderSafeSkillId,
  isValidSkillName,
  SKILL_ASSETS_DIR,
  SKILL_MD_FILENAME,
  SKILL_REFERENCES_DIR,
  SKILL_RESOURCES_DIR,
  SKILL_SCRIPTS_DIR,
} from "./types.ts";

/** Maximum allowed script execution timeout in milliseconds (5 minutes) */
const MAX_SCRIPT_TIMEOUT_MS = SKILL_SCRIPT_MAX_TIMEOUT_MS;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf8Encoder = new TextEncoder();
const freeze = Object.freeze;
const defineOwnProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const numberIsSafeInteger = Number.isSafeInteger;
const reflectApply = Reflect.apply;
const arrayIncludes = Array.prototype.includes;
const arraySlice = Array.prototype.slice;
const arraySort = Array.prototype.sort;
const stringReplaceAll = String.prototype.replaceAll;

function appendOwnArrayElement<T>(values: T[], value: T): void {
  defineOwnProperty(values, values.length, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

type SkillFileKind = "reference" | "script";
type SkillSelectorToolOptions = {
  resolveAllowedSkillIds?: (context: ToolExecutionContext | undefined) => readonly string[];
};

const getLoadSkillInputSchema = defineSchema((v) =>
  v.object({
    skillId: v.string().describe("The ID of the skill to load"),
  })
);

const getLoadSkillReferenceInputSchema = defineSchema((v) =>
  v.object({
    skillId: v.string().describe("The ID of the skill"),
    reference: v.string().describe(
      "Relative path to the reference file (e.g. 'references/CLAUSES.md')",
    ),
  })
);

const getExecuteSkillScriptInputSchema = defineSchema((v) =>
  v.object({
    skillId: v.string().describe("The ID of the skill"),
    script: v.string().describe("Relative path to the script (e.g. 'scripts/setup.sh')"),
    args: v.array(v.string()).optional().describe("Arguments to pass to the script"),
    env: v.record(v.string(), v.string()).optional().describe(
      "Environment variables for the script",
    ),
    timeoutMs: v
      .number()
      .int()
      .positive()
      .max(MAX_SCRIPT_TIMEOUT_MS)
      .optional()
      .describe(`Optional execution timeout in milliseconds (max ${MAX_SCRIPT_TIMEOUT_MS})`),
  })
);

/**
 * Read a file from a skill directory.
 * Uses skill.fsAdapter if available (VFS/cloud), otherwise falls back to compat readTextFile.
 */
async function readSkillFile(
  skill: Skill,
  path: string,
  byteLimit: number,
  budget: SkillOperationBudget,
): Promise<string> {
  return await budget.run(async () => {
    const fileSystem = skill.fsAdapter ?? createFileSystem();
    const snapshot = captureSnapshotReadCapability(
      fileSystem,
      "Skill filesystem",
      true,
    );
    const bytes = snapshot
      ? await snapshot.read(path, skill.rootPath, byteLimit)
      : await requireExactSkillReader(fileSystem)(path, byteLimit);
    return utf8Decoder.decode(bytes);
  });
}

function requireExactSkillReader(
  fileSystem: object,
): (path: string, byteLimit: number) => Promise<Uint8Array> {
  const reader = captureByteReadCapabilities(fileSystem, "Skill filesystem").exact;
  if (!reader) {
    throw new TypeError(
      "Skill filesystem must provide an exact bounded read capability",
    );
  }
  return reader;
}

function createFileBudget(context: ToolExecutionContext | undefined, timeoutMs?: number) {
  return createSkillOperationBudget({
    abortSignal: context?.abortSignal,
    timeoutMs: timeoutMs ?? SKILL_FILE_OPERATION_TIMEOUT_MS,
  });
}

function assertDocumentCharacterLimit(content: string): void {
  if (content.length > SKILL_DOCUMENT_MAX_CHARACTERS) {
    throw new RangeError(
      `Skill document may contain at most ${SKILL_DOCUMENT_MAX_CHARACTERS} characters`,
    );
  }
}

function assertScriptInputs(
  args: readonly string[] | undefined,
  env: Readonly<Record<string, string>> | undefined,
): void {
  if ((args?.length ?? 0) > SKILL_SCRIPT_MAX_ARGS) {
    throw new RangeError(`Skill scripts accept at most ${SKILL_SCRIPT_MAX_ARGS} arguments`);
  }
  let argumentBytes = 0;
  for (const argument of args ?? []) {
    if (argument.length > SKILL_SCRIPT_MAX_ARG_LENGTH) {
      throw new RangeError(
        `Skill script arguments may contain at most ${SKILL_SCRIPT_MAX_ARG_LENGTH} characters`,
      );
    }
    argumentBytes += utf8Encoder.encode(argument).byteLength;
    if (argumentBytes > SKILL_SCRIPT_MAX_ARG_BYTES_TOTAL) {
      throw new RangeError(
        `Skill script arguments may contain at most ${SKILL_SCRIPT_MAX_ARG_BYTES_TOTAL} bytes`,
      );
    }
  }

  const entries = Object.entries(env ?? {});
  if (entries.length > SKILL_SCRIPT_MAX_ENV_ENTRIES) {
    throw new RangeError(
      `Skill script environments may contain at most ${SKILL_SCRIPT_MAX_ENV_ENTRIES} entries`,
    );
  }
  let environmentBytes = 0;
  for (const [key, value] of entries) {
    if (!isValidSkillScriptEnvironmentKey(key) || key.length > SKILL_SCRIPT_MAX_ENV_KEY_LENGTH) {
      throw new TypeError(`Invalid skill script environment key: ${key}`);
    }
    if (value.length > SKILL_SCRIPT_MAX_ENV_VALUE_LENGTH) {
      throw new RangeError(
        `Skill script environment values may contain at most ${SKILL_SCRIPT_MAX_ENV_VALUE_LENGTH} characters`,
      );
    }
    environmentBytes += utf8Encoder.encode(key).byteLength + utf8Encoder.encode(value).byteLength;
    if (environmentBytes > SKILL_SCRIPT_MAX_ENV_BYTES_TOTAL) {
      throw new RangeError(
        `Skill script environments may contain at most ${SKILL_SCRIPT_MAX_ENV_BYTES_TOTAL} bytes`,
      );
    }
  }
}

async function createScriptSnapshot(
  skill: Skill,
  validatedEntryPath: string,
  entryContent: string,
  budget: SkillOperationBudget,
): Promise<SkillScriptSnapshot> {
  const entryPath = reflectApply(
    stringReplaceAll,
    relative(skill.rootPath, validatedEntryPath),
    ["\\", "/"],
  ) as string;
  const listedPaths = await listStrictSkillTree(
    skill.rootPath,
    SKILL_SCRIPTS_DIR,
    skill.fsAdapter,
    { budget },
  );
  let paths = listedPaths;
  if (!(reflectApply(arrayIncludes, paths, [entryPath]) as boolean)) {
    paths = reflectApply(arraySlice, listedPaths, []) as string[];
    appendOwnArrayElement(paths, entryPath);
    reflectApply(arraySort, paths, [
      (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0,
    ]);
  }
  if (paths.length > SKILL_SCRIPT_SNAPSHOT_MAX_FILES) {
    throw new RangeError(
      `Skill script snapshots may contain at most ${SKILL_SCRIPT_SNAPSHOT_MAX_FILES} files`,
    );
  }

  const files: SkillScriptSnapshotFile[] = [];
  let totalBytes = 0;
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index]!;
    const content = path === entryPath ? entryContent : await readSkillFile(
      skill,
      join(skill.rootPath, path),
      SKILL_SCRIPT_MAX_CONTENT_BYTES,
      budget,
    );
    totalBytes += utf8Encoder.encode(content).byteLength;
    if (totalBytes > SKILL_SCRIPT_SNAPSHOT_MAX_BYTES) {
      throw new RangeError(
        `Skill script snapshots may contain at most ${SKILL_SCRIPT_SNAPSHOT_MAX_BYTES} bytes`,
      );
    }
    appendOwnArrayElement(files, freeze({ path, content }));
  }

  return freeze({ entryPath, files: freeze(files) });
}

function readScriptResultField(
  result: object,
  field: keyof SkillScriptResult,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = getOwnPropertyDescriptor(result, field);
  } catch {
    throw new TypeError("Skill script executor returned an invalid result");
  }
  if (
    !descriptor ||
    !(reflectApply(hasOwnProperty, descriptor, ["value"]) as boolean)
  ) {
    throw new TypeError(
      `Skill script executor result must contain an own data property for "${field}"`,
    );
  }
  return descriptor.value;
}

function snapshotScriptOutput(result: unknown): SkillScriptResult {
  if (
    (typeof result !== "object" && typeof result !== "function") ||
    result === null ||
    isProxyWithoutHooks(result)
  ) {
    throw new TypeError("Skill script executor returned an invalid result");
  }

  const stdout = readScriptResultField(result, "stdout");
  const stderr = readScriptResultField(result, "stderr");
  const exitCode = readScriptResultField(result, "exitCode");
  if (typeof stdout !== "string" || typeof stderr !== "string") {
    throw new TypeError("Skill script executor stdout and stderr must be strings");
  }
  if (typeof exitCode !== "number" || !numberIsSafeInteger(exitCode)) {
    throw new TypeError("Skill script executor exitCode must be a safe integer");
  }

  const bytes = utf8Encoder.encode(stdout).byteLength +
    utf8Encoder.encode(stderr).byteLength;
  if (bytes > SKILL_SCRIPT_MAX_OUTPUT_BYTES) {
    throw new RangeError(
      `Skill script output may contain at most ${SKILL_SCRIPT_MAX_OUTPUT_BYTES} bytes`,
    );
  }

  return freeze({ stdout, stderr, exitCode });
}

/**
 * Resolve a requested skill for the calling agent, enforcing owner scope.
 *
 * Visibility follows the same owner-aware resolver as prompt manifests and
 * selector resolution: unowned skills plus the caller's own (by short name or
 * id). A skill outside the caller's scope behaves exactly like a missing
 * skill, and the not-found error only enumerates skills visible to the
 * caller — never another agent's owned skill ids.
 */
function resolveVisibleSkillOrThrow(
  skillId: string,
  context: ToolExecutionContext | undefined,
  options: SkillSelectorToolOptions = {},
): Skill {
  const scope = { agentId: context?.agentId };
  const allowedSkillIds = getSelectorAllowedSkillIds(context, options);
  const skill = skillRegistryInternal.resolveVisibleSkill(skillId, scope);
  if (skill) {
    assertSkillAllowedBySelector(skill, allowedSkillIds);
    return skill;
  }

  if (allowedSkillIds !== undefined) {
    throw createSkillUnavailableError();
  }

  if (!isUnresolvedSkillSelectorValid(skillId)) {
    const expectation = skillId.includes("--")
      ? "must be provider-safe letters, numbers, underscores, or hyphens, 1-64 characters"
      : "must be lowercase alphanumeric with hyphens, 1-64 characters";
    throw toError(
      createError({
        type: "agent",
        message: `Invalid skill id "${skillId}": ${expectation}`,
      }),
    );
  }

  const visible = skillRegistryInternal.getVisibleSkillIds(scope).join(", ");
  throw toError(
    createError({
      type: "agent",
      message: `Skill "${skillId}" not found. Available skills: ${visible || "none"}`,
    }),
  );
}

function isUnresolvedSkillSelectorValid(skillId: string): boolean {
  if (isValidSkillName(skillId as unknown)) {
    return true;
  }

  return skillId.includes("--") && isValidProviderSafeSkillId(skillId as unknown);
}

function createSkillUnavailableError(): Error {
  return toError(
    createError({
      type: "agent",
      message: "Skill is not available to this agent.",
    }),
  );
}

function getSelectorAllowedSkillIds(
  context: ToolExecutionContext | undefined,
  options: SkillSelectorToolOptions,
): readonly string[] | undefined {
  const resolved = options.resolveAllowedSkillIds?.(context);
  if (resolved !== undefined) return resolved;

  const contextAllowed = context?.allowedSkillIds;
  if (
    Array.isArray(contextAllowed) &&
    contextAllowed.every((entry): entry is string => typeof entry === "string")
  ) {
    return contextAllowed;
  }
  return undefined;
}

function assertSkillAllowedBySelector(
  skill: Skill,
  allowedSkillIds: readonly string[] | undefined,
): void {
  if (allowedSkillIds === undefined || allowedSkillIds.includes(skill.id)) {
    return;
  }

  throw createSkillUnavailableError();
}

function hasRuntimeSkillBoundary(
  context: ToolExecutionContext | undefined,
): context is ToolExecutionContext {
  if (!context) return false;
  return context.activeSkillId !== undefined ||
    context.activeSkillToolAvailability !== undefined;
}

function assertActiveSkillFileAvailable(
  input: {
    toolName: string;
    skillId: string;
    requestedSkillId: string;
    path: string;
    kind: SkillFileKind;
  },
  context: ToolExecutionContext | undefined,
): void {
  if (!hasRuntimeSkillBoundary(context)) return;

  const activeSkillId = context.activeSkillId;
  const availability = context.activeSkillToolAvailability;
  if (!activeSkillId || availability?.hasActiveSkill !== true) {
    throw toError(
      createError({
        type: "agent",
        message: `${input.toolName} requires an active loaded skill.`,
      }),
    );
  }

  if (input.skillId !== activeSkillId) {
    throw toError(
      createError({
        type: "agent",
        message:
          `${input.toolName} can only access the active loaded skill "${activeSkillId}". Requested "${input.requestedSkillId}".`,
      }),
    );
  }

  const advertised = input.kind === "reference"
    ? availability.references ?? []
    : availability.scripts ?? [];
  if (!advertised.includes(input.path)) {
    throw toError(
      createError({
        type: "agent",
        message: `${input.toolName} can only access ${input.kind} files advertised by load_skill.`,
      }),
    );
  }
}

/**
 * Create the load_skill tool.
 * Loads a skill's full instructions, available references, and scripts.
 */
export function createLoadSkillTool(options: SkillSelectorToolOptions = {}): Tool {
  return tool({
    id: "load_skill",
    description: "Load a skill's full instructions. Returns the skill's markdown instructions " +
      `and lists of available reference files and scripts. ${LOAD_SKILL_POLICY_CLAUSES}`,
    inputSchema: getLoadSkillInputSchema(),
    execute: async (input, context): Promise<SkillContent> => {
      const budget = createFileBudget(context);
      const skill = resolveVisibleSkillOrThrow(input.skillId, context, options);

      // Read SKILL.md
      const validatedSkillMdPath = await validateStrictSkillPath(
        skill.rootPath,
        SKILL_MD_FILENAME,
        [],
        skill.fsAdapter,
        { budget },
      );
      const content = await readSkillFile(
        skill,
        validatedSkillMdPath,
        SKILL_TEXT_FILE_MAX_BYTES,
        budget,
      );
      assertDocumentCharacterLimit(content);

      // Parse frontmatter to get instructions
      const parsed = await parseSkillFrontmatter(content);

      // List available files the agent can load through load_skill_reference.
      const references = await listStrictSkillSubdir(
        skill.rootPath,
        SKILL_REFERENCES_DIR,
        skill.fsAdapter,
        { budget },
      );
      const resources = await listStrictSkillSubdir(
        skill.rootPath,
        SKILL_RESOURCES_DIR,
        skill.fsAdapter,
        { budget },
      );
      const assets = await listStrictSkillSubdir(
        skill.rootPath,
        SKILL_ASSETS_DIR,
        skill.fsAdapter,
        { budget },
      );
      const scripts = await listStrictSkillTree(
        skill.rootPath,
        SKILL_SCRIPTS_DIR,
        skill.fsAdapter,
        { budget },
      );
      const loadableReferences = [...references, ...resources, ...assets];

      return {
        skillId: skill.id,
        instructions: parsed.body,
        references: loadableReferences,
        scripts,
      };
    },
  });
}

/**
 * Create the load_skill_reference tool.
 * Reads a reference file from a skill's references/, resources/, or assets/ directory.
 */
export function createLoadSkillReferenceTool(options: SkillSelectorToolOptions = {}): Tool {
  return tool({
    id: "load_skill_reference",
    description: "Read a reference file from a skill. Only files in the skill's " +
      "references/, resources/, and assets/ directories are accessible.",
    inputSchema: getLoadSkillReferenceInputSchema(),
    execute: async (input, context): Promise<{ content: string; path: string }> => {
      const budget = createFileBudget(context);
      const skill = resolveVisibleSkillOrThrow(input.skillId, context, options);
      assertActiveSkillFileAvailable(
        {
          toolName: "load_skill_reference",
          skillId: skill.id,
          requestedSkillId: input.skillId,
          path: input.reference,
          kind: "reference",
        },
        context,
      );

      // Validate path safety before reading skill-provided context.
      const validatedPath = await validateStrictSkillPath(
        skill.rootPath,
        input.reference,
        [SKILL_REFERENCES_DIR, SKILL_RESOURCES_DIR, SKILL_ASSETS_DIR],
        skill.fsAdapter,
        { budget },
      );

      const content = await readSkillFile(
        skill,
        validatedPath,
        SKILL_TEXT_FILE_MAX_BYTES,
        budget,
      );
      return { content, path: input.reference };
    },
  });
}

/**
 * Create the execute_skill_script tool.
 * Executes a script from a skill's scripts/ directory.
 */
export function createExecuteSkillScriptTool(
  options: { executor?: SkillScriptExecutor } & SkillSelectorToolOptions = {},
): Tool {
  return tool({
    id: "execute_skill_script",
    description:
      "Execute a script from a skill's scripts/ directory. Returns stdout, stderr, and exit code.",
    inputSchema: getExecuteSkillScriptInputSchema(),
    execute: async (input, context) => {
      const budget = createFileBudget(context, input.timeoutMs);
      assertScriptInputs(input.args, input.env);
      const skill = resolveVisibleSkillOrThrow(input.skillId, context, options);
      assertActiveSkillFileAvailable(
        {
          toolName: "execute_skill_script",
          skillId: skill.id,
          requestedSkillId: input.skillId,
          path: input.script,
          kind: "script",
        },
        context,
      );

      // Validate path safety (only scripts/ allowed)
      const validatedPath = await validateStrictSkillPath(
        skill.rootPath,
        input.script,
        [SKILL_SCRIPTS_DIR],
        skill.fsAdapter,
        { budget },
      );

      const scriptContent = await readSkillFile(
        skill,
        validatedPath,
        SKILL_SCRIPT_MAX_CONTENT_BYTES,
        budget,
      );
      const scriptSnapshot = await createScriptSnapshot(
        skill,
        validatedPath,
        scriptContent,
        budget,
      );
      const executor = options.executor ?? getSkillScriptExecutor();
      const result = await budget.run(async (abortSignal) =>
        await executor.execute({
          scriptPath: validatedPath,
          scriptContent,
          scriptSnapshot,
          args: input.args,
          env: input.env,
          validatedSourceRoot: skill.fsAdapter === undefined ? skill.rootPath : undefined,
          timeoutMs: budget.remainingMs(),
          abortSignal,
        })
      );
      return snapshotScriptOutput(result);
    },
  });
}
