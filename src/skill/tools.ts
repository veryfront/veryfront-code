/**
 * Skill Tools
 *
 * Three tools exposed to agents for interacting with skills:
 * - load-skill: Load a skill's full instructions
 * - load-skill-reference: Read a reference file from a skill
 * - execute-skill-script: Execute a script from a skill
 *
 * @module
 */

import { z } from "zod";
import { tool } from "#veryfront/tool/factory.ts";
import type { Tool } from "#veryfront/tool";
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
  SKILL_SCRIPTS_DIR,
} from "./types.ts";

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
 * Create the load-skill tool.
 * Loads a skill's full instructions, available references, and scripts.
 */
export function createLoadSkillTool(): Tool {
  return tool({
    id: "load-skill",
    description: "Load a skill's full instructions. Returns the skill's markdown instructions, " +
      "allowed tools policy, and lists of available reference files and scripts.",
    inputSchema: z.object({
      skillId: z.string().describe("The ID of the skill to load"),
    }),
    execute: async (input): Promise<SkillContent> => {
      const skill = skillRegistry.get(input.skillId);
      if (!skill) {
        const available = skillRegistry.getAllIds().join(", ");
        throw toError(
          createError({
            type: "agent",
            message: `Skill "${input.skillId}" not found. Available skills: ${available || "none"}`,
          }),
        );
      }

      // Read SKILL.md
      const skillMdPath = join(skill.rootPath, SKILL_MD_FILENAME);
      const content = await readSkillFile(skill, skillMdPath);

      // Parse frontmatter to get instructions
      const parsed = await parseSkillFrontmatter(content);

      // List available references and scripts
      const references = await listSkillSubdir(
        skill.rootPath,
        SKILL_REFERENCES_DIR,
        skill.fsAdapter,
      );
      const scripts = await listSkillSubdir(
        skill.rootPath,
        SKILL_SCRIPTS_DIR,
        skill.fsAdapter,
      );

      return {
        instructions: parsed.body,
        allowedTools: skill.metadata.allowedTools,
        references,
        scripts,
        ...(scripts.length === 0 && references.length === 0
          ? {
            note:
              "This skill has no scripts or reference files. Do NOT call execute-skill-script or load-skill-reference.",
          }
          : scripts.length === 0
          ? { note: "This skill has no scripts. Do NOT call execute-skill-script." }
          : references.length === 0
          ? { note: "This skill has no reference files. Do NOT call load-skill-reference." }
          : {}),
      };
    },
  });
}

/**
 * Create the load-skill-reference tool.
 * Reads a reference file from a skill's references/ or assets/ directory.
 */
export function createLoadSkillReferenceTool(): Tool {
  return tool({
    id: "load-skill-reference",
    description: "Read a reference file from a skill. Only files in the skill's " +
      "references/ and assets/ directories are accessible.",
    inputSchema: z.object({
      skillId: z.string().describe("The ID of the skill"),
      reference: z.string().describe(
        "Relative path to the reference file (e.g. 'references/CLAUSES.md')",
      ),
    }),
    execute: async (input): Promise<{ content: string; path: string }> => {
      const skill = skillRegistry.get(input.skillId);
      if (!skill) {
        throw toError(
          createError({
            type: "agent",
            message: `Skill "${input.skillId}" not found`,
          }),
        );
      }

      // Validate path safety (only references/ and assets/ allowed)
      const validatedPath = await validateSkillPath(
        skill.rootPath,
        input.reference,
        [SKILL_REFERENCES_DIR, SKILL_ASSETS_DIR],
        skill.fsAdapter,
      );

      const content = await readSkillFile(skill, validatedPath);
      return { content, path: input.reference };
    },
  });
}

/**
 * Create the execute-skill-script tool.
 * Executes a script from a skill's scripts/ directory.
 */
export function createExecuteSkillScriptTool(): Tool {
  return tool({
    id: "execute-skill-script",
    description:
      "Execute a script from a skill's scripts/ directory. Returns stdout, stderr, and exit code.",
    inputSchema: z.object({
      skillId: z.string().describe("The ID of the skill"),
      script: z.string().describe("Relative path to the script (e.g. 'scripts/setup.sh')"),
      args: z.array(z.string()).optional().describe("Arguments to pass to the script"),
      env: z.record(z.string()).optional().describe("Environment variables for the script"),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .max(300_000)
        .optional()
        .describe("Optional execution timeout in milliseconds (max 300000)"),
    }),
    execute: async (input) => {
      const skill = skillRegistry.get(input.skillId);
      if (!skill) {
        throw toError(
          createError({
            type: "agent",
            message: `Skill "${input.skillId}" not found`,
          }),
        );
      }

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
