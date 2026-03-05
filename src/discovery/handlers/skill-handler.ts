/**
 * Skill Discovery Handler
 *
 * Discovers skills from SKILL.md files in project directories.
 * This is a parallel discovery path — it does NOT implement DiscoveryHandler<T>
 * (which expects TypeScript import()). Instead, it operates on markdown files.
 */

import { exists, readDir, readTextFile } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";
import { ensureError } from "#veryfront/errors/veryfront-error.ts";
import { parseSkillFrontmatter, validateSkillMetadata } from "#veryfront/skill/parser.ts";
import { SKILL_MD_FILENAME } from "#veryfront/skill/types.ts";
import type { Skill } from "#veryfront/skill";
import type { FileDiscoveryContext } from "../types.ts";

const logger = agentLogger.component("skill-discovery");

export interface SkillDiscoveryError {
  file: string;
  error: Error;
}

export interface SkillDiscoveryResult {
  skills: Map<string, Skill>;
  errors: SkillDiscoveryError[];
}

/**
 * Discover skills from a directory.
 *
 * Scans for subdirectories containing SKILL.md files and parses them
 * into Skill objects. Uses fsAdapter when available (for VFS/cloud),
 * falling back to compat layer functions.
 */
export async function discoverSkills(
  dir: string,
  context: FileDiscoveryContext,
  verbose?: boolean,
): Promise<SkillDiscoveryResult> {
  const skills = new Map<string, Skill>();
  const errors: SkillDiscoveryError[] = [];
  const { fsAdapter } = context;

  // Check if directory exists
  const dirExists = fsAdapter ? await fsAdapter.exists(dir) : await exists(dir);

  if (!dirExists) {
    if (verbose) {
      logger.info(`Skills directory does not exist: ${dir}`);
    }
    return { skills, errors };
  }

  // Iterate subdirectories
  const entries = fsAdapter ? fsAdapter.readDir(dir) : readDir(dir);

  for await (const entry of entries) {
    if (!entry.isDirectory) continue;

    const skillDir = join(dir, entry.name);
    const skillMdPath = join(skillDir, SKILL_MD_FILENAME);

    try {
      // Check if SKILL.md exists
      const mdExists = fsAdapter ? await fsAdapter.exists(skillMdPath) : await exists(skillMdPath);

      if (!mdExists) {
        if (verbose) {
          logger.info(`Skipping ${entry.name}: no ${SKILL_MD_FILENAME}`);
        }
        continue;
      }

      // Read SKILL.md content
      const content = fsAdapter
        ? await fsAdapter.readFile(skillMdPath)
        : await readTextFile(skillMdPath);

      // Parse frontmatter
      const parsed = await parseSkillFrontmatter(content);

      // Validate metadata (directory name as fallback for skill name)
      const metadata = validateSkillMetadata(parsed.frontmatter, entry.name);

      // Warn if metadata name differs from directory name, use directory name as ID
      const skillId = entry.name;
      if (metadata.name !== entry.name) {
        logger.warn(
          `Skill "${metadata.name}" in directory "${entry.name}" — using directory name as ID`,
        );
      }

      // Check for duplicate IDs (first wins)
      if (skills.has(skillId)) {
        logger.warn(`Duplicate skill "${skillId}" — keeping first registration`);
        continue;
      }

      const skill: Skill = {
        id: skillId,
        metadata,
        rootPath: skillDir,
        ...(fsAdapter && { fsAdapter }),
      };

      skills.set(skillId, skill);

      if (verbose) {
        logger.info(`Discovered skill: ${skillId}`);
      }
    } catch (error) {
      errors.push({ file: skillMdPath, error: ensureError(error) });

      if (verbose) {
        logger.error(`Error loading skill from ${entry.name}:`, error);
      }
    }
  }

  return { skills, errors };
}
