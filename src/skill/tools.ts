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
import { tool } from "#veryfront/tool/factory.ts";
import type { Tool, ToolExecutionContext } from "#veryfront/tool";
import { readFile, stat } from "#veryfront/platform/compat/fs.ts";
import { createError, toError } from "#veryfront/errors";
import { skillRegistry } from "./registry.ts";
import { parseSkillFrontmatter, validateSkillMetadata } from "./parser.ts";
import { listSkillSubdir, validateSkillDefinitionPath, validateSkillPath } from "./path-safety.ts";
import { getIsolatedSkillScriptExecutor, getSkillScriptExecutor } from "./executor.ts";
import type { Skill, SkillContent } from "./types.ts";
import {
  SKILL_ASSETS_DIR,
  SKILL_DEFINITION_MAX_BYTES,
  SKILL_REFERENCES_DIR,
  SKILL_RESOURCES_DIR,
  SKILL_SCRIPTS_DIR,
} from "./types.ts";

/** Maximum allowed script execution timeout in milliseconds (5 minutes) */
const MAX_SCRIPT_TIMEOUT_MS = 300_000;
const MAX_SKILL_ID_LENGTH = 256;
const MAX_SKILL_PATH_LENGTH = 4_096;
const MAX_REFERENCE_FILE_BYTES = 4 * 1_048_576;
const MAX_SCRIPT_FILE_BYTES = 4 * 1_048_576;
const MAX_SCRIPT_ARGUMENTS = 128;
const MAX_SCRIPT_ARGUMENT_LENGTH = 16_384;
const MAX_SCRIPT_ENV_ENTRIES = 128;
const MAX_SCRIPT_ENV_KEY_LENGTH = 256;
const MAX_SCRIPT_ENV_VALUE_LENGTH = 65_536;
const MAX_SCRIPT_ENV_TOTAL_LENGTH = 1_048_576;
const MAX_AVAILABLE_SKILLS_IN_ERROR = 20;
const SCRIPT_ENV_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

type SkillFileKind = "reference" | "script";

const getLoadSkillInputSchema = defineSchema((v) =>
  v.object({
    skillId: v.string().min(1).max(MAX_SKILL_ID_LENGTH).describe("The ID of the skill to load"),
  })
);

const getLoadSkillReferenceInputSchema = defineSchema((v) =>
  v.object({
    skillId: v.string().min(1).max(MAX_SKILL_ID_LENGTH).describe("The ID of the skill"),
    reference: v.string().min(1).max(MAX_SKILL_PATH_LENGTH).describe(
      "Relative path to the reference file (e.g. 'references/CLAUSES.md')",
    ),
  })
);

const getExecuteSkillScriptInputSchema = defineSchema((v) =>
  v.object({
    skillId: v.string().min(1).max(MAX_SKILL_ID_LENGTH).describe("The ID of the skill"),
    script: v.string().min(1).max(MAX_SKILL_PATH_LENGTH).describe(
      "Relative path to the script (e.g. 'scripts/setup.sh')",
    ),
    args: v.array(v.string().max(MAX_SCRIPT_ARGUMENT_LENGTH)).max(MAX_SCRIPT_ARGUMENTS).optional()
      .describe("Arguments to pass to the script"),
    env: v.record(
      v.string().min(1).max(MAX_SCRIPT_ENV_KEY_LENGTH),
      v.string().max(MAX_SCRIPT_ENV_VALUE_LENGTH),
    ).optional().describe(
      "Environment variables for the script",
    ),
    timeoutMs: v
      .number()
      .int()
      .positive()
      .max(MAX_SCRIPT_TIMEOUT_MS)
      .optional()
      .describe(`Optional lifecycle timeout in milliseconds (max ${MAX_SCRIPT_TIMEOUT_MS})`),
  })
);

/**
 * Read a file from a skill directory.
 * Uses binary-safe reads when available, then decodes strict UTF-8 text.
 */
