import { createRuntimeAgentFromMarkdownDefinition } from "../../agent/runtime/agent-markdown-adapter.ts";
import {
  parseRuntimeAgentMarkdownDefinition,
  type RuntimeAgentMarkdownDefinition,
} from "../../agent/runtime/agent-definition.ts";
import { agentRegistry, registerAgent } from "../../agent/composition/index.ts";
import { ensureError } from "#veryfront/errors/veryfront-error.ts";
import type { DiscoveryResult, FileDiscoveryContext } from "../types.ts";
import { trackAgentPath } from "../discovery-utils.ts";
import {
  discoveryFileExists,
  listDiscoveryDirectoryEntries,
  readDiscoveryTextFile,
} from "../file-discovery.ts";
import {
  isSafePathSegment,
  loadAgentColocatedTools,
  registerAgentColocatedSkills,
  sanitizeCapabilityNamespace,
} from "../agent-scoped-capabilities.ts";
import type { Tool } from "#veryfront/tool";

const MARKDOWN_AGENT_FILE_PATTERN = /^[A-Za-z0-9._-]+\.md$/;
const DIRECTORY_AGENT_FILENAME = "AGENT.md";
const RESERVED_TOP_LEVEL_FILENAMES = new Set(["AGENT.md", "SKILL.md"]);

type MarkdownAgentCandidate = {
  id: string;
  file: string;
  rootPath?: string;
};

function getFlatAgentCandidate(dir: string, fileName: string): MarkdownAgentCandidate | null {
  if (RESERVED_TOP_LEVEL_FILENAMES.has(fileName)) {
    return null;
  }
  if (!MARKDOWN_AGENT_FILE_PATTERN.test(fileName)) {
    return null;
  }

  const id = fileName.slice(0, -".md".length);
  // Reject `.`/`..` ids as defense-in-depth against path traversal.
  if (!isSafePathSegment(id)) {
    return null;
  }

  return {
    id,
    file: `${dir}/${fileName}`,
  };
}

async function getDirectoryAgentCandidate(
  dir: string,
  entryName: string,
  context: FileDiscoveryContext,
): Promise<MarkdownAgentCandidate | null> {
  // Reject `.`/`..` and other non-segment names before joining into a path.
  if (!isSafePathSegment(entryName)) {
    return null;
  }

  const rootPath = `${dir}/${entryName}`;
  const agentFile = `${rootPath}/${DIRECTORY_AGENT_FILENAME}`;
  if (!(await discoveryFileExists(agentFile, context))) {
    return null;
  }

  return { id: entryName, file: agentFile, rootPath };
}

/** Tracks sanitized capability namespaces to the agent that owns them. */
type CapabilityNamespaceOwners = Map<string, string>;

async function resolveColocatedCapabilities(
  definition: RuntimeAgentMarkdownDefinition,
  rootPath: string | undefined,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
  namespaceOwners: CapabilityNamespaceOwners,
): Promise<{ resolvedSkillIds?: string[]; tools?: Record<string, Tool> }> {
  // Flat agents have no colocated root: they keep their declared `skills`
  // selector (resolved against the global registry). Directory agents always
  // resolve to an explicit colocated id list (possibly empty) and therefore
  // never fall back to the registry-wide `true`, which would leak other agents'
  // skills.
  if (!rootPath) {
    return {};
  }

  // Two distinct agent ids can sanitize to the same provider-safe namespace
  // (e.g. "a.b" and "a_b" -> "a_b"), which would silently overwrite each
  // other's namespaced tools/skills. Detect and report instead.
  const namespace = sanitizeCapabilityNamespace(definition.id);
  const existingOwner = namespaceOwners.get(namespace);
  if (existingOwner !== undefined && existingOwner !== definition.id) {
    result.errors.push({
      file: rootPath,
      error: ensureError(
        `Agent "${definition.id}" shares the sanitized capability namespace ` +
          `"${namespace}" with agent "${existingOwner}". Rename one to avoid ` +
          `colliding colocated tool/skill ids.`,
      ),
    });
    // Directory agent: do not fall back to global skills.
    return { resolvedSkillIds: [] };
  }
  namespaceOwners.set(namespace, definition.id);

  // Skills and tools live in disjoint subtrees; resolve them concurrently.
  const [resolvedSkillIds, tools] = await Promise.all([
    registerAgentColocatedSkills({
      agentId: definition.id,
      rootPath,
      selector: definition.skills,
      context,
      result,
    }),
    loadAgentColocatedTools({
      agentId: definition.id,
      rootPath,
      selector: definition.tools,
      context,
      result,
    }),
  ]);

  // Always surface resolvedSkillIds for a directory agent (even when empty) so
  // the adapter scopes it to its own skills instead of the global registry.
  return {
    resolvedSkillIds,
    ...(Object.keys(tools).length > 0 ? { tools } : {}),
  };
}

