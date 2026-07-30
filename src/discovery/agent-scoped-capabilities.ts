/**
 * Per-agent colocated capability registration.
 *
 * Directory-layout agents (`agents/{id}/`) may ship their own tools and
 * skills:
 * - Tools: `agents/{id}/tools/*.ts` → registered into the global tool
 *   registry under `{agentId}--{shortName}` with `ownerAgentId` metadata.
 * - Skills: `agents/{id}/SKILL.md` (the agent's own skill, registered under
 *   the agent id) and `agents/{id}/skills/<sub>/SKILL.md` (registered under
 *   `{agentId}--{sub}`), both with `ownerAgentId` metadata.
 *
 * Discovery here is PURE REGISTRATION: no binding decisions. Visibility and
 * selector resolution (`skills:` / `tools:`, `true` or lists, own short names
 * first) happen at invocation time through the owner-aware resolvers, so flat
 * and directory agents share identical binding semantics.
 *
 * The namespace separator is `--` (decided platform-wide): provider-safe and
 * never confusable with `<provider>__<tool>` integration tool naming.
 */

import type { Tool } from "#veryfront/tool";
import { toolRegistry } from "#veryfront/tool";
import type { Skill } from "#veryfront/skill";
import { parseSkillFileFrontmatter, validateSkillFileMetadata } from "#veryfront/skill/parser.ts";
import { skillRegistryInternal } from "#veryfront/skill/registry.ts";
import { SKILL_MD_FILENAME } from "#veryfront/skill/types.ts";
import { SKILL_TEXT_FILE_MAX_BYTES } from "#veryfront/skill/limits.ts";
import {
  getObjectScopedSkillIdAdmission,
  SkillIdAdmission,
} from "#veryfront/skill/id-admission.ts";
import { registerTool } from "#veryfront/mcp";
import { ensureError } from "#veryfront/errors";
import { filenameToId } from "./discovery-utils.ts";
import { isDiscoverableTool, prepareDiscoveredTool } from "./handlers/tool-handler.ts";
import {
  discoveryFileExists,
  findTypeScriptFiles,
  listDiscoveryDirectoryEntries,
  readDiscoveryTextFile,
  resolveRuntimeDiscoveryRoot,
} from "./file-discovery.ts";
import { importModule } from "./transpiler.ts";
import type { DiscoveryResult, FileDiscoveryContext } from "./types.ts";

const AGENT_TOOLS_SUBDIR = "tools";
const AGENT_SKILLS_SUBDIR = "skills";
/** Separator between the agent namespace and the capability short name. */
export const AGENT_CAPABILITY_NAMESPACE_SEPARATOR = "--";
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
 * the permissive name regex) as defense-in-depth against path traversal.
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

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function collectModuleTools(module: unknown): Tool[] {
  const tools: Tool[] = [];
  const seen = new Set<Tool>();
  const record = module as Record<string, unknown>;
  for (
    const [, value] of Object.entries(record ?? {}).sort(([left], [right]) =>
      compareText(left, right)
    )
  ) {
    if (!isDiscoverableTool(value) || seen.has(value)) continue;
    seen.add(value);
    tools.push(value);
  }
  return tools;
}

function reportShadowedGlobalCapability(input: {
  kind: "tool" | "skill";
  agentId: string;
  shortName: string;
  file: string;
  result?: DiscoveryResult;
}): void {
  const global = input.kind === "tool"
    ? toolRegistry.get(input.shortName)
    : skillRegistryInternal.get(input.shortName);
  if (global && (global as { ownerAgentId?: string }).ownerAgentId === undefined) {
    input.result?.errors.push({
      file: input.file,
      error: ensureError(
        `Colocated ${input.kind} "${input.shortName}" of agent "${input.agentId}" shadows the ` +
          `global ${input.kind} id "${input.shortName}": the agent's selector resolves its own ` +
          `${input.kind} first. Rename one to make the reference unambiguous.`,
      ),
      code: "duplicate_id",
      sourceKind: input.kind,
      sourceId: input.shortName,
    });
  }
}

