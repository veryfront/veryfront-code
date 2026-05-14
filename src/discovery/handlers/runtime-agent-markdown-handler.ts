import { createRuntimeAgentFromMarkdownDefinition } from "../../agent/runtime/agent-markdown-adapter.ts";
import {
  parseRuntimeAgentMarkdownDefinition,
  type RuntimeAgentMarkdownDefinition,
} from "../../agent/runtime/agent-definition.ts";
import { agentRegistry, registerAgent } from "../../agent/composition/index.ts";
import { ensureError } from "#veryfront/errors/veryfront-error.ts";
import type { DiscoveryResult, FileDiscoveryContext } from "../types.ts";
import { trackAgentPath } from "../discovery-utils.ts";
import { findMarkdownFiles, readDiscoveryTextFile } from "../file-discovery.ts";

const MARKDOWN_AGENT_FILE_PATTERN = /^[A-Za-z0-9._-]+\.md$/;

type MarkdownAgentCandidate = {
  id: string;
  file: string;
};

function getFileName(file: string): string {
  return file.split("/").pop() ?? "";
}

function getMarkdownAgentCandidate(file: string): MarkdownAgentCandidate | null {
  const fileName = getFileName(file);
  if (!MARKDOWN_AGENT_FILE_PATTERN.test(fileName)) {
    return null;
  }

  return {
    id: fileName.slice(0, -".md".length),
    file,
  };
}

function registerMarkdownAgent(
  definition: RuntimeAgentMarkdownDefinition,
  file: string,
  result: DiscoveryResult,
): void {
  if (result.agents.has(definition.id)) {
    return;
  }

  const runtimeAgent = createRuntimeAgentFromMarkdownDefinition(definition);
  if (runtimeAgent.id !== definition.id) {
    agentRegistry.delete(runtimeAgent.id);
  }
  registerAgent(definition.id, runtimeAgent);
  trackAgentPath(definition.id, file);
  result.agents.set(definition.id, runtimeAgent);
}

export async function discoverRuntimeAgentMarkdownDefinitions(
  dir: string,
  result: DiscoveryResult,
  context: FileDiscoveryContext,
): Promise<void> {
  const files = (await findMarkdownFiles(dir, context)).sort((left, right) =>
    left.localeCompare(right)
  );

  for (const file of files) {
    const candidate = getMarkdownAgentCandidate(file);
    if (!candidate) {
      continue;
    }

    try {
      const definition = parseRuntimeAgentMarkdownDefinition({
        id: candidate.id,
        content: await readDiscoveryTextFile(candidate.file, context),
      });
      registerMarkdownAgent(definition, candidate.file, result);
    } catch (error) {
      result.errors.push({ file: candidate.file, error: ensureError(error) });
    }
  }
}
