/**
 * Resolves a saved project agent through the API when the hosted service did
 * not discover it locally, so `invoke_agent` runs the target agent's own
 * configuration instead of an unconfigured fork of the parent.
 *
 * The API answers `GET /projects/{project}/agents/{agent_id}` (operation
 * `getAgentSource`) with the agent document (OpenAPI `AgentSource`). Its tool
 * fields are read as the API defines them:
 *
 * - `tools` is the authored selector when the source states one. `false` is
 *   deny-all: no callable host tools, including the skill loader. Provider-native
 *   tools (`provider_tool_ids`) stay, as they do for a main agent run.
 * - `tools: true`, or no `tools` with `all_tools_enabled: true`, grants all tools.
 * - Otherwise `tool_ids` is the exact allowlist, and the `false` entries of a
 *   map selector are explicit denials.
 *
 * A document without a statically readable definition (`edit_mode:
 * "source_only"` or no `system_prompt`) is a placeholder, not the agent. A
 * Markdown source is parsed with the runtime's own agent parser; any other
 * source fails closed rather than running a child with empty instructions.
 */
import {
  parseRuntimeAgentMarkdownDefinition,
  type RuntimeAgentMarkdownDefinition,
} from "../runtime/agent-definition.ts";
import { CANONICAL_LOAD_SKILL_TOOL_ID, LOAD_SKILL_TOOL_ID } from "../platform-tool-names.ts";

/** Terminal error codes a hosted child agent lookup reports to the parent. */
export const hostedChildAgentResolutionErrorCodes = {
  notFound: "CHILD_AGENT_NOT_FOUND",
  unsupportedSource: "CHILD_AGENT_SOURCE_UNSUPPORTED",
  lookupFailed: "CHILD_AGENT_LOOKUP_FAILED",
  lookupTimedOut: "CHILD_AGENT_LOOKUP_TIMEOUT",
} as const;

/** Terminal error code of a failed hosted child agent lookup. */
export type HostedChildAgentResolutionErrorCode =
  (typeof hostedChildAgentResolutionErrorCodes)[keyof typeof hostedChildAgentResolutionErrorCodes];

/** A child agent lookup that must stop the child run and be reported to the parent. */
export class HostedChildAgentResolutionError extends Error {
  readonly code: HostedChildAgentResolutionErrorCode;

  constructor(code: HostedChildAgentResolutionErrorCode, message: string) {
    super(message);
    this.name = "HostedChildAgentResolutionError";
    this.code = code;
  }
}

/** Default bound for one saved agent lookup. */
export const HOSTED_PROJECT_AGENT_LOOKUP_TIMEOUT_MS = 10_000;

/** Input for {@link fetchHostedProjectAgentDefinition}. */
export type FetchHostedProjectAgentDefinitionInput = {
  apiUrl: string;
  authToken: string;
  projectId: string;
  agentId: string;
  branchId?: string | null;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  fetch?: typeof fetch;
};

