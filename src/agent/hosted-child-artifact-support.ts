const TEXT_PROJECT_ARTIFACT_CUE_PATTERN =
  /\b(markdown|reference document|research report|report|write-up|writeup|save it to the project|save everything to the project|save the results to the project|compile everything into a single well-structured markdown file)\b/i;
const TEXT_PROJECT_ARTIFACT_PATH_PATTERN = /(?:^|[\s`"'(])(?:[\w./-]+\/)?[\w.-]+\.md\b/i;

const DEFAULT_WRITING_TOOL_NAMES = ["create_file", "update_file"];
const CREATE_FILE_ALREADY_EXISTS_PATTERN = /file already exists/i;
const MAX_NESTED_TOOL_RESULT_DEPTH = 8;

export interface HostedChildWrittenArtifactPathInput {
  toolName: string;
  toolInput: unknown;
  toolOutput: unknown;
  writingToolNames?: readonly string[];
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
  const normalizedPath = prefixedPath.startsWith("/") ? prefixedPath : `/${prefixedPath}`;

  return normalizedPath.replace(/\/{2,}/g, "/");
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
  return isRecord(output) && output.isError === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