/** Input payload for registering an agent's colocated capabilities. */
export type RegisterAgentColocatedCapabilitiesInput = {
  agentId: string;
  rootPath: string;
  context: FileDiscoveryContext;
  result?: DiscoveryResult;
};

/**
 * Registers an agent's colocated `tools/*.ts` into the global tool registry
 * under `{agentId}--{shortName}` with owner metadata. Returns registered ids.
 */
export async function registerAgentColocatedTools(
  input: RegisterAgentColocatedCapabilitiesInput,
): Promise<string[]> {
  const toolsDir = `${input.rootPath}/${AGENT_TOOLS_SUBDIR}`;
  if (!(await discoveryFileExists(toolsDir, input.context))) {
    return [];
  }

  const files = (await findTypeScriptFiles(toolsDir, input.context)).sort((left, right) =>
    compareText(left, right)
  );
  const registeredIds: string[] = [];
  const seenThisPass = new Set<string>();

  for (const file of files) {
    try {
      const module = await importModule(file, input.context);
      const moduleTools = collectModuleTools(module);
      if (moduleTools.length === 0) {
        input.result?.errors.push({
          file,
          error: new Error(`${file} does not export a valid colocated tool`),
          code: "invalid_export",
          sourceKind: "tool",
        });
        continue;
      }
      for (const moduleTool of moduleTools) {
        const shortName = toolShortName(moduleTool, file);
        const namespaced = namespaceAgentCapability(input.agentId, shortName);
        if (!isProviderSafeToolName(namespaced)) {
          input.result?.errors.push({
            file,
            error: ensureError(
              `Colocated tool "${shortName}" for agent "${input.agentId}" produces an ` +
                `invalid tool name "${namespaced}" (must match [A-Za-z0-9_-], max 64 chars).`,
            ),
            code: "invalid_export",
            sourceKind: "tool",
            sourceId: namespaced,
          });
          continue;
        }
        // Two colocated tools resolving to the same short name within one
        // discovery pass is a user error — report it instead of silently
        // keeping the first (a later "unknown tool" with no breadcrumb).
        // A pre-existing registry entry from a previous pass is a normal
        // re-discovery refresh and is overwritten.
        if (seenThisPass.has(namespaced)) {
          input.result?.errors.push({
            file,
            error: ensureError(
              `Duplicate colocated tool "${shortName}" for agent "${input.agentId}": ` +
                `another tools/ module already registered "${namespaced}"; keeping the first.`,
            ),
            code: "duplicate_id",
            sourceKind: "tool",
            sourceId: namespaced,
          });
          continue;
        }
        seenThisPass.add(namespaced);
        reportShadowedGlobalCapability({
          kind: "tool",
          agentId: input.agentId,
          shortName,
          file,
          result: input.result,
        });
        registerTool(namespaced, {
          ...prepareDiscoveredTool(moduleTool, namespaced),
          ownerAgentId: input.agentId,
          shortName,
        });
        registeredIds.push(namespaced);
      }
    } catch (error) {
      input.result?.errors.push({
        file,
        error: ensureError(error),
        code: "load_error",
        sourceKind: "tool",
      });
    }
  }

  return registeredIds;
}

async function buildSkillFromDir(input: {
  id: string;
  skillDir: string;
  ownerAgentId: string;
  shortName: string;
  context: FileDiscoveryContext;
}): Promise<Skill | null> {
  const skillMdPath = `${input.skillDir}/${SKILL_MD_FILENAME}`;
  if (!(await discoveryFileExists(skillMdPath, input.context))) {
    return null;
  }

  const content = await readDiscoveryTextFile(skillMdPath, input.context, {
    maxBytes: SKILL_TEXT_FILE_MAX_BYTES,
  });
  const parsed = await parseSkillFileFrontmatter(content);
  const metadata = validateSkillFileMetadata(parsed.frontmatter, input.id, {
    providerSafeName: true,
  });
  const runtimeRoot = resolveRuntimeDiscoveryRoot(input.skillDir, input.context);

  return {
    id: input.id,
    metadata,
    rootPath: runtimeRoot.rootPath,
    ownerAgentId: input.ownerAgentId,
    shortName: input.shortName,
    ...(runtimeRoot.fsAdapter ? { fsAdapter: runtimeRoot.fsAdapter } : {}),
  };
}

