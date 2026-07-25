import type { ChatMessageMetadata, ChatUiMessageChunk } from "./protocol.ts";
import { lookup as lookupMediaType } from "#veryfront/platform/compat/media-types.ts";

const GET_FILE_TOOL_NAME = "get_file";
const KNOWLEDGE_PATH_PREFIX = "knowledge/";

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
    path.length === 0 ||
    !path.startsWith(KNOWLEDGE_PATH_PREFIX) ||
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
