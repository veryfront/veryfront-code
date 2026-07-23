import { createRuntimeAgentFromMarkdownDefinition } from "../../agent/runtime/agent-markdown-adapter.ts";
import {
  parseRuntimeAgentMarkdownDefinition,
  type RuntimeAgentMarkdownDefinition,
} from "../../agent/runtime/agent-definition.ts";
import { agentRegistry, registerAgent } from "../../agent/composition/index.ts";
import { skillRegistry } from "#veryfront/skill/registry.ts";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import { ensureError } from "#veryfront/errors";
import type { DiscoveryResult, FileDiscoveryContext } from "../types.ts";
import { discoveryFileLabel, trackAgentPath } from "../discovery-utils.ts";
import {
  discoveryFileExists,
  listDiscoveryDirectoryEntries,
  readDiscoveryTextFile,
} from "../file-discovery.ts";
import {
  isSafePathSegment,
  registerAgentColocatedSkills,
  registerAgentColocatedTools,
  sanitizeCapabilityNamespace,
} from "../agent-scoped-capabilities.ts";
import { recordDiscoveryError } from "../discovery-errors.ts";

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

function getRegisteredCapabilityNamespaceOwners(): CapabilityNamespaceOwners {
  const owners: CapabilityNamespaceOwners = new Map();
  const capabilities = [
    ...toolRegistry.getAll().values(),
    ...skillRegistry.getAll().values(),
  ];
  for (const capability of capabilities) {
    const owner = capability.ownerAgentId;
    if (typeof owner !== "string" || owner.length === 0) continue;
    const namespace = sanitizeCapabilityNamespace(owner);
    if (!owners.has(namespace)) owners.set(namespace, owner);
  }
  return owners;
}

/**
 * Registers a directory agent's colocated capabilities. This is PURE
 * REGISTRATION. Binding (`skills:` / `tools:` selectors) happens at
 * invocation time via the owner-aware resolvers, identically for flat and
 * directory agents.
 *
 * Two distinct agent ids can sanitize to the same provider-safe namespace
 * (e.g. "a.b" and "a_b" -> "a_b"), which would collide owned capability ids;
 * detected and reported instead of silently overwriting.
 */
async function registerColocatedCapabilities(
  definition: RuntimeAgentMarkdownDefinition,
  rootPath: string,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
  namespaceOwners: CapabilityNamespaceOwners,
): Promise<void> {
  const namespace = sanitizeCapabilityNamespace(definition.id);
  const existingOwner = namespaceOwners.get(namespace);
  if (existingOwner !== undefined && existingOwner !== definition.id) {
    recordDiscoveryError(result.errors, {
      file: discoveryFileLabel(rootPath, context.baseDir),
      error: ensureError(
        `Agent "${definition.id}" shares the sanitized capability namespace ` +
          `"${namespace}" with agent "${existingOwner}". Rename one to avoid ` +
          `colliding colocated tool/skill ids.`,
      ),
    });
    return;
  }
  namespaceOwners.set(namespace, definition.id);

  // Preserve deterministic diagnostics and transaction context while project
  // modules initialize. Registry savepoints must not race sibling discovery
  // work through separate asynchronous context branches.
  await registerAgentColocatedSkills({ agentId: definition.id, rootPath, context, result });
  await registerAgentColocatedTools({ agentId: definition.id, rootPath, context, result });
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
    recordDiscoveryError(result.errors, {
      file: discoveryFileLabel(file, context.baseDir),
      error: ensureError(
        `Duplicate agent id "${definition.id}". An agent with this id was already ` +
          `discovered (e.g. both a flat "${definition.id}.md" and a "${definition.id}/" ` +
          `directory exist); keeping the first.`,
      ),
    });
    return;
  }

  if (rootPath) {
    await registerColocatedCapabilities(definition, rootPath, result, context, namespaceOwners);
  }

  const runtimeAgent = createRuntimeAgentFromMarkdownDefinition(definition);
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
    recordDiscoveryError(result.errors, {
      file: discoveryFileLabel(candidate.file, context.baseDir),
      error: ensureError(error),
    });
  }
}

/**
 * Discovers markdown agents from a directory.
 *
 * Supports two layouts side by side:
 * - Flat: `agents/{id}.md`
 * - Directory: `agents/{id}/AGENT.md` (+ colocated `SKILL.md` / `skills/` /
 *   `tools/`, registered with owner metadata)
 *
 * Binding is NOT decided here: both layouts pass their parsed definition to
 * the same adapter, and the owner-aware resolvers apply one rule for every
 * agent kind at invocation time.
 */
export async function discoverRuntimeAgentMarkdownDefinitions(
  dir: string,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
): Promise<void> {
  const entries = (await listDiscoveryDirectoryEntries(dir, context)).sort((left, right) =>
    left.name.localeCompare(right.name)
  );
  const namespaceOwners = getRegisteredCapabilityNamespaceOwners();

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