async function readSkillFile(
  skill: Skill,
  path: string,
  options: { label: string; maxBytes: number; signal?: AbortSignal },
): Promise<string> {
  throwIfExecutionAborted({ abortSignal: options.signal });
  let size: unknown;
  try {
    const info = skill.fsAdapter ? await skill.fsAdapter.stat(path) : await stat(path);
    size = info.size;
  } catch {
    throwIfExecutionAborted({ abortSignal: options.signal });
    throw toError(
      createError({ type: "agent", message: `Unable to inspect the skill ${options.label}.` }),
    );
  }
  if (
    typeof size !== "number" || !Number.isSafeInteger(size) || size < 0 ||
    size > options.maxBytes
  ) {
    throw toError(
      createError({
        type: "agent",
        message: `Skill ${options.label} exceeds the supported size limit.`,
      }),
    );
  }

  let fileValue: unknown;
  try {
    fileValue = skill.fsAdapter
      ? skill.fsAdapter.readFileBytes
        ? await skill.fsAdapter.readFileBytes(path)
        : await skill.fsAdapter.readFile(path)
      : await readFile(path);
  } catch {
    throwIfExecutionAborted({ abortSignal: options.signal });
    throw toError(
      createError({ type: "agent", message: `Unable to read the skill ${options.label}.` }),
    );
  }
  throwIfExecutionAborted({ abortSignal: options.signal });

  let content: string;
  let byteLength: number;
  try {
    if (fileValue instanceof Uint8Array) {
      const bytes = new Uint8Array(fileValue);
      byteLength = bytes.byteLength;
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } else if (typeof fileValue === "string") {
      content = fileValue;
      byteLength = new TextEncoder().encode(content).byteLength;
    } else {
      throw new TypeError("Skill file adapter returned an unsupported value");
    }
  } catch {
    throw toError(
      createError({
        type: "agent",
        message: `Skill ${options.label} must contain valid UTF-8 text without NUL bytes.`,
      }),
    );
  }

  if (content.includes("\0")) {
    throw toError(
      createError({
        type: "agent",
        message: `Skill ${options.label} must contain valid UTF-8 text without NUL bytes.`,
      }),
    );
  }
  if (content.length > options.maxBytes || byteLength > options.maxBytes) {
    throw toError(
      createError({
        type: "agent",
        message: `Skill ${options.label} exceeds the supported size limit.`,
      }),
    );
  }
  return content;
}

function validateScriptCollections(input: {
  args?: unknown;
  env?: unknown;
}): void {
  if (input.args !== undefined) {
    let isArray = false;
    try {
      isArray = Array.isArray(input.args);
    } catch {
      // The stable validation error below covers unreadable proxy inputs.
    }
    if (!isArray || (input.args as unknown[]).length > MAX_SCRIPT_ARGUMENTS) {
      throw toError(
        createError({ type: "agent", message: "Skill script arguments are invalid." }),
      );
    }
    const args = input.args as unknown[];
    for (let index = 0; index < args.length; index += 1) {
      if (!Object.hasOwn(args, index)) {
        throw toError(
          createError({ type: "agent", message: "Skill script arguments must be dense." }),
        );
      }
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Reflect.getOwnPropertyDescriptor(args, String(index));
      } catch {
        // The stable validation error below covers unreadable proxy inputs.
      }
      if (
        !descriptor || !("value" in descriptor) || typeof descriptor.value !== "string" ||
        descriptor.value.length > MAX_SCRIPT_ARGUMENT_LENGTH || descriptor.value.includes("\0")
      ) {
        throw toError(
          createError({ type: "agent", message: "Skill script contains an invalid argument." }),
        );
      }
    }
  }
  if (input.env === undefined) return;
  if (typeof input.env !== "object" || input.env === null || Array.isArray(input.env)) {
    throw toError(
      createError({ type: "agent", message: "Skill script environment is invalid." }),
    );
  }
  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(input.env);
  } catch {
    throw toError(
      createError({ type: "agent", message: "Skill script environment is unreadable." }),
    );
  }
  if (keys.length > MAX_SCRIPT_ENV_ENTRIES) {
    throw toError(
      createError({ type: "agent", message: "Skill script has too many environment variables." }),
    );
  }
  let totalLength = 0;
  for (const key of keys) {
    if (typeof key !== "string" || !SCRIPT_ENV_KEY_REGEX.test(key)) {
      throw toError(
        createError({
          type: "agent",
          message: "Skill script environment contains an invalid key.",
        }),
      );
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(input.env, key);
    } catch {
      // The stable validation error below covers unreadable proxy inputs.
    }
    if (
      !descriptor || !("value" in descriptor) || typeof descriptor.value !== "string" ||
      descriptor.value.length > MAX_SCRIPT_ENV_VALUE_LENGTH || descriptor.value.includes("\0")
    ) {
      throw toError(
        createError({
          type: "agent",
          message: "Skill script environment must contain bounded string values.",
        }),
      );
    }
    const value = descriptor.value;
    totalLength += key.length + value.length;
    if (totalLength > MAX_SCRIPT_ENV_TOTAL_LENGTH) {
      throw toError(
        createError({ type: "agent", message: "Skill script environment is too large." }),
      );
    }
  }
}

