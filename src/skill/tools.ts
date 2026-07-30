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
import { basename } from "#veryfront/compat/path";
import { createError, toError } from "#veryfront/errors";
import { skillRegistryInternal } from "./registry.ts";
import { parseSkillFileFrontmatter, validateSkillFileMetadata } from "./parser.ts";
import { listStrictSkillSubdir } from "./path-safety.ts";
import { getSkillScriptExecutor } from "./executor.ts";
import type { Skill, SkillContent, SkillScriptExecutor } from "./types.ts";
import {
  SKILL_ASSETS_DIR,
  SKILL_MD_FILENAME,
  SKILL_NAME_REGEX,
  SKILL_PROVIDER_SAFE_ID_REGEX,
  SKILL_READABLE_DIRS,
  SKILL_REFERENCES_DIR,
  SKILL_RESOURCES_DIR,
  SKILL_SCRIPTS_DIR,
} from "./types.ts";
import {
  SKILL_ID_MAX_LENGTH,
  SKILL_RELATIVE_PATH_MAX_LENGTH,
  SKILL_SCRIPT_DEFAULT_TIMEOUT_MS,
  SKILL_SCRIPT_ENV_KEY_REGEX,
  SKILL_SCRIPT_MAX_ARG_BYTES_TOTAL,
  SKILL_SCRIPT_MAX_ARG_LENGTH,
  SKILL_SCRIPT_MAX_ARGS,
  SKILL_SCRIPT_MAX_ENV_BYTES_TOTAL,
  SKILL_SCRIPT_MAX_ENV_ENTRIES,
  SKILL_SCRIPT_MAX_ENV_KEY_LENGTH,
  SKILL_SCRIPT_MAX_ENV_VALUE_LENGTH,
  SKILL_SCRIPT_MAX_TIMEOUT_MS,
  SKILL_TEXT_FILE_MAX_BYTES,
  SKILL_VISIBLE_ERROR_MAX_IDS,
} from "./limits.ts";
import { readValidatedSkillTextFile } from "./bounded-text-file.ts";
import { createSkillOperationBudget, SkillOperationTimeoutError } from "./operation-budget.ts";
import { sanitizeSkillBoundaryFailure } from "./error-boundary.ts";

type SkillFileKind = "reference" | "script";
type SkillSelectorToolOptions = {
  resolveAllowedSkillIds?: (context: ToolExecutionContext | undefined) => readonly string[];
};

const UTF8_ENCODER = new TextEncoder();

function sanitizeSkillToolFailure(
  error: unknown,
  skillRoot: string | undefined,
  context?: ToolExecutionContext,
): unknown {
  if (
    context?.abortSignal?.aborted &&
    context.abortSignal.reason !== undefined &&
    error === context.abortSignal.reason
  ) {
    return error;
  }
  return sanitizeSkillBoundaryFailure(error, skillRoot ?? "");
}

function scriptArgsFitByteBudget(value: readonly string[] | undefined): boolean {
  if (value === undefined) return true;
  let totalBytes = 0;
  for (const arg of value) {
    totalBytes += UTF8_ENCODER.encode(arg).byteLength;
    if (totalBytes > SKILL_SCRIPT_MAX_ARG_BYTES_TOTAL) return false;
  }
  return true;
}

function scriptEnvFitsByteBudget(value: Record<string, string> | undefined): boolean {
  if (value === undefined) return true;
  let totalBytes = 0;
  for (const [key, envValue] of Object.entries(value)) {
    totalBytes += UTF8_ENCODER.encode(`${key}=${envValue}\0`).byteLength;
    if (totalBytes > SKILL_SCRIPT_MAX_ENV_BYTES_TOTAL) return false;
  }
  return true;
}

const getLoadSkillInputSchema = defineSchema((v) =>
  v.object({
    skillId: v.string().min(1).max(SKILL_ID_MAX_LENGTH).describe(
      "The ID of the skill to load",
    ),
  })
);

const getLoadSkillReferenceInputSchema = defineSchema((v) =>
  v.object({
    skillId: v.string().min(1).max(SKILL_ID_MAX_LENGTH).describe("The ID of the skill"),
    reference: v.string().min(1).max(SKILL_RELATIVE_PATH_MAX_LENGTH).describe(
      "Relative path to the reference file (e.g. 'references/CLAUSES.md')",
    ),
  })
);