/**
 * Registers an agent's colocated skills into the skill registry with owner
 * metadata. The agent's own `SKILL.md` registers under the agent id; nested
 * `skills/<sub>/SKILL.md` skills register under `{agentId}--{sub}`. Returns
 * registered ids.
 */
export async function registerAgentColocatedSkills(
  input: RegisterAgentColocatedCapabilitiesInput,
): Promise<string[]> {
  const skillIdAdmission = input.result
    ? getObjectScopedSkillIdAdmission(input.result)
    : new SkillIdAdmission();
  const candidates: Array<{ id: string; shortName: string; skillDir: string }> = [];

  if (await discoveryFileExists(`${input.rootPath}/${SKILL_MD_FILENAME}`, input.context)) {
    candidates.push({ id: input.agentId, shortName: input.agentId, skillDir: input.rootPath });
  }

  const skillsDir = `${input.rootPath}/${AGENT_SKILLS_SUBDIR}`;
  const entries = (await listDiscoveryDirectoryEntries(skillsDir, input.context)).sort((a, b) =>
    compareText(a.name, b.name)
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
    try {
      const skillFile = `${candidate.skillDir}/${SKILL_MD_FILENAME}`;
      if (!(await discoveryFileExists(skillFile, input.context))) {
        continue;
      }
      if (!skillIdAdmission.hasClaim(candidate.id)) {
        const existing = input.result?.skills.get(candidate.id) ??
          skillRegistryInternal.get(candidate.id);
        if (existing) {
          skillIdAdmission.claim({
            id: candidate.id,
            source: existing.ownerAgentId === undefined
              ? "project-global skill"
              : `agent-owned skill for agent "${existing.ownerAgentId}"`,
            ...(existing.ownerAgentId ? { ownerAgentId: existing.ownerAgentId } : {}),
          });
        }
      }
      const admission = skillIdAdmission.claim({
        id: candidate.id,
        source: `agent-owned skill for agent "${input.agentId}"`,
        ownerAgentId: input.agentId,
      });
      if (!admission.accepted) {
        skillRegistryInternal.delete(candidate.id);
        input.result?.skills.delete(candidate.id);
        if (!input.result) {
          throw admission.error;
        }
        input.result.errors.push({
          file: skillFile,
          error: admission.error,
          code: "duplicate_id",
          sourceKind: "skill",
          sourceId: candidate.id,
        });
        continue;
      }

      const skill = await buildSkillFromDir({
        id: candidate.id,
        skillDir: candidate.skillDir,
        ownerAgentId: input.agentId,
        shortName: candidate.shortName,
        context: input.context,
      });
      if (!skill) {
        continue;
      }
      reportShadowedGlobalCapability({
        kind: "skill",
        agentId: input.agentId,
        shortName: candidate.shortName,
        file: `${candidate.skillDir}/${SKILL_MD_FILENAME}`,
        result: input.result,
      });
      skillRegistryInternal.register(skill.id, skill);
      const registeredSkill = skillRegistryInternal.get(skill.id);
      if (registeredSkill === undefined) {
        throw new Error(`Skill "${skill.id}" was not available after registration`);
      }
      input.result?.skills.set(skill.id, skill);
      registeredIds.push(skill.id);
    } catch (error) {
      if (!input.result) {
        throw error;
      }
      input.result?.errors.push({
        file: `${candidate.skillDir}/${SKILL_MD_FILENAME}`,
        error: ensureError(error),
        code: "load_error",
        sourceKind: "skill",
        sourceId: candidate.id,
      });
    }
  }

  return registeredIds;
}
