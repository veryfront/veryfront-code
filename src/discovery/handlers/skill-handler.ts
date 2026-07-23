/**
 * Skill Discovery Handler
 *
 * Discovers skills from SKILL.md files in project directories.
 * This is a parallel discovery path. It does NOT implement DiscoveryHandler<T>
 * (which expects TypeScript import()). Instead, it operates on markdown files.
 */

import { join } from "#veryfront/compat/path";
import { agentLogger } from "#veryfront/utils";
import { ensureError } from "#veryfront/errors";
import { parseSkillFrontmatter, validateSkillMetadata } from "#veryfront/skill/parser.ts";
import { SKILL_MD_FILENAME } from "#veryfront/skill/types.ts";
import type { Skill } from "#veryfront/skill";
import type { FileDiscoveryContext } from "../types.ts";
import {
  discoveryFileExists,
  listDiscoveryDirectoryEntries,
  readDiscoveryTextFile,
} from "../file-discovery.ts";
import { discoveryFileLabel, isSafePathSegment } from "../discovery-utils.ts";
import { recordDiscoveryError } from "../discovery-errors.ts";

const logger = agentLogger.component("skill-discovery");

interface SkillDiscoveryError {
  file: string;
  error: Error;
}

interface SkillDiscoveryResult {
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
  const dirExists = await discoveryFileExists(dir, context);

  if (!dirExists) {
    if (verbose) {
      logger.info("Skills directory does not exist");
    }
    return { skills, errors };
  }

  // Iterate subdirectories
  const entries = await listDiscoveryDirectoryEntries(dir, context);

  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    if (!isSafePathSegment(entry.name)) {
      recordDiscoveryError(errors, {
        file: discoveryFileLabel(dir, context.baseDir),
        error: ensureError("Skill directory has an invalid name"),
      });
      continue;
    }

    const skillDir = join(dir, entry.name);
    const skillMdPath = join(skillDir, SKILL_MD_FILENAME);

    try {
      // Check if SKILL.md exists
      const mdExists = await discoveryFileExists(skillMdPath, context);

      if (!mdExists) {
        if (verbose) {
          logger.info("Skill directory has no definition file");
        }
        continue;
      }

      // Read SKILL.md content
      const content = await readDiscoveryTextFile(skillMdPath, context);

      // Parse frontmatter
      const parsed = await parseSkillFrontmatter(content);

      // Validate metadata against the skill's parent directory name.
      const metadata = validateSkillMetadata(parsed.frontmatter, entry.name);

      const skillId = entry.name;

      // Check for duplicate IDs (first wins)
      if (skills.has(skillId)) {
        recordDiscoveryError(errors, {
          file: discoveryFileLabel(skillMdPath, context.baseDir),
          error: ensureError("Duplicate skill id; keeping the first definition"),
        });
        if (verbose) logger.warn("Duplicate skill id ignored");
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
        logger.info("Skill discovered");
      }
    } catch (error) {
      recordDiscoveryError(errors, {
        file: discoveryFileLabel(skillMdPath, context.baseDir),
        error: ensureError(error),
      });

      if (verbose) {
        logger.error("Skill discovery failed", {
          file: discoveryFileLabel(skillMdPath, context.baseDir),
          errorName: error instanceof Error ? error.name : typeof error,
        });
      }
    }
  }

  return { skills, errors };
}
