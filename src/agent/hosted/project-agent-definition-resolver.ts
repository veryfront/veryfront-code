/**
 * Resolves a saved project agent through the API when the hosted service did
 * not discover it locally, so `invoke_agent` runs the target agent's own
 * configuration instead of an unconfigured fork of the parent.
 */
import type { RuntimeAgentMarkdownDefinition } from "../runtime/agent-definition.ts";
import { CANONICAL_LOAD_SKILL_TOOL_ID, LOAD_SKILL_TOOL_ID } from "../platform-tool-names.ts";

/** Input for {@link fetchHostedProjectAgentDefinition}. */
export type FetchHostedProjectAgentDefinitionInput = {
  apiUrl: string;
  authToken: string;
  projectId: string;
  agentId: string;
  branchId?: string | null;
  abortSignal?: AbortSignal;
  fetch?: typeof fetch;
};

/** Fetches a saved project agent definition; `undefined` means the project has no such agent. */
export type HostedProjectAgentDefinitionFetcher = (
  input: FetchHostedProjectAgentDefinitionInput,
) => Promise<RuntimeAgentMarkdownDefinition | undefined>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = Object.hasOwn(source, key) ? source[key] : undefined;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = Object.hasOwn(source, key) ? source[key] : undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringArray(source: Record<string, unknown>, key: string): string[] | undefined {
  const value = Object.hasOwn(source, key) ? source[key] : undefined;
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

/**
 * Map a saved agent document to the runtime definition hosted child runs use.
 * The document's tool selection is an authorization ceiling: `tools: false`
 * grants no callable tools, including the runtime skill loader, and a
 * concrete `tool_ids` list grants only those tools.
 */
export function toRuntimeAgentDefinitionFromAgentDocument(
  document: unknown,
  expectedAgentId: string,
): RuntimeAgentMarkdownDefinition {
  if (!isRecord(document) || readString(document, "id") !== expectedAgentId) {
    throw new Error(`Project agent lookup did not confirm agent "${expectedAgentId}"`);
  }
  const toolsDisabled = Object.hasOwn(document, "tools") && document.tools === false;
  const allToolsEnabled = !toolsDisabled && document.all_tools_enabled === true;
  const toolIds = readStringArray(document, "tool_ids") ?? [];
  const providerToolIds = toolsDisabled ? [] : readStringArray(document, "provider_tool_ids") ?? [];
  const skillSelection = Object.hasOwn(document, "skill_selection")
    ? document.skill_selection
    : undefined;
  const explicitSkillIds = isRecord(skillSelection) && skillSelection.kind === "explicit"
    ? readStringArray(skillSelection, "skill_ids") ?? []
    : undefined;
  const thinking = Object.hasOwn(document, "thinking") ? document.thinking : undefined;
  const thinkingBudget = isRecord(thinking) ? readNumber(thinking, "budget_tokens") : undefined;
  const model = readString(document, "model");
  const temperature = readNumber(document, "temperature");
  const maxSteps = readNumber(document, "max_steps");

  return {
    id: expectedAgentId,
    name: readString(document, "name") ?? expectedAgentId,
    description: readString(document, "description") ?? "",
    instructions: readString(document, "system_prompt") ?? "",
    ...(model ? { model } : {}),
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxSteps === undefined ? {} : { maxSteps }),
    ...(isRecord(thinking) && typeof thinking.enabled === "boolean"
      ? {
        thinking: {
          enabled: thinking.enabled,
          ...(thinkingBudget === undefined ? {} : { budgetTokens: thinkingBudget }),
        },
      }
      : {}),
    ...(providerToolIds.length > 0 ? { providerTools: providerToolIds } : {}),
    ...(explicitSkillIds === undefined ? {} : { skills: explicitSkillIds }),
    tools: allToolsEnabled ? true : toolsDisabled ? [] : toolIds,
    ...(toolsDisabled ? { deniedTools: [LOAD_SKILL_TOOL_ID, CANONICAL_LOAD_SKILL_TOOL_ID] } : {}),
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cancelResponseBodyWithoutWaiting(response: Response): void {
  let cancellation: Promise<void> | undefined;
  try {
    cancellation = response.body?.cancel();
  } catch {
    // Preserve the primary lookup outcome when connection cleanup also fails.
  }
  void cancellation?.catch(() => undefined);
}

/**
 * Read a saved project agent through the API agent source reader. A 404 means
 * the project has no agent with this ID; any other failure throws so the
 * child run fails closed instead of running without the agent's configuration.
 */
export async function fetchHostedProjectAgentDefinition(
  input: FetchHostedProjectAgentDefinitionInput,
): Promise<RuntimeAgentMarkdownDefinition | undefined> {
  const url = new URL(
    `/projects/${encodeURIComponent(input.projectId)}/agents/${encodeURIComponent(input.agentId)}`,
    input.apiUrl,
  );
  if (input.branchId && UUID_PATTERN.test(input.branchId)) {
    url.searchParams.set("source_target_kind", "preview_branch");
    url.searchParams.set("target_branch_id", input.branchId);
  }
  const response = await (input.fetch ?? fetch)(url, {
    headers: { Authorization: `Bearer ${input.authToken}` },
    signal: input.abortSignal,
  });
  if (response.status === 404) {
    cancelResponseBodyWithoutWaiting(response);
    return undefined;
  }
  if (!response.ok) {
    cancelResponseBodyWithoutWaiting(response);
    throw new Error(`Project agent lookup failed (${response.status})`);
  }
  let document: unknown;
  try {
    document = await response.json();
  } catch {
    throw new Error(`Project agent lookup did not confirm agent "${input.agentId}"`);
  }
  return toRuntimeAgentDefinitionFromAgentDocument(document, input.agentId);
}
