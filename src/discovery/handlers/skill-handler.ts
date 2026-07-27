/**
 * Skill Discovery Handler
 *
 * Discovers skills from SKILL.md files in project directories.
 */

import { join } from "#veryfront/compat/path";
import { agentLogger } from "#veryfront/utils";
import { ensureError } from "#veryfront/errors";
import { parseSkillFrontmatter, validateSkillMetadata } from "#veryfront/skill/parser.ts";
import { SKILL_MD_FILENAME } from "#veryfront/skill/types.ts";
import type { Skill } from "#veryfront/skill";
import type { DiscoveryError, FileDiscoveryContext } from "../types.ts";
import {
  discoveryFileExists,
  listDiscoveryDirectoryEntries,
  readDiscoveryTextFile,
} from "../file-discovery.ts";

const logger = agentLogger.component("skill-discovery");

interface SkillDiscoveryResult {
  skills: Map<string, Skill>;
  errors: DiscoveryError[];
}

/**
 * Discover skills from immediate child directories.
 *
 * Directory enumeration is bounded and fail-closed by the shared discovery
 * filesystem helpers. Individual malformed SKILL.md files remain structured
 * per-source errors so callers can choose reject-all or publish-valid policy.
 */
export async function discoverSkills(
  dir: string,
  context: FileDiscoveryContext,
  verbose?: boolean,
): Promise<SkillDiscoveryResult> {
  const skills = new Map<string, Skill>();
  const errors: DiscoveryError[] = [];
  const entries = (await listDiscoveryDirectoryEntries(dir, context)).sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  );

  for (const entry of entries) {
    if (!entry.isDirectory) continue;

    const skillDir = join(dir, entry.name);
    const skillMdPath = join(skillDir, SKILL_MD_FILENAME);

    try {
      if (!(await discoveryFileExists(skillMdPath, context))) {
        if (verbose) logger.info(`Skipping ${entry.name}: no ${SKILL_MD_FILENAME}`);
        continue;
      }

      const content = await readDiscoveryTextFile(skillMdPath, context);
      const parsed = await parseSkillFrontmatter(content);
      const metadata = validateSkillMetadata(parsed.frontmatter, entry.name);
      const skillId = entry.name;

      if (metadata.name !== entry.name) {
        logger.warn(
          `Skill "${metadata.name}" in directory "${entry.name}" — using directory name as ID`,
        );
      }

      if (skills.has(skillId)) {
        errors.push({
          file: skillMdPath,
          error: new Error(`Duplicate skill "${skillId}" in ${dir}; keeping first registration`),
          code: "duplicate_id",
          sourceKind: "skill",
          sourceId: skillId,
        });
        continue;
      }

      const skill: Skill = {
        id: skillId,
        metadata,
        rootPath: skillDir,
        ...(context.fsAdapter ? { fsAdapter: context.fsAdapter } : {}),
      };
      skills.set(skillId, skill);

      if (verbose) logger.info(`Discovered skill: ${skillId}`);
    } catch (error) {
      errors.push({
        file: skillMdPath,
        error: ensureError(error),
        code: "load_error",
        sourceKind: "skill",
        sourceId: entry.name,
      });
      if (verbose) logger.error(`Error loading skill from ${entry.name}:`, error);
    }
  }

  return { skills, errors };
}
