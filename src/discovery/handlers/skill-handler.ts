/**
 * Skill Discovery Handler
 *
 * Discovers skills from SKILL.md files in project directories.
 */

import { join } from "#veryfront/compat/path";
import { agentLogger } from "#veryfront/utils";
import { ensureError } from "#veryfront/errors";
import { parseSkillFileFrontmatter, validateSkillFileMetadata } from "#veryfront/skill/parser.ts";
import { SKILL_TEXT_FILE_MAX_BYTES } from "#veryfront/skill/limits.ts";
import { SKILL_MD_FILENAME } from "#veryfront/skill/types.ts";
import type { Skill } from "#veryfront/skill";
import type { DiscoveryError, FileDiscoveryContext } from "../types.ts";
import {
  discoveryFileExists,
  listDiscoveryDirectoryEntries,
  readDiscoveryTextFile,
  resolveRuntimeDiscoveryRoot,
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

      const content = await readDiscoveryTextFile(skillMdPath, context, {
        maxBytes: SKILL_TEXT_FILE_MAX_BYTES,
      });
      const parsed = await parseSkillFileFrontmatter(content);
      const metadata = validateSkillFileMetadata(parsed.frontmatter, entry.name);
      // Directory identity is canonical. The parser retains any differing
      // authored name only as display metadata.
      const skillId = entry.name;
      const runtimeRoot = resolveRuntimeDiscoveryRoot(skillDir, context);

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
        rootPath: runtimeRoot.rootPath,
        ...(runtimeRoot.fsAdapter ? { fsAdapter: runtimeRoot.fsAdapter } : {}),
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