async function registerMarkdownAgent(
  definition: RuntimeAgentMarkdownDefinition,
  file: string,
  rootPath: string | undefined,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
  namespaceOwners: CapabilityNamespaceOwners,
): Promise<void> {
  if (result.agents.has(definition.id)) {
    result.errors.push({
      file,
      error: ensureError(
        `Duplicate agent id "${definition.id}". An agent with this id was already ` +
          `discovered (e.g. both a flat "${definition.id}.md" and a "${definition.id}/" ` +
          `directory exist); keeping the first.`,
      ),
    });
    return;
  }

  const capabilities = await resolveColocatedCapabilities(
    definition,
    rootPath,
    result,
    context,
    namespaceOwners,
  );

  const runtimeAgent = createRuntimeAgentFromMarkdownDefinition(definition, {
    ...(rootPath ? { rootPath } : {}),
    ...(capabilities.resolvedSkillIds !== undefined
      ? { resolvedSkillIds: capabilities.resolvedSkillIds }
      : {}),
    ...(capabilities.tools ? { tools: capabilities.tools } : {}),
  });
  if (runtimeAgent.id !== definition.id) {
    agentRegistry.delete(runtimeAgent.id);
  }
  registerAgent(definition.id, runtimeAgent);
  trackAgentPath(definition.id, file);
  result.agents.set(definition.id, runtimeAgent);
}

async function discoverMarkdownAgentCandidate(
  candidate: MarkdownAgentCandidate,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
  namespaceOwners: CapabilityNamespaceOwners,
): Promise<void> {
  try {
    const definition = parseRuntimeAgentMarkdownDefinition({
      id: candidate.id,
      content: await readDiscoveryTextFile(candidate.file, context),
    });
    await registerMarkdownAgent(
      definition,
      candidate.file,
      candidate.rootPath,
      result,
      context,
      namespaceOwners,
    );
  } catch (error) {
    result.errors.push({ file: candidate.file, error: ensureError(error) });
  }
}

/**
 * Discovers markdown agents from a directory.
 *
 * Supports two layouts side by side:
 * - Flat: `agents/{id}.md`
 * - Directory: `agents/{id}/AGENT.md` (+ colocated `SKILL.md` / `skills/`)
 *
 * Only top-level entries are considered as agents; nested `SKILL.md` and skill
 * reference files are ignored here (they are loaded as the agent's own skills).
 */
export async function discoverRuntimeAgentMarkdownDefinitions(
  dir: string,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
): Promise<void> {
  const entries = (await listDiscoveryDirectoryEntries(dir, context)).sort((left, right) =>
    left.name.localeCompare(right.name)
  );
  const namespaceOwners: CapabilityNamespaceOwners = new Map();

  for (const entry of entries) {
    const candidate = entry.isDirectory
      ? await getDirectoryAgentCandidate(dir, entry.name, context)
      : entry.isFile
      ? getFlatAgentCandidate(dir, entry.name)
      : null;

    if (!candidate) {
      continue;
    }

    await discoverMarkdownAgentCandidate(candidate, result, context, namespaceOwners);
  }
}
