import { privateArtifactText as privateText } from "./private-artifact-text.ts";
import {
  filterPrivateArray,
  flatMapPrivateArray,
  joinPrivateArray,
  mapPrivateArray,
  pushPrivateArray,
  somePrivateArray,
} from "#veryfront/security/private-array.ts";
import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import { isErroredToolExecutionResult, type RemoteToolSource } from "#veryfront/tool";
import { toChildRunToolInputRecord } from "../child-run/execution-support.ts";
import { isHostedChildCreateFileAlreadyExistsResult } from "../hosted/child-artifact-support.ts";
import {
  buildDefaultResearchArtifactPathReminder,
  buildDefaultResearchArtifactPaths,
  buildDefaultResearchArtifactPathsFromCurrentReportPath,
  type DefaultResearchArtifactPaths,
} from "./default-research-artifact-policy.ts";

/** Public API contract for default research artifacts. */
export type DefaultResearchArtifacts = DefaultResearchArtifactPaths;

/** Context for default research artifact. */
export interface DefaultResearchArtifactContext {
  availableToolNames?: string[];
  projectId?: string | null;
  parentRunId?: string;
  defaultResearchArtifacts?: DefaultResearchArtifacts | null;
}

/** Public API contract for default research artifact logger. */
export interface DefaultResearchArtifactLogger {
  debug?: (message: string, metadata?: Record<string, unknown>) => void;
}

const isArray = Array.isArray;
const hasOwn = Object.hasOwn;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !isArray(value);
}

function extractToolResultPath(result: unknown): string | null {
  if (!isRecord(result) || typeof result.path !== "string") {
    return null;
  }

  return privateText.replace(result.path, /^\/+/, "");
}

function isReportPath(path: string | null): path is string {
  return path !== null && (path === "report.md" || privateText.endsWith(path, "/report.md"));
}

function currentReportPathMatches(
  artifacts: DefaultResearchArtifacts | null | undefined,
  path: string | null,
): boolean {
  if (!artifacts || !path) {
    return false;
  }

  return privateText.replace(artifacts.currentReportPath, /^\/+/, "") === path;
}

function buildDefaultArtifactsFromResultPath(input: {
  resultPath: string | null;
  parentRunId?: string;
}): DefaultResearchArtifacts | null {
  return input.resultPath && isReportPath(input.resultPath)
    ? buildDefaultResearchArtifactPathsFromCurrentReportPath({
      currentReportPath: input.resultPath,
      runId: input.parentRunId,
    })
    : null;
}

/** Extract latest user text. */
export function extractLatestUserText(messages: readonly unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (!hasOwn(messages, index)) continue;
    const message = messages[index];
    if (!isRecord(message) || message.role !== "user") {
      continue;
    }

    const content = message.content;
    if (typeof content === "string" && privateText.trim(content).length > 0) {
      return content;
    }

    if (!isArray(content)) {
      continue;
    }

    const text = joinPrivateArray(
      filterPrivateArray(
        flatMapPrivateArray(
          content,
          (part) =>
            isRecord(part) && part.type === "text" && typeof part.text === "string"
              ? [privateText.trim(part.text)]
              : [],
        ),
        (value) => value.length > 0,
      ),
      "\n",
    );

    if (text.length > 0) {
      return text;
    }
  }

  return null;
}

function extractLatestUserDescription(text: string): string {
  const withoutCommandSpan = privateText.replace(
    text,
    /<span\s+data-command="[^"]+">\s*(\/[a-z0-9_-]+)\s*<\/span>/gi,
    "$1",
  );
  const withoutLeadingSlashCommand = privateText.replace(
    withoutCommandSpan,
    /^\s*\/[a-z0-9_-]+\s*/i,
    "",
  );

  return privateText.trim(withoutLeadingSlashCommand);
}

