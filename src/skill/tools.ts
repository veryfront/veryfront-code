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
import { readTextFile } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { skillRegistry } from "./registry.ts";
import { parseSkillFrontmatter } from "./parser.ts";
import { listSkillSubdir, validateSkillPath } from "./path-safety.ts";
import { getSkillScriptExecutor } from "./executor.ts";
import type { Skill, SkillContent } from "./types.ts";
import {
  SKILL_ASSETS_DIR,
  SKILL_MD_FILENAME,
  SKILL_REFERENCES_DIR,
  SKILL_RESOURCES_DIR,
  SKILL_SCRIPTS_DIR,
} from "./types.ts";

/** Maximum allowed script execution timeout in milliseconds (5 minutes) */
const MAX_SCRIPT_TIMEOUT_MS = 300_000;

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
async function readSkillFile(skill: Skill, path: string): Promise<string> {
  if (skill.fsAdapter) {
    return await skill.fsAdapter.readFile(path);
  }
  return await readTextFile(path);
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
): Skill {
  const scope = { agentId: context?.agentId };
  const skill = skillRegistry.resolveVisibleSkill(skillId, scope);
  if (!skill) {
    const visible = skillRegistry.getVisibleSkillIds(scope).join(", ");
    throw toError(
      createError({
        type: "agent",
        message: `Skill "${skillId}" not found. Available skills: ${visible || "none"}`,
      }),
    );
  }
  return skill;
}

function buildSkillAvailabilityNote(references: string[], scripts: string[]): string | undefined {
  if (scripts.length === 0 && references.length === 0) {
    return "This skill has no scripts or reference files. Do NOT call execute_skill_script or load_skill_reference.";
  }
  if (scripts.length === 0) {
    return "This skill has no scripts. Do NOT call execute_skill_script.";
  }
  if (references.length === 0) {
    return "This skill has no reference files. Do NOT call load_skill_reference.";
  }
  return undefined;
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
      const skill = resolveVisibleSkillOrThrow(input.skillId, context);

      // Read SKILL.md
      const skillMdPath = join(skill.rootPath, SKILL_MD_FILENAME);
      const content = await readSkillFile(skill, skillMdPath);

      // Parse frontmatter to get instructions
      const parsed = await parseSkillFrontmatter(content);

      // List available files the agent can load through load_skill_reference.
      const [references, resources, scripts] = await Promise.all([
        listSkillSubdir(
          skill.rootPath,
          SKILL_REFERENCES_DIR,
          skill.fsAdapter,
        ),
        listSkillSubdir(
          skill.rootPath,
          SKILL_RESOURCES_DIR,
          skill.fsAdapter,
        ),
        listSkillSubdir(
          skill.rootPath,
          SKILL_SCRIPTS_DIR,
          skill.fsAdapter,
        ),
      ]);
      const loadableReferences = [...references, ...resources];
      const note = buildSkillAvailabilityNote(loadableReferences, scripts);

      return {
        instructions: parsed.body,
        allowedTools: skill.metadata.allowedTools,
        references: loadableReferences,
        scripts,
        ...(note ? { note } : {}),
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
    description: "Read a reference file from a skill. Only files in the skill's " +
      "references/, resources/, and assets/ directories are accessible.",
    inputSchema: getLoadSkillReferenceInputSchema(),
    execute: async (input, context): Promise<{ content: string; path: string }> => {
      const skill = resolveVisibleSkillOrThrow(input.skillId, context);

      // Validate path safety before reading skill-provided context.
      const validatedPath = await validateSkillPath(
        skill.rootPath,
        input.reference,
        [SKILL_REFERENCES_DIR, SKILL_RESOURCES_DIR, SKILL_ASSETS_DIR],
        skill.fsAdapter,
      );

      const content = await readSkillFile(skill, validatedPath);
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
      const skill = resolveVisibleSkillOrThrow(input.skillId, context);

      // Validate path safety (only scripts/ allowed)
      const validatedPath = await validateSkillPath(
        skill.rootPath,
        input.script,
        [SKILL_SCRIPTS_DIR],
        skill.fsAdapter,
      );

      const scriptContent = await readSkillFile(skill, validatedPath);
      const executor = getSkillScriptExecutor();
      return await executor.execute({
        scriptPath: validatedPath,
        scriptContent,
        args: input.args,
        env: input.env,
        cwd: skill.rootPath,
        timeoutMs: input.timeoutMs,
      });
    },
  });
}
