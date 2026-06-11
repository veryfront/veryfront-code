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
  loadAgentColocatedTools,
  registerAgentColocatedSkills,
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

  return {
    id: fileName.slice(0, -".md".length),
    file: `${dir}/${fileName}`,
  };
}

async function getDirectoryAgentCandidate(
  dir: string,
  entryName: string,
  context: FileDiscoveryContext,
): Promise<MarkdownAgentCandidate | null> {
  if (!/^[A-Za-z0-9._-]+$/.test(entryName)) {
    return null;
  }

  const rootPath = `${dir}/${entryName}`;
  const agentFile = `${rootPath}/${DIRECTORY_AGENT_FILENAME}`;
  if (!(await discoveryFileExists(agentFile, context))) {
    return null;
  }

  return { id: entryName, file: agentFile, rootPath };
}

async function resolveColocatedCapabilities(
  definition: RuntimeAgentMarkdownDefinition,
  rootPath: string | undefined,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
): Promise<{ resolvedSkillIds?: string[]; tools?: Record<string, Tool> }> {
  if (!rootPath) {
    return {};
  }

  const resolvedSkillIds = await registerAgentColocatedSkills({
    agentId: definition.id,
    rootPath,
    selector: definition.skills,
    context,
    result,
  });
  const tools = await loadAgentColocatedTools({
    agentId: definition.id,
    rootPath,
    selector: definition.tools,
    context,
    result,
  });

  return {
    ...(resolvedSkillIds.length > 0 ? { resolvedSkillIds } : {}),
    ...(Object.keys(tools).length > 0 ? { tools } : {}),
  };
}

async function registerMarkdownAgent(
  definition: RuntimeAgentMarkdownDefinition,
  file: string,
  rootPath: string | undefined,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
): Promise<void> {
  if (result.agents.has(definition.id)) {
    return;
  }

  const capabilities = await resolveColocatedCapabilities(definition, rootPath, result, context);

  const runtimeAgent = createRuntimeAgentFromMarkdownDefinition({
    definition,
    ...(rootPath ? { rootPath } : {}),
    ...(capabilities.resolvedSkillIds ? { resolvedSkillIds: capabilities.resolvedSkillIds } : {}),
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
): Promise<void> {
  try {
    const definition = parseRuntimeAgentMarkdownDefinition({
      id: candidate.id,
      content: await readDiscoveryTextFile(candidate.file, context),
    });
    await registerMarkdownAgent(definition, candidate.file, candidate.rootPath, result, context);
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

  for (const entry of entries) {
    const candidate = entry.isDirectory
      ? await getDirectoryAgentCandidate(dir, entry.name, context)
      : entry.isFile
      ? getFlatAgentCandidate(dir, entry.name)
      : null;

    if (!candidate) {
      continue;
    }

    await discoverMarkdownAgentCandidate(candidate, result, context);
  }
}