/** Fetch latest conversation user text helper. */
export async function fetchLatestConversationUserText(input: {
  apiUrl: string;
  authToken: string;
  conversationId?: string;
  logger?: DefaultResearchArtifactLogger;
}): Promise<string | null> {
  if (!input.conversationId) {
    return null;
  }

  try {
    const response = await fetch(
      `${input.apiUrl}/conversations/${input.conversationId}/messages?limit=20`,
      {
        headers: {
          Authorization: `Bearer ${input.authToken}`,
        },
      },
    );

    if (!response.ok) {
      input.logger?.debug?.(
        "Could not preload conversation messages for research workspace detection",
        {
          conversationId: input.conversationId,
          status: response.status,
        },
      );
      return null;
    }

    const payload = await response.json();
    const data = isRecord(payload) ? payload.data : undefined;
    const messages = isArray(data)
      ? mapPrivateArray(data, (message) => ({
        role: isRecord(message) ? message.role : undefined,
        content: isRecord(message) && isArray(message.parts) ? message.parts : [],
      }))
      : [];

    return extractLatestUserText(messages);
  } catch (error) {
    input.logger?.debug?.(
      "Failed to preload conversation messages for research workspace detection",
      {
        conversationId: input.conversationId,
        error,
      },
    );
    return null;
  }
}

/** Update default research artifacts helper. */
export function updateDefaultResearchArtifacts(input: {
  taskContext: DefaultResearchArtifactContext;
  latestUserText: string | null;
  system: string | ChatSystemMessage[];
}): string | ChatSystemMessage[] {
  if (!input.latestUserText) {
    return input.system;
  }

  const latestUserDescription = extractLatestUserDescription(input.latestUserText);
  const defaultResearchWorkspaceReminder = buildDefaultResearchArtifactPathReminder({
    description: latestUserDescription,
    prompt: input.latestUserText,
    runId: input.taskContext.parentRunId,
  });

  if (!defaultResearchWorkspaceReminder) {
    input.taskContext.defaultResearchArtifacts = null;
    return input.system;
  }

  input.taskContext.defaultResearchArtifacts = buildDefaultResearchArtifactPaths({
    description: latestUserDescription,
    prompt: input.latestUserText,
    runId: input.taskContext.parentRunId,
  });

  return appendSystemReminder(input.system, defaultResearchWorkspaceReminder);
}

function appendSystemReminder(
  instructions: string | ChatSystemMessage[],
  reminder: string,
): string | ChatSystemMessage[] {
  if (typeof instructions === "string") {
    return privateText.includes(instructions, reminder)
      ? instructions
      : `${instructions}\n\n${reminder}`;
  }

  if (
    somePrivateArray(instructions, (message) => privateText.includes(message.content, reminder))
  ) {
    return instructions;
  }

  const output = mapPrivateArray(instructions, (message) => message);
  pushPrivateArray(output, { role: "system", content: reminder });
  return output;
}

/** Apply default research artifact path helper. */
export function applyDefaultResearchArtifactPath(
  toolName: string,
  toolInput: Record<string, unknown>,
  taskContext: DefaultResearchArtifactContext,
): Record<string, unknown> {
  const defaultArtifacts = taskContext.defaultResearchArtifacts;
  if (!defaultArtifacts || (toolName !== "create_file" && toolName !== "update_file")) {
    return toolInput;
  }

  const path = typeof toolInput.path === "string"
    ? privateText.replace(toolInput.path, /^\/+/, "")
    : null;
  if (!path) {
    return toolInput;
  }

  const canonicalCurrentPath = privateText.replace(defaultArtifacts.currentReportPath, /^\/+/, "");
  const canonicalRunPath = privateText.replace(defaultArtifacts.runReportPath, /^\/+/, "");
  const canonicalFindingsPath = privateText.replace(defaultArtifacts.findingsPath, /^\/+/, "");
  const canonicalSourcesPath = privateText.replace(defaultArtifacts.sourcesPath, /^\/+/, "");
  const canonicalTopicRootPath = privateText.replace(canonicalCurrentPath, /\/report\.md$/, "");

  if (
    path === canonicalCurrentPath || path === canonicalRunPath || path === canonicalFindingsPath ||
    path === canonicalSourcesPath
  ) {
    return toolInput;
  }

  if (path === `${canonicalTopicRootPath}.md`) {
    return {
      ...toolInput,
      path: canonicalCurrentPath,
    };
  }

  if (!privateText.endsWith(path, "/report.md") && path !== "report.md") {
    return toolInput;
  }

  return {
    ...toolInput,
    path: canonicalCurrentPath,
  };
}