/** Fetches a saved project agent definition, or throws {@link HostedChildAgentResolutionError}. */
export type HostedProjectAgentDefinitionFetcher = (
  input: FetchHostedProjectAgentDefinitionInput,
) => Promise<RuntimeAgentMarkdownDefinition>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOwn(source: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(source, key) ? source[key] : undefined;
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = readOwn(source, key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = readOwn(source, key);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readStringArray(source: Record<string, unknown>, key: string): string[] | undefined {
  const value = readOwn(source, key);
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

/** The skill loader spellings deny-all removes. */
const SKILL_LOADER_TOOL_NAMES = [LOAD_SKILL_TOOL_ID, CANONICAL_LOAD_SKILL_TOOL_ID];

/** Callable tool selection derived from an agent document's tool fields. */
export type AgentDocumentToolSelection = {
  /** `tools: false`: no callable host tools, including the skill loader. */
  denyAll: boolean;
  tools: true | string[];
  deniedTools: string[];
  providerTools: string[];
};

/** Derive the callable tool selection from the API agent document's tool fields. */
export function deriveAgentDocumentToolSelection(
  document: Record<string, unknown>,
): AgentDocumentToolSelection {
  const selector = readOwn(document, "tools");
  const toolIds = readStringArray(document, "tool_ids") ?? [];
  const providerTools = readStringArray(document, "provider_tool_ids") ?? [];
  if (selector === false) {
    return { denyAll: true, tools: [], deniedTools: [...SKILL_LOADER_TOOL_NAMES], providerTools };
  }
  if (
    selector === true || (selector === undefined && readOwn(document, "all_tools_enabled") === true)
  ) {
    return { denyAll: false, tools: true, deniedTools: [], providerTools };
  }
  const deniedTools = isRecord(selector)
    ? Object.entries(selector)
      .filter(([name, enabled]) => enabled === false && name.length > 0)
      .map(([name]) => name)
    : [];
  return { denyAll: false, tools: toolIds, deniedTools, providerTools };
}

function readSkillSelector(
  document: Record<string, unknown>,
): RuntimeAgentMarkdownDefinition["skills"] {
  const selector = readOwn(document, "skills");
  if (typeof selector === "boolean" || (typeof selector === "string" && selector.length > 0)) {
    return selector;
  }
  if (Array.isArray(selector)) return readStringArray(document, "skills");
  if (isRecord(selector)) {
    return Object.fromEntries(
      Object.entries(selector).filter((entry): entry is [string, boolean] =>
        entry[0].length > 0 && typeof entry[1] === "boolean"
      ),
    );
  }
  const selection = readOwn(document, "skill_selection");
  // `omitted` means every visible project skill, which the runtime resolves.
  return isRecord(selection) && selection.kind === "explicit"
    ? readStringArray(selection, "skill_ids") ?? []
    : undefined;
}

function unsupportedSource(agentId: string, document: Record<string, unknown>, detail: string) {
  const sourcePath = readString(document, "source_path");
  const reasons = readStringArray(document, "source_only_reasons") ?? [];
  return new HostedChildAgentResolutionError(
    hostedChildAgentResolutionErrorCodes.unsupportedSource,
    `Agent "${agentId}"${
      sourcePath ? ` (${sourcePath})` : ""
    } cannot run as a child agent: ${detail}` +
      (reasons.length > 0 ? ` ${reasons.join(" ")}` : ""),
  );
}

function parseMarkdownSourceDefinition(
  document: Record<string, unknown>,
  agentId: string,
): RuntimeAgentMarkdownDefinition {
  const sourcePath = readString(document, "source_path");
  const source = readOwn(document, "source");
  if (!sourcePath?.toLowerCase().endsWith(".md") || typeof source !== "string") {
    throw unsupportedSource(agentId, document, "its definition is not statically readable.");
  }
  let definition: RuntimeAgentMarkdownDefinition;
  try {
    definition = parseRuntimeAgentMarkdownDefinition({ id: agentId, content: source });
  } catch (error) {
    throw unsupportedSource(
      agentId,
      document,
      `its Markdown source is invalid (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  if (definition.instructions.trim().length === 0) {
    throw unsupportedSource(agentId, document, "its source has no instructions.");
  }
  return definition;
}

/**
 * Map a saved agent document to the runtime definition hosted child runs use.
 * The document's tool selection is an authorization ceiling; see
 * {@link deriveAgentDocumentToolSelection}.
 */
export function toRuntimeAgentDefinitionFromAgentDocument(
  document: unknown,
  expectedAgentId: string,
): RuntimeAgentMarkdownDefinition {
  if (!isRecord(document) || readString(document, "id") !== expectedAgentId) {
    throw new HostedChildAgentResolutionError(
      hostedChildAgentResolutionErrorCodes.lookupFailed,
      `Project agent lookup did not confirm agent "${expectedAgentId}"`,
    );
  }
  const systemPrompt = readString(document, "system_prompt");
  if (readOwn(document, "edit_mode") === "source_only" || !systemPrompt?.trim()) {
    return parseMarkdownSourceDefinition(document, expectedAgentId);
  }

  const selection = deriveAgentDocumentToolSelection(document);
  const skills = readSkillSelector(document);
  const thinking = readOwn(document, "thinking");
  const thinkingBudget = isRecord(thinking) ? readNumber(thinking, "budget_tokens") : undefined;
  const model = readString(document, "model");
  const temperature = readNumber(document, "temperature");
  const maxSteps = readNumber(document, "max_steps");

  return {
    id: expectedAgentId,
    name: readString(document, "name") ?? expectedAgentId,
    description: readString(document, "description") ?? "",
    instructions: systemPrompt,
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
    ...(selection.providerTools.length > 0 ? { providerTools: selection.providerTools } : {}),
    ...(skills === undefined ? {} : { skills }),
    tools: selection.tools,
    ...(selection.deniedTools.length > 0 ? { deniedTools: selection.deniedTools } : {}),
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
 * Read a saved project agent through the API agent source reader. The lookup
 * is bounded by `timeoutMs` and follows `abortSignal`. A 404 reports that the
 * project has no such agent; every failure throws so the child run fails
 * closed instead of running without the agent's configuration.
 */
export async function fetchHostedProjectAgentDefinition(
  input: FetchHostedProjectAgentDefinitionInput,
): Promise<RuntimeAgentMarkdownDefinition> {
  input.abortSignal?.throwIfAborted();
  const url = new URL(
    `/projects/${encodeURIComponent(input.projectId)}/agents/${encodeURIComponent(input.agentId)}`,
    input.apiUrl,
  );
  if (input.branchId && UUID_PATTERN.test(input.branchId)) {
    url.searchParams.set("source_target_kind", "preview_branch");
    url.searchParams.set("target_branch_id", input.branchId);
  }
  const timeoutMs = input.timeoutMs ?? HOSTED_PROJECT_AGENT_LOOKUP_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromParent = () => controller.abort(input.abortSignal?.reason);
  input.abortSignal?.addEventListener("abort", abortFromParent, { once: true });

  try {
    let response: Response;
    let document: unknown;
    try {
      response = await (input.fetch ?? fetch)(url, {
        headers: { Authorization: `Bearer ${input.authToken}` },
        signal: controller.signal,
      });
      if (response.status === 404) {
        cancelResponseBodyWithoutWaiting(response);
        throw new HostedChildAgentResolutionError(
          hostedChildAgentResolutionErrorCodes.notFound,
          `Agent "${input.agentId}" was not found in project "${input.projectId}". ` +
            "Check the agent_id; no child agent was run.",
        );
      }
      if (!response.ok) {
        cancelResponseBodyWithoutWaiting(response);
        throw new HostedChildAgentResolutionError(
          hostedChildAgentResolutionErrorCodes.lookupFailed,
          `Project agent lookup failed (${response.status})`,
        );
      }
      document = await response.json();
    } catch (error) {
      if (error instanceof HostedChildAgentResolutionError) throw error;
      if (timedOut) {
        throw new HostedChildAgentResolutionError(
          hostedChildAgentResolutionErrorCodes.lookupTimedOut,
          `Project agent lookup for "${input.agentId}" timed out after ${timeoutMs}ms`,
        );
      }
      input.abortSignal?.throwIfAborted();
      throw new HostedChildAgentResolutionError(
        hostedChildAgentResolutionErrorCodes.lookupFailed,
        `Project agent lookup for "${input.agentId}" failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return toRuntimeAgentDefinitionFromAgentDocument(document, input.agentId);
  } finally {
    clearTimeout(timer);
    input.abortSignal?.removeEventListener("abort", abortFromParent);
  }
}
