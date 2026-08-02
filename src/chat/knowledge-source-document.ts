import type { ChatMessageMetadata, ChatUiMessageChunk } from "./protocol.ts";
import { lookup as lookupMediaType } from "#veryfront/platform/compat/media-types.ts";

const GET_FILE_TOOL_NAME = "get_file";
const KNOWLEDGE_PATH_PREFIX = "knowledge/";
const MAX_KNOWLEDGE_PATH_LENGTH = 4_096;

type SourceDocumentChunk = Extract<
  ChatUiMessageChunk<ChatMessageMetadata>,
  { type: "source-document" }
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveStructuredOutput(output: unknown): Record<string, unknown> | null {
  if (!isRecord(output)) {
    return null;
  }

  if (isRecord(output.structuredContent)) {
    return output.structuredContent;
  }

  if (isRecord(output.structured_content)) {
    return output.structured_content;
  }

  return output;
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) {
      return true;
    }
  }
  return false;
}

function isCanonicalKnowledgePath(path: string): boolean {
  if (
    path.length <= KNOWLEDGE_PATH_PREFIX.length ||
    path.length > MAX_KNOWLEDGE_PATH_LENGTH ||
    path.trim() !== path ||
    !path.startsWith(KNOWLEDGE_PATH_PREFIX) ||
    path.includes("\\") ||
    containsControlCharacter(path)
  ) {
    return false;
  }

  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      return false;
    }

    try {
      const decoded = decodeURIComponent(segment);
      if (
        decoded === "." ||
        decoded === ".." ||
        decoded.includes("/") ||
        decoded.includes("\\") ||
        containsControlCharacter(decoded)
      ) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

/** Derive an exact structured citation from a successful project knowledge file read. */
export function deriveKnowledgeSourceDocumentChunk(input: {
  toolName: string | undefined;
  output: unknown;
}): SourceDocumentChunk | null {
  if (input.toolName !== GET_FILE_TOOL_NAME) {
    return null;
  }

  const output = resolveStructuredOutput(input.output);
  const path = output?.path;
  const content = output?.content;
  if (
    typeof path !== "string" ||
    !isCanonicalKnowledgePath(path) ||
    typeof content !== "string"
  ) {
    return null;
  }

  return {
    type: "source-document",
    sourceId: path,
    mediaType: lookupMediaType(path) ?? "text/plain",
    title: path,
    filename: path,
  };
}
