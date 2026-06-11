/**
 * Per-agent colocated capability loading.
 *
 * Directory-layout agents (`agents/{id}/`) may ship their own tools and skills:
 * - Tools: `agents/{id}/tools/*.ts` → loaded as Tool objects, namespaced so two
 *   agents can ship the same filename without colliding in the global registry
 *   or in provider tool-call names.
 * - Skills: `agents/{id}/SKILL.md` (the agent's own skill) and
 *   `agents/{id}/skills/<sub>/SKILL.md` → registered as `Skill` objects so the
 *   factory skill path (`load_skill`, skill manifest) can surface them.
 *
 * Provider tool-call names allow only `[A-Za-z0-9_-]`, so the namespace prefix
 * is sanitized and joined with `__`.
 */

import type { Tool } from "#veryfront/tool";
import type { Skill } from "#veryfront/skill";
import { parseSkillFrontmatter, validateSkillMetadata } from "#veryfront/skill/parser.ts";
import { registerSkill } from "#veryfront/skill/registry.ts";
import { SKILL_MD_FILENAME } from "#veryfront/skill/types.ts";
import { ensureError } from "#veryfront/errors/veryfront-error.ts";
import { filenameToId } from "./discovery-utils.ts";
import {
  discoveryFileExists,
  findTypeScriptFiles,
  listDiscoveryDirectoryEntries,
  readDiscoveryTextFile,
} from "./file-discovery.ts";
import { importModule } from "./transpiler.ts";
import type { DiscoveryResult, FileDiscoveryContext } from "./types.ts";

const AGENT_TOOLS_SUBDIR = "tools";
const AGENT_SKILLS_SUBDIR = "skills";
/** Separator between the agent namespace and the capability short name. */
export const AGENT_CAPABILITY_NAMESPACE_SEPARATOR = "__";
/** Provider tool-call names allow only this charset, max 64 chars. */
const PROVIDER_TOOL_NAME_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

/** Whether a namespaced tool name is valid for provider tool calls. */
export function isProviderSafeToolName(name: string): boolean {
  return PROVIDER_TOOL_NAME_REGEX.test(name);
}

const SAFE_PATH_SEGMENT_REGEX = /^[A-Za-z0-9._-]+$/;

/**
 * Whether a directory/file entry name is a safe single path segment — used
 * before joining it into a filesystem path. Rejects `.` and `..` (which match
 * the permissive name regex) as defense-in-depth against path traversal, even
 * though POSIX `readdir` does not normally yield them.
 */
export function isSafePathSegment(name: string): boolean {
  return name !== "." && name !== ".." && SAFE_PATH_SEGMENT_REGEX.test(name);
}