const getExecuteSkillScriptInputSchema = defineSchema((v) =>
  v.object({
    skillId: v.string().min(1).max(SKILL_ID_MAX_LENGTH).describe("The ID of the skill"),
    script: v.string().min(1).max(SKILL_RELATIVE_PATH_MAX_LENGTH).describe(
      "Relative path to the script (e.g. 'scripts/setup.sh')",
    ),
    args: v
      .array(v.string().max(SKILL_SCRIPT_MAX_ARG_LENGTH))
      .max(SKILL_SCRIPT_MAX_ARGS)
      .optional()
      .refine(scriptArgsFitByteBudget, {
        message: `Arguments must total at most ${SKILL_SCRIPT_MAX_ARG_BYTES_TOTAL} bytes`,
      })
      .describe("Arguments to pass to the script"),
    env: v
      .record(
        v.string().min(1).max(SKILL_SCRIPT_MAX_ENV_KEY_LENGTH).regex(
          SKILL_SCRIPT_ENV_KEY_REGEX,
          "Environment variable names must contain only letters, digits, and underscores and must not start with a digit",
        ),
        v.string().max(SKILL_SCRIPT_MAX_ENV_VALUE_LENGTH),
      )
      .optional()
      .refine(
        (value) =>
          value === undefined ||
          Object.keys(value).length <= SKILL_SCRIPT_MAX_ENV_ENTRIES,
        { message: `Environment accepts at most ${SKILL_SCRIPT_MAX_ENV_ENTRIES} entries` },
      )
      .refine(scriptEnvFitsByteBudget, {
        message: `Environment must total at most ${SKILL_SCRIPT_MAX_ENV_BYTES_TOTAL} bytes`,
      })
      .describe("Environment variables for the script"),
    timeoutMs: v
      .number()
      .int()
      .positive()
      .max(SKILL_SCRIPT_MAX_TIMEOUT_MS)
      .optional()
      .describe(
        `Optional execution timeout in milliseconds (max ${SKILL_SCRIPT_MAX_TIMEOUT_MS})`,
      ),
  })
);

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

  // Once a selector boundary is present, all misses use one generic error so
  // neither configured nor merely visible skill ids leak through diagnostics.
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

  const visibleIds = skillRegistryInternal.getVisibleSkillIds(scope)
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const visible = visibleIds.slice(0, SKILL_VISIBLE_ERROR_MAX_IDS).join(", ");
  const omitted = Math.max(0, visibleIds.length - SKILL_VISIBLE_ERROR_MAX_IDS);
  throw toError(
    createError({
      type: "agent",
      message: `Skill "${skillId}" not found. Available skills: ${visible || "none"}${
        omitted > 0 ? ` (${omitted} more omitted)` : ""
      }`,
    }),
  );
}

