import type { ToolExecutionContext } from "#veryfront/tool";
import { toChildRunToolInputRecord } from "./child-run-execution-support.ts";

const TEXT_PROJECT_ARTIFACT_CUE_PATTERN =
  /\b(markdown|reference document|research report|report|write-up|writeup|save it to the project|save everything to the project|save the results to the project|compile everything into a single well-structured markdown file)\b/i;
const TEXT_PROJECT_ARTIFACT_PATH_PATTERN = /(?:^|[\s`"'(])(?:[\w./-]+\/)?[\w.-]+\.md\b/i;

const DEFAULT_WRITING_TOOL_NAMES = ["create_file", "update_file"];
const CREATE_FILE_ALREADY_EXISTS_PATTERN = /file already exists/i;
const TOOL_ERROR_VALUES = new Set(["error", "tool_error"]);
const MAX_NESTED_TOOL_RESULT_DEPTH = 8;

export interface HostedChildWrittenArtifactPathInput {
  toolName: string;
  toolInput: unknown;
  toolOutput: unknown;
  writingToolNames?: readonly string[];
}

export type HostedChildFileWriteFallbackToolExecute = (
  toolInput: unknown,
  execOptions?: ToolExecutionContext,
) => Promise<unknown> | unknown;

export interface HostedChildFileWriteFallbackTool {
  execute?: HostedChildFileWriteFallbackToolExecute;
}

export interface HostedChildFileWriteFallbackLogger {
  info?: (message: string, metadata?: Record<string, unknown>) => void;
}

export function withHostedChildRerunnableFileWriteFallbacks(input: {
  tools: Record<string, HostedChildFileWriteFallbackTool>;
  createToolName?: string;
  updateToolName?: string;
  logger?: HostedChildFileWriteFallbackLogger;
}): Record<string, HostedChildFileWriteFallbackTool> {
  const createToolName = input.createToolName ?? "create_file";
  const updateToolName = input.updateToolName ?? "update_file";
  const createFileTool = input.tools[createToolName];
  const updateFileTool = input.tools[updateToolName];

  if (!createFileTool?.execute || !updateFileTool?.execute) {
    return input.tools;
  }

  const createFileExecute = createFileTool.execute;
  const updateFileExecute = updateFileTool.execute;

  return {
    ...input.tools,
    [createToolName]: {
      ...createFileTool,
      execute: async (toolInput: unknown, execOptions?: ToolExecutionContext) => {
        const normalizedToolInput = toChildRunToolInputRecord(toolInput);
        const result = await createFileExecute(toolInput, execOptions);
        if (!isHostedChildCreateFileAlreadyExistsResult(result)) {
          return result;
        }

        const projectReference = normalizedToolInput.project_reference;
        const branchId = normalizedToolInput.branch_id;
        const path = normalizedToolInput.path;
        const content = normalizedToolInput.content;

        if (
          typeof projectReference !== "string" || typeof path !== "string" ||
          typeof content !== "string"
        ) {
          return result;
        }

        input.logger?.info?.(
          "Falling back from create_file to update_file for existing project artifact",
          {
            path,
          },
        );

        return updateFileExecute(
          {
            project_reference: projectReference,
            ...(typeof branchId === "string" ? { branch_id: branchId } : {}),
            path,
            content,
          },
          execOptions,
        );
      },
    },
  };
}

export function isHostedChildTextProjectArtifactPrompt(prompt: string): boolean {
  return TEXT_PROJECT_ARTIFACT_CUE_PATTERN.test(prompt) ||
    TEXT_PROJECT_ARTIFACT_PATH_PATTERN.test(prompt);
}

export function isHostedChildCreateFileAlreadyExistsResult(result: unknown): boolean {
  return isHostedChildCreateFileAlreadyExistsResultAtDepth(result, 0);
}

export function getHostedChildWrittenArtifactPath(
  input: HostedChildWrittenArtifactPathInput,
): string | null {
  const writingToolNames = input.writingToolNames ?? DEFAULT_WRITING_TOOL_NAMES;
  if (!writingToolNames.includes(input.toolName)) {
    return null;
  }

  if (isErrorToolOutput(input.toolOutput)) {
    return null;
  }

  if (!isRecord(input.toolInput)) {
    return null;
  }

  const path = input.toolInput.path;
  return typeof path === "string" ? normalizeHostedChildArtifactPath(path) : null;
}

export function normalizeHostedChildArtifactPath(path: string): string | null {
  const trimmedPath = path.trim().replace(/^[`"'(]+|[`"'),.;:!?]+$/g, "");
  if (trimmedPath.length === 0) {
    return null;
  }
  if (
    trimmedPath.includes("://") || trimmedPath === "/workspace" ||
    trimmedPath.startsWith("/workspace/")
  ) {
    return null;
  }

  const prefixedPath = trimmedPath.replace(/^\.\//, "/");
  const normalizedPath = (prefixedPath.startsWith("/") ? prefixedPath : `/${prefixedPath}`).replace(
    /\/{2,}/g,
    "/",
  );

  if (normalizedPath.split("/").includes("..")) {
    return null;
  }

  return normalizedPath;
}

function isHostedChildCreateFileAlreadyExistsResultAtDepth(
  result: unknown,
  depth: number,
): boolean {
  if (depth > MAX_NESTED_TOOL_RESULT_DEPTH || !isRecord(result)) {
    return false;
  }

  if (
    typeof result.message === "string" && CREATE_FILE_ALREADY_EXISTS_PATTERN.test(result.message)
  ) {
    return true;
  }

  if (
    result.output !== undefined &&
    isHostedChildCreateFileAlreadyExistsResultAtDepth(result.output, depth + 1)
  ) {
    return true;
  }

  return hasAlreadyExistsContentPart(result.content);
}

function hasAlreadyExistsContentPart(content: unknown): boolean {
  if (!Array.isArray(content)) {
    return false;
  }

  return content.some((part) => {
    if (!isRecord(part)) {
      return false;
    }

    return typeof part.text === "string" && CREATE_FILE_ALREADY_EXISTS_PATTERN.test(part.text);
  });
}

function isErrorToolOutput(output: unknown): boolean {
  if (!isRecord(output)) {
    return false;
  }

  if (output.isError === true) {
    return true;
  }

  return typeof output.error === "string" && TOOL_ERROR_VALUES.has(output.error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