function sanitizeIdentifier(value: string): string {
  let result = "";
  for (let index = 0; index < value.length && result.length < 128; index += 1) {
    const code = value.charCodeAt(index);
    result += code <= 31 || code === 127 ? "?" : value[index];
  }
  return result;
}

/**
 * Resolve a requested skill for the calling agent, enforcing owner scope.
 *
 * Visibility follows the same owner-aware resolver as prompt manifests and
 * selector resolution: unowned skills plus the caller's own (by short name or
 * id). A skill outside the caller's scope behaves exactly like a missing
 * skill, and the not-found error only enumerates skills visible to the
 * caller, never another agent's owned skill ids.
 */
function resolveVisibleSkillOrThrow(
  skillId: string,
  context: ToolExecutionContext | undefined,
): Skill {
  const scope = { agentId: context?.agentId };
  const skill = skillRegistry.resolveVisibleSkill(skillId, scope);
  if (!skill) {
    const visibleIds = skillRegistry.getVisibleSkillIds(scope);
    const visible = visibleIds.slice(0, MAX_AVAILABLE_SKILLS_IN_ERROR).map(sanitizeIdentifier)
      .join(", ");
    const omitted = Math.max(0, visibleIds.length - MAX_AVAILABLE_SKILLS_IN_ERROR);
    throw toError(
      createError({
        type: "agent",
        message: `Skill "${sanitizeIdentifier(skillId)}" not found. Available skills: ${
          visible || "none"
        }${omitted > 0 ? ` (${omitted} more omitted)` : ""}`,
      }),
    );
  }
  return skill;
}

function hasRuntimeSkillBoundary(
  context: ToolExecutionContext | undefined,
): context is ToolExecutionContext {
  if (!context) return false;
  return context.activeSkillId !== undefined ||
    context.activeSkillToolAvailability !== undefined;
}