/** Should retry create research artifact as update helper. */
export function shouldRetryCreateResearchArtifactAsUpdate(input: {
  toolName: string;
  toolInput: Record<string, unknown>;
  taskContext: DefaultResearchArtifactContext;
  error: unknown;
}): boolean {
  if (input.toolName !== "create_file") {
    return false;
  }

  const defaultArtifacts = input.taskContext.defaultResearchArtifacts;
  if (!isHostedChildCreateFileAlreadyExistsResult(input.error)) {
    return false;
  }

  const path = typeof input.toolInput.path === "string"
    ? privateText.replace(input.toolInput.path, /^\/+/, "")
    : null;
  const content = typeof input.toolInput.content === "string" ? input.toolInput.content : null;
  if (!path || !content) {
    return false;
  }

  if (!defaultArtifacts) {
    return privateText.startsWith(path, "research/") && privateText.endsWith(path, ".md");
  }

  const topicRootPath = privateText.replace(
    privateText.replace(defaultArtifacts.currentReportPath, /^\/+/, ""),
    /\/report\.md$/,
    "",
  );
  return path === topicRootPath || privateText.startsWith(path, `${topicRootPath}/`);
}

/** Mirror default research run artifact helper. */
export async function mirrorDefaultResearchRunArtifact(input: {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResult?: unknown;
  taskContext: DefaultResearchArtifactContext;
  activeProjectId: string | null;
  executeContext: Record<string, unknown> | undefined;
  executeTool: (
    toolName: string,
    args: Record<string, unknown>,
    context: Record<string, unknown> | undefined,
  ) => Promise<unknown>;
}): Promise<void> {
  if (input.toolName !== "create_file" && input.toolName !== "update_file") {
    return;
  }

  const content = typeof input.toolInput.content === "string" ? input.toolInput.content : null;
  const path = typeof input.toolInput.path === "string"
    ? privateText.replace(input.toolInput.path, /^\/+/, "")
    : null;
  const resultPath = extractToolResultPath(input.toolResult);
  const contextArtifacts = input.taskContext.defaultResearchArtifacts;
  const resultArtifacts = buildDefaultArtifactsFromResultPath({
    resultPath,
    parentRunId: input.taskContext.parentRunId,
  });
  const defaultArtifacts = resultArtifacts &&
      !currentReportPathMatches(contextArtifacts, resultPath)
    ? resultArtifacts
    : contextArtifacts ?? resultArtifacts;
  if (!defaultArtifacts) {
    return;
  }

  const canonicalCurrentPath = privateText.replace(defaultArtifacts.currentReportPath, /^\/+/, "");
  const canonicalRunPath = privateText.replace(defaultArtifacts.runReportPath, /^\/+/, "");

  if (!content || (path !== canonicalCurrentPath && resultPath !== canonicalCurrentPath)) {
    return;
  }

  const mirroredInput: Record<string, unknown> = {
    ...input.toolInput,
    path: canonicalRunPath,
  };

  if (input.activeProjectId) {
    mirroredInput.project_reference = input.activeProjectId;
  }

  try {
    await input.executeTool(input.toolName, mirroredInput, input.executeContext);
  } catch (error) {
    if (input.toolName === "create_file" && isHostedChildCreateFileAlreadyExistsResult(error)) {
      await input.executeTool("update_file", mirroredInput, input.executeContext);
      return;
    }
    throw error;
  }
}

/** Handler for create default research run artifact mirror. */
export function createDefaultResearchRunArtifactMirrorHandler(input: {
  taskContext: DefaultResearchArtifactContext;
  remoteToolSource?: Pick<RemoteToolSource, "executeTool"> | null;
}) {
  return async (request: {
    toolName: string;
    input: Record<string, unknown>;
    result: unknown;
    context?: Record<string, unknown>;
  }): Promise<void> => {
    const remoteToolSource = input.remoteToolSource;
    if (!remoteToolSource || isErroredToolExecutionResult(request.result)) {
      return;
    }

    const activeProjectId = typeof request.context?.projectId === "string"
      ? request.context.projectId
      : input.taskContext.projectId || null;

    await mirrorDefaultResearchRunArtifact({
      toolName: request.toolName,
      toolInput: toChildRunToolInputRecord(request.input),
      taskContext: input.taskContext,
      activeProjectId,
      executeContext: request.context,
      toolResult: request.result,
      executeTool: (nextToolName, nextArgs, nextContext) =>
        remoteToolSource.executeTool(nextToolName, nextArgs, nextContext),
    });
  };
}