/** Sanitizes an agent id into a provider-safe namespace segment. */
export function sanitizeCapabilityNamespace(agentId: string): string {
  return agentId.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** Namespaces a capability short name under its owning agent. */
export function namespaceAgentCapability(agentId: string, shortName: string): string {
  return `${
    sanitizeCapabilityNamespace(agentId)
  }${AGENT_CAPABILITY_NAMESPACE_SEPARATOR}${shortName}`;
}

function isTool(value: unknown): value is Tool {
  return value !== null && typeof value === "object" &&
    typeof (value as Tool).execute === "function";
}

function hasExplicitToolId(tool: Tool): boolean {
  const generated = tool.__veryfrontGeneratedId;
  if (typeof tool.id !== "string" || tool.id.trim().length === 0) {
    return false;
  }
  return generated === undefined || tool.id !== generated;
}

function toolShortName(tool: Tool, file: string): string {
  return hasExplicitToolId(tool) ? tool.id : filenameToId(file);
}

function collectModuleTools(module: unknown, file: string): Map<string, Tool> {
  const tools = new Map<string, Tool>();
  const record = module as Record<string, unknown>;
  for (const value of Object.values(record ?? {})) {
    if (isTool(value)) {
      tools.set(toolShortName(value, file), value);
    }
  }
  return tools;
}

function selectorAllows(selector: true | string[] | undefined, shortName: string): boolean {
  if (selector === undefined || selector === true) {
    return true;
  }
  return selector.includes(shortName);
}

/** Input payload for loading an agent's colocated tools. */
export type LoadAgentColocatedToolsInput = {
  agentId: string;
  rootPath: string;
  selector?: true | string[];
  context: FileDiscoveryContext;
  result?: DiscoveryResult;
};

/**
 * Loads an agent's colocated `tools/*.ts` as a namespaced Tool record suitable
 * for `AgentConfig.tools`. Keys are `{agentId}__{shortName}`; the same value is
 * mirrored on each tool's `id` so the factory registers it without collision.
 */
export async function loadAgentColocatedTools(
  input: LoadAgentColocatedToolsInput,
): Promise<Record<string, Tool>> {
  const toolsDir = `${input.rootPath}/${AGENT_TOOLS_SUBDIR}`;
  if (!(await discoveryFileExists(toolsDir, input.context))) {
    return {};
  }

  const files = (await findTypeScriptFiles(toolsDir, input.context)).sort((left, right) =>
    left.localeCompare(right)
  );
  const tools: Record<string, Tool> = {};

  for (const file of files) {
    try {
      const module = await importModule(file, input.context);
      for (const [shortName, tool] of collectModuleTools(module, file)) {
        if (!selectorAllows(input.selector, shortName)) {
          continue;
        }
        const namespaced = namespaceAgentCapability(input.agentId, shortName);
        if (!isProviderSafeToolName(namespaced)) {
          input.result?.errors.push({
            file,
            error: ensureError(
              `Colocated tool "${shortName}" for agent "${input.agentId}" produces an ` +
                `invalid tool name "${namespaced}" (must match [A-Za-z0-9_-], max 64 chars).`,
            ),
          });
          continue;
        }
        if (!tools[namespaced]) {
          tools[namespaced] = { ...tool, id: namespaced };
        }
      }
    } catch (error) {
      input.result?.errors.push({ file, error: ensureError(error) });
    }
  }

  return tools;
}

/** A colocated skill registered for an agent. */
export type RegisteredAgentSkill = {
  /** Registry id (also the id the agent loads via `load_skill`). */
  id: string;
  /** Short name used by the agent's `skills` selector (own skill = agent id). */
  shortName: string;
};

async function buildSkillFromDir(input: {
  id: string;
  skillDir: string;
  context: FileDiscoveryContext;
}): Promise<Skill | null> {
  const skillMdPath = `${input.skillDir}/${SKILL_MD_FILENAME}`;
  if (!(await discoveryFileExists(skillMdPath, input.context))) {
    return null;
  }

  const content = await readDiscoveryTextFile(skillMdPath, input.context);
  const parsed = await parseSkillFrontmatter(content);
  const metadata = validateSkillMetadata(parsed.frontmatter, input.id);

  return {
    id: input.id,
    metadata,
    rootPath: input.skillDir.replace(/^file:\/\//, ""),
    ...(input.context.fsAdapter ? { fsAdapter: input.context.fsAdapter } : {}),
  };
}

/** Input payload for registering an agent's colocated skills. */
export type RegisterAgentColocatedSkillsInput = {
  agentId: string;
  rootPath: string;
  selector?: true | string[];
  context: FileDiscoveryContext;
  result?: DiscoveryResult;
};

/**
 * Registers an agent's colocated skills into the skill registry and returns the
 * selected registry ids. The agent's own `SKILL.md` is exposed under the agent
 * id; nested `skills/<sub>/SKILL.md` skills are namespaced `{agentId}__{sub}`.
 * Only directory skills (with a `SKILL.md`) are registered here.
 */
export async function registerAgentColocatedSkills(
  input: RegisterAgentColocatedSkillsInput,
): Promise<string[]> {
  const candidates: Array<{ id: string; shortName: string; skillDir: string }> = [];

  if (await discoveryFileExists(`${input.rootPath}/${SKILL_MD_FILENAME}`, input.context)) {
    candidates.push({ id: input.agentId, shortName: input.agentId, skillDir: input.rootPath });
  }

  const skillsDir = `${input.rootPath}/${AGENT_SKILLS_SUBDIR}`;
  const entries = (await listDiscoveryDirectoryEntries(skillsDir, input.context)).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  for (const entry of entries) {
    if (!entry.isDirectory || !isSafePathSegment(entry.name)) {
      continue;
    }
    candidates.push({
      id: namespaceAgentCapability(input.agentId, entry.name),
      shortName: entry.name,
      skillDir: `${skillsDir}/${entry.name}`,
    });
  }

  const registeredIds: string[] = [];
  for (const candidate of candidates) {
    if (!selectorAllows(input.selector, candidate.shortName)) {
      continue;
    }
    try {
      const skill = await buildSkillFromDir({
        id: candidate.id,
        skillDir: candidate.skillDir,
        context: input.context,
      });
      if (!skill) {
        continue;
      }
      registerSkill(skill.id, skill);
      registeredIds.push(skill.id);
    } catch (error) {
      input.result?.errors.push({
        file: `${candidate.skillDir}/${SKILL_MD_FILENAME}`,
        error: ensureError(error),
      });
    }
  }

  return registeredIds;
}