function throwIfExecutionAborted(context: ToolExecutionContext | undefined): void {
  context?.abortSignal?.throwIfAborted();
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
        message: `${input.toolName} can only access the active loaded skill "${
          sanitizeIdentifier(activeSkillId)
        }". Requested "${sanitizeIdentifier(input.requestedSkillId)}".`,
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
export function createLoadSkillTool(): Tool {
  return tool({
    id: "load_skill",
    description: "Load a skill's full instructions. Returns the skill's markdown instructions, " +
      "allowed tools policy, and lists of available reference files and scripts.",
    inputSchema: getLoadSkillInputSchema(),
    execute: async (input, context): Promise<SkillContent> => {
      throwIfExecutionAborted(context);
      const skill = resolveVisibleSkillOrThrow(input.skillId, context);

      // Read SKILL.md
      const skillMdPath = await validateSkillDefinitionPath(
        skill.rootPath,
        skill.fsAdapter,
        context?.abortSignal,
      );
      const content = await readSkillFile(skill, skillMdPath, {
        label: "definition",
        maxBytes: SKILL_DEFINITION_MAX_BYTES,
        signal: context?.abortSignal,
      });

      // Parse frontmatter to get instructions
      const parsed = await parseSkillFrontmatter(content);
      const metadata = validateSkillMetadata(parsed.frontmatter, skill.metadata.name);
      throwIfExecutionAborted(context);

      // List available files the agent can load through load_skill_reference.
      const [references, resources, assets, scripts] = await Promise.all([
        listSkillSubdir(
          skill.rootPath,
          SKILL_REFERENCES_DIR,
          skill.fsAdapter,
          context?.abortSignal,
        ),
        listSkillSubdir(
          skill.rootPath,
          SKILL_RESOURCES_DIR,
          skill.fsAdapter,
          context?.abortSignal,
        ),
        listSkillSubdir(
          skill.rootPath,
          SKILL_ASSETS_DIR,
          skill.fsAdapter,
          context?.abortSignal,
        ),
        listSkillSubdir(
          skill.rootPath,
          SKILL_SCRIPTS_DIR,
          skill.fsAdapter,
          context?.abortSignal,
        ),
      ]);
      throwIfExecutionAborted(context);
      const loadableReferences = [...references, ...resources, ...assets];

      return {
        skillId: skill.id,
        instructions: parsed.body,
        allowedTools: metadata.allowedTools === undefined ? undefined : [...metadata.allowedTools],
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
export function createLoadSkillReferenceTool(): Tool {
  return tool({
    id: "load_skill_reference",
    description: "Read a UTF-8 text file from a skill. Only files in the skill's " +
      "references/, resources/, and assets/ directories are accessible. Binary files are rejected.",
    inputSchema: getLoadSkillReferenceInputSchema(),
    execute: async (input, context): Promise<{ content: string; path: string }> => {
      throwIfExecutionAborted(context);
      const skill = resolveVisibleSkillOrThrow(input.skillId, context);
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
      const validatedPath = await validateSkillPath(
        skill.rootPath,
        input.reference,
        [SKILL_REFERENCES_DIR, SKILL_RESOURCES_DIR, SKILL_ASSETS_DIR],
        skill.fsAdapter,
        context?.abortSignal,
      );

      const content = await readSkillFile(skill, validatedPath, {
        label: "reference",
        maxBytes: MAX_REFERENCE_FILE_BYTES,
        signal: context?.abortSignal,
      });
      return { content, path: input.reference };
    },
  });
}

/**
 * Create the execute_skill_script tool.
 * Executes a script from a skill's scripts/ directory.
 */
export function createExecuteSkillScriptTool(): Tool {
  return tool({
    id: "execute_skill_script",
    description:
      "Execute a script from a skill's scripts/ directory. Returns stdout, stderr, and exit code.",
    inputSchema: getExecuteSkillScriptInputSchema(),
    execute: async (input, context) => {
      throwIfExecutionAborted(context);
      validateScriptCollections(input);
      const skill = resolveVisibleSkillOrThrow(input.skillId, context);
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
      const validatedPath = await validateSkillPath(
        skill.rootPath,
        input.script,
        [SKILL_SCRIPTS_DIR],
        skill.fsAdapter,
        context?.abortSignal,
      );

      const scriptContent = await readSkillFile(skill, validatedPath, {
        label: "script",
        maxBytes: MAX_SCRIPT_FILE_BYTES,
        signal: context?.abortSignal,
      });
      throwIfExecutionAborted(context);
      const executor = skill.fsAdapter
        ? getIsolatedSkillScriptExecutor(context?.authToken)
        : getSkillScriptExecutor();
      const result = await executor.execute({
        scriptPath: validatedPath,
        scriptContent,
        args: input.args,
        env: input.env,
        cwd: skill.rootPath,
        timeoutMs: input.timeoutMs,
        abortSignal: context?.abortSignal,
      });
      throwIfExecutionAborted(context);
      return result;
    },
  });
}
