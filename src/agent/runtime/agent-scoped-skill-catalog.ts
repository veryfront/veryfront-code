import {
  buildRuntimeSkillDefinition,
  type RuntimeSkillDefinition,
  type RuntimeSkillMetadataLogger,
} from "./skill-metadata.ts";
import {
  discoveryFileExists,
  listDiscoveryDirectoryEntries,
  readDiscoveryTextFile,
} from "../../discovery/file-discovery.ts";
import type { FileDiscoveryContext } from "../../discovery/types.ts";

const SKILL_MD_FILENAME = "SKILL.md";
const AGENT_SKILLS_SUBDIR = "skills";
const REFERENCES_SUBDIR = "references";

/** Input payload for loading an agent-scoped skill catalog. */
export type LoadAgentScopedSkillCatalogInput = {
  /** Agent id; used as the id of the agent's own primary {dir}/SKILL.md. */
  agentId: string;
  /** Absolute or project-relative path to the agent's root directory. */
  rootPath: string;
  /**
   * Selector for which of the agent's own skills to expose.
   * `undefined` or `true` exposes all colocated skills; a list restricts to
   * those skill ids.
   */
  skills?: true | string[];
  context: FileDiscoveryContext;
  logger?: RuntimeSkillMetadataLogger;
};

function selectSkills(
  definitions: RuntimeSkillDefinition[],
  skills: true | string[] | undefined,
): RuntimeSkillDefinition[] {
  if (skills === undefined || skills === true) {
    return definitions;
  }

  const wanted = new Set(skills);
  return definitions.filter((definition) => wanted.has(definition.id));
}

async function listSkillReferences(
  skillDir: string,
  context: FileDiscoveryContext,
): Promise<string[]> {
  const referencesDir = `${skillDir}/${REFERENCES_SUBDIR}`;
  if (!(await discoveryFileExists(referencesDir, context))) {
    return [];
  }

  const references: string[] = [];

  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await listDiscoveryDirectoryEntries(dir, context);
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        await walk(`${dir}/${entry.name}`, relative);
      } else if (entry.isFile) {
        references.push(`${REFERENCES_SUBDIR}/${relative}`);
      }
    }
  }

  await walk(referencesDir, "");
  return references.sort((left, right) => left.localeCompare(right));
}

async function buildSkillFromDirectory(input: {
  id: string;
  skillDir: string;
  context: FileDiscoveryContext;
  logger?: RuntimeSkillMetadataLogger;
}): Promise<RuntimeSkillDefinition | null> {
  const skillMdPath = `${input.skillDir}/${SKILL_MD_FILENAME}`;
  if (!(await discoveryFileExists(skillMdPath, input.context))) {
    return null;
  }

  const content = await readDiscoveryTextFile(skillMdPath, input.context);
  return buildRuntimeSkillDefinition({
    id: input.id,
    content,
    references: await listSkillReferences(input.skillDir, input.context),
    logger: input.logger,
  });
}

/**
 * Loads the colocated skills owned by a single markdown agent.
 *
 * Looks for the agent's own primary skill at `{rootPath}/SKILL.md` (exposed
 * under the agent id) plus additional skills under `{rootPath}/skills/`
 * (directory `{id}/SKILL.md` or flat `{id}.md`). The result is filtered by the
 * agent's `skills` selector and sorted by id.
 */
export async function loadAgentScopedSkillCatalog(
  input: LoadAgentScopedSkillCatalogInput,
): Promise<RuntimeSkillDefinition[]> {
  const collected = new Map<string, RuntimeSkillDefinition>();

  const ownSkill = await buildSkillFromDirectory({
    id: input.agentId,
    skillDir: input.rootPath,
    context: input.context,
    logger: input.logger,
  });
  if (ownSkill) {
    collected.set(ownSkill.id, ownSkill);
  }

  const skillsDir = `${input.rootPath}/${AGENT_SKILLS_SUBDIR}`;
  const entries = await listDiscoveryDirectoryEntries(skillsDir, input.context);
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isDirectory) {
      const definition = await buildSkillFromDirectory({
        id: entry.name,
        skillDir: `${skillsDir}/${entry.name}`,
        context: input.context,
        logger: input.logger,
      });
      if (definition && !collected.has(definition.id)) {
        collected.set(definition.id, definition);
      }
      continue;
    }

    if (entry.isFile && entry.name.endsWith(".md")) {
      const id = entry.name.slice(0, -".md".length);
      const content = await readDiscoveryTextFile(`${skillsDir}/${entry.name}`, input.context);
      const definition = buildRuntimeSkillDefinition({
        id,
        content,
        logger: input.logger,
      });
      if (definition && !collected.has(definition.id)) {
        collected.set(definition.id, definition);
      }
    }
  }

  return selectSkills([...collected.values()], input.skills).sort((left, right) =>
    left.id.localeCompare(right.id)
  );
}
