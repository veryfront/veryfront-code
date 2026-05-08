import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import { isHostedChildCreateFileAlreadyExistsResult } from "./hosted-child-artifact-support.ts";
import {
  buildDefaultResearchArtifactPathReminder,
  buildDefaultResearchArtifactPaths,
  buildDefaultResearchArtifactPathsFromCurrentReportPath,
  type DefaultResearchArtifactPaths,
} from "./default-research-artifact-policy.ts";

export type DefaultResearchArtifacts = DefaultResearchArtifactPaths;

export interface DefaultResearchArtifactContext {
  availableToolNames?: string[];
  parentRunId?: string;
  defaultResearchArtifacts?: DefaultResearchArtifacts | null;
}

export interface DefaultResearchArtifactLogger {
  debug?: (message: string, metadata?: Record<string, unknown>) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractToolResultPath(result: unknown): string | null {
  if (!isRecord(result) || typeof result.path !== "string") {
    return null;
  }

  return result.path.replace(/^\/+/, "");
}

function isReportPath(path: string | null): path is string {
  return path !== null && (path === "report.md" || path.endsWith("/report.md"));
}

function currentReportPathMatches(
  artifacts: DefaultResearchArtifacts | null | undefined,
  path: string | null,
): boolean {
  if (!artifacts || !path) {
    return false;
  }

  return artifacts.currentReportPath.replace(/^\/+/, "") === path;
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

export function extractLatestUserText(messages: readonly unknown[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isRecord(message) || message.role !== "user") {
      continue;
    }

    const content = message.content;
    if (typeof content === "string" && content.trim().length > 0) {
      return content;
    }

    if (!Array.isArray(content)) {
      continue;
    }

    const text = content
      .flatMap((part) =>
        isRecord(part) && part.type === "text" && typeof part.text === "string"
          ? [part.text.trim()]
          : []
      )
      .filter((value) => value.length > 0)
      .join("\n");

    if (text.length > 0) {
      return text;
    }
  }

  return null;
}

function extractLatestUserDescription(text: string): string {
  const withoutCommandSpan = text.replace(
    /<span\s+data-command="[^"]+">\s*(\/[a-z0-9_-]+)\s*<\/span>/gi,
    "$1",
  );
  const withoutLeadingSlashCommand = withoutCommandSpan.replace(/^\s*\/[a-z0-9_-]+\s*/i, "");

  return withoutLeadingSlashCommand.trim();
}

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
    const messages = Array.isArray(data)
      ? data.map((message) => ({
        role: isRecord(message) ? message.role : undefined,
        content: isRecord(message) && Array.isArray(message.parts) ? message.parts : [],
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
    return instructions.includes(reminder) ? instructions : `${instructions}\n\n${reminder}`;
  }

  if (instructions.some((message) => message.content.includes(reminder))) {
    return instructions;
  }

  return [
    ...instructions,
    {
      role: "system",
      content: reminder,
    },
  ];
}

export function applyDefaultResearchArtifactPath(
  toolName: string,
  toolInput: Record<string, unknown>,
  taskContext: DefaultResearchArtifactContext,
): Record<string, unknown> {
  const defaultArtifacts = taskContext.defaultResearchArtifacts;
  if (!defaultArtifacts || (toolName !== "create_file" && toolName !== "update_file")) {
    return toolInput;
  }

  const path = typeof toolInput.path === "string" ? toolInput.path.replace(/^\/+/, "") : null;
  if (!path) {
    return toolInput;
  }

  const canonicalCurrentPath = defaultArtifacts.currentReportPath.replace(/^\/+/, "");
  const canonicalRunPath = defaultArtifacts.runReportPath.replace(/^\/+/, "");
  const canonicalFindingsPath = defaultArtifacts.findingsPath.replace(/^\/+/, "");
  const canonicalSourcesPath = defaultArtifacts.sourcesPath.replace(/^\/+/, "");

  if (
    path === canonicalCurrentPath || path === canonicalRunPath || path === canonicalFindingsPath ||
    path === canonicalSourcesPath
  ) {
    return toolInput;
  }

  if (!path.endsWith("/report.md") && path !== "report.md") {
    return toolInput;
  }

  return {
    ...toolInput,
    path: canonicalCurrentPath,
  };
}

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
    ? input.toolInput.path.replace(/^\/+/, "")
    : null;
  const content = typeof input.toolInput.content === "string" ? input.toolInput.content : null;
  if (!path || !content) {
    return false;
  }

  if (!defaultArtifacts) {
    return path.startsWith("research/") && path.endsWith(".md");
  }

  const topicRootPath = defaultArtifacts.currentReportPath.replace(/^\/+/, "").replace(
    /\/report\.md$/,
    "",
  );
  return path === topicRootPath || path.startsWith(`${topicRootPath}/`);
}

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
    ? input.toolInput.path.replace(/^\/+/, "")
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

  const canonicalCurrentPath = defaultArtifacts.currentReportPath.replace(/^\/+/, "");
  const canonicalRunPath = defaultArtifacts.runReportPath.replace(/^\/+/, "");

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