function isUnresolvedSkillSelectorValid(skillId: string): boolean {
  if (SKILL_NAME_REGEX.test(skillId)) {
    return true;
  }

  return skillId.includes("--") && SKILL_PROVIDER_SAFE_ID_REGEX.test(skillId);
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
  if (resolved !== undefined) {
    return Array.isArray(resolved) && resolved.every((entry) => typeof entry === "string")
      ? resolved
      : [];
  }

  const contextAllowed = context?.allowedSkillIds;
  if (contextAllowed === undefined) return undefined;
  return Array.isArray(contextAllowed) &&
      contextAllowed.every((entry): entry is string => typeof entry === "string")
    ? contextAllowed
    : [];
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
    description: "Load a skill's full instructions. Returns the skill's markdown instructions, " +
      "allowed tools policy, and lists of available reference files and scripts.",
    inputSchema: getLoadSkillInputSchema(),
    execute: async (input, context): Promise<SkillContent> => {
      const budget = createSkillOperationBudget({ abortSignal: context?.abortSignal });
      let skillRoot: string | undefined;
      try {
        return await budget.run(async () => {
          const skill = resolveVisibleSkillOrThrow(input.skillId, context, options);
          skillRoot = skill.rootPath;

          // Read SKILL.md
          const skillDocument = await readValidatedSkillTextFile(
            skill.rootPath,
            SKILL_MD_FILENAME,
            [],
            skill.fsAdapter,
            SKILL_TEXT_FILE_MAX_BYTES,
            { budget },
          );

          // Parse frontmatter to get instructions
          const parsed = await parseSkillFileFrontmatter(skillDocument.content);
          const currentMetadata = validateSkillFileMetadata(
            parsed.frontmatter,
            basename(skill.rootPath),
            { providerSafeName: skill.ownerAgentId !== undefined },
          );

          // List available files the agent can load through load_skill_reference.
          const [references, resources, assets, scripts] = await Promise.all([
            listStrictSkillSubdir(
              skill.rootPath,
              SKILL_REFERENCES_DIR,
              skill.fsAdapter,
              { budget },
            ),
            listStrictSkillSubdir(
              skill.rootPath,
              SKILL_RESOURCES_DIR,
              skill.fsAdapter,
              { budget },
            ),
            listStrictSkillSubdir(
              skill.rootPath,
              SKILL_ASSETS_DIR,
              skill.fsAdapter,
              { budget },
            ),
            listStrictSkillSubdir(
              skill.rootPath,
              SKILL_SCRIPTS_DIR,
              skill.fsAdapter,
              { budget },
            ),
          ]);
          const loadableReferences = [...references, ...resources, ...assets];

          return {
            skillId: skill.id,
            instructions: parsed.body,
            allowedTools: currentMetadata.allowedTools,
            references: loadableReferences,
            scripts,
          };
        });
      } catch (error) {
        throw sanitizeSkillToolFailure(error, skillRoot, context);
      }
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
      const budget = createSkillOperationBudget({ abortSignal: context?.abortSignal });
      let skillRoot: string | undefined;
      try {
        return await budget.run(async () => {
          const skill = resolveVisibleSkillOrThrow(input.skillId, context, options);
          skillRoot = skill.rootPath;
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
          const referenceFile = await readValidatedSkillTextFile(
            skill.rootPath,
            input.reference,
            SKILL_READABLE_DIRS,
            skill.fsAdapter,
            SKILL_TEXT_FILE_MAX_BYTES,
            { budget },
          );

          return { content: referenceFile.content, path: input.reference };
        });
      } catch (error) {
        throw sanitizeSkillToolFailure(error, skillRoot, context);
      }
    },
  });
}

function timedOutScriptResult(timeoutMs: number) {
  return {
    stdout: "",
    stderr: `Script execution timed out after ${timeoutMs}ms`,
    exitCode: 124,
  };
}

function abortedScriptResult() {
  return {
    stdout: "",
    stderr: "Script execution aborted",
    exitCode: 130,
  };
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
      const timeoutMs = input.timeoutMs ?? SKILL_SCRIPT_DEFAULT_TIMEOUT_MS;
      let skillRoot: string | undefined;
      const budget = createSkillOperationBudget({
        abortSignal: context?.abortSignal,
        timeoutMs,
      });
      try {
        return await budget.run(async () => {
          const skill = resolveVisibleSkillOrThrow(input.skillId, context, options);
          skillRoot = skill.rootPath;
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
          const scriptFile = await readValidatedSkillTextFile(
            skill.rootPath,
            input.script,
            [SKILL_SCRIPTS_DIR],
            skill.fsAdapter,
            SKILL_TEXT_FILE_MAX_BYTES,
            { budget },
          );
          budget.throwIfTerminated();

          const executor = options.executor ?? getSkillScriptExecutor();
          return await executor.execute({
            scriptPath: scriptFile.path,
            scriptContent: scriptFile.content,
            args: input.args,
            env: input.env,
            cwd: skill.rootPath,
            validatedSourceRoot: skill.rootPath,
            timeoutMs: budget.remainingMs() ?? timeoutMs,
            abortSignal: context?.abortSignal,
          });
        });
      } catch (error) {
        if (context?.abortSignal?.aborted) {
          return abortedScriptResult();
        }
        const failure = sanitizeSkillToolFailure(error, skillRoot, context);
        if (failure instanceof SkillOperationTimeoutError) {
          return timedOutScriptResult(timeoutMs);
        }
        throw failure;
      }
    },
  });
}
