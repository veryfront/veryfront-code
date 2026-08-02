import { readRecord } from "veryfront/provider/shared";

export type AnthropicCitation = {
  type:
    | "char_location"
    | "page_location"
    | "content_block_location"
    | "web_search_result_location"
    | "search_result_location";
  citedText: string;
  url?: string;
  title?: string;
  encryptedIndex?: string;
  source?: string;
  fileId?: string;
  startCharIndex?: number;
  endCharIndex?: number;
  startBlockIndex?: number;
  endBlockIndex?: number;
  startPageNumber?: number;
  endPageNumber?: number;
  documentIndex?: number;
  documentTitle?: string;
  searchResultIndex?: number;
};

function readRequiredString(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = record[field];
  return typeof value === "string" ? value : undefined;
}

function readOptionalNullableString(
  record: Record<string, unknown>,
  field: string,
): string | null | undefined {
  const value = record[field];
  return value === undefined || value === null || typeof value === "string" ? value : undefined;
}

function readNonNegativeInteger(
  record: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = record[field];
  return typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ? value
    : undefined;
}

function hasValidOptionalNullableString(
  record: Record<string, unknown>,
  field: string,
): boolean {
  return record[field] === undefined ||
    record[field] === null ||
    typeof record[field] === "string";
}

function withOptionalString(
  key: "title" | "fileId" | "documentTitle",
  value: string | null | undefined,
): Partial<AnthropicCitation> {
  return typeof value === "string" ? { [key]: value } : {};
}

/**
 * Validates and normalizes the current Messages API citation union.
 *
 * Citation records are provider-controlled protocol data. Returning
 * `undefined` for any malformed or unknown variant lets callers fail the
 * successful response closed instead of silently discarding attribution.
 */
export function normalizeAnthropicCitation(
  raw: unknown,
): AnthropicCitation | undefined {
  const record = readRecord(raw);
  if (!record || typeof record.type !== "string") return undefined;

  const citedText = readRequiredString(record, "cited_text");
  if (citedText === undefined) return undefined;

  if (record.type === "web_search_result_location") {
    const url = readRequiredString(record, "url");
    const encryptedIndex = readRequiredString(record, "encrypted_index");
    const title = readOptionalNullableString(record, "title");
    if (
      url === undefined ||
      encryptedIndex === undefined ||
      !hasValidOptionalNullableString(record, "title")
    ) {
      return undefined;
    }
    return {
      type: record.type,
      citedText,
      url,
      encryptedIndex,
      ...withOptionalString("title", title),
    };
  }

  if (record.type === "search_result_location") {
    const source = readRequiredString(record, "source");
    const title = readOptionalNullableString(record, "title");
    const searchResultIndex = readNonNegativeInteger(record, "search_result_index");
    const startBlockIndex = readNonNegativeInteger(record, "start_block_index");
    const endBlockIndex = readNonNegativeInteger(record, "end_block_index");
    if (
      source === undefined ||
      searchResultIndex === undefined ||
      startBlockIndex === undefined ||
      endBlockIndex === undefined ||
      endBlockIndex <= startBlockIndex ||
      !hasValidOptionalNullableString(record, "title")
    ) {
      return undefined;
    }
    return {
      type: record.type,
      citedText,
      source,
      searchResultIndex,
      startBlockIndex,
      endBlockIndex,
      ...withOptionalString("title", title),
    };
  }

  const documentIndex = readNonNegativeInteger(record, "document_index");
  const documentTitle = readOptionalNullableString(record, "document_title");
  const fileId = readOptionalNullableString(record, "file_id");
  if (
    documentIndex === undefined ||
    !hasValidOptionalNullableString(record, "document_title") ||
    !hasValidOptionalNullableString(record, "file_id")
  ) {
    return undefined;
  }

  const common = {
    citedText,
    documentIndex,
    ...withOptionalString("documentTitle", documentTitle),
    ...withOptionalString("fileId", fileId),
  };

  if (record.type === "char_location") {
    const startCharIndex = readNonNegativeInteger(record, "start_char_index");
    const endCharIndex = readNonNegativeInteger(record, "end_char_index");
    return startCharIndex !== undefined &&
        endCharIndex !== undefined &&
        endCharIndex >= startCharIndex
      ? {
        type: record.type,
        ...common,
        startCharIndex,
        endCharIndex,
      }
      : undefined;
  }

  if (record.type === "page_location") {
    const startPageNumber = readNonNegativeInteger(record, "start_page_number");
    const endPageNumber = readNonNegativeInteger(record, "end_page_number");
    return startPageNumber !== undefined &&
        endPageNumber !== undefined &&
        endPageNumber >= startPageNumber
      ? {
        type: record.type,
        ...common,
        startPageNumber,
        endPageNumber,
      }
      : undefined;
  }

  if (record.type === "content_block_location") {
    const startBlockIndex = readNonNegativeInteger(record, "start_block_index");
    const endBlockIndex = readNonNegativeInteger(record, "end_block_index");
    return startBlockIndex !== undefined &&
        endBlockIndex !== undefined &&
        endBlockIndex > startBlockIndex
      ? {
        type: record.type,
        ...common,
        startBlockIndex,
        endBlockIndex,
      }
      : undefined;
  }

  return undefined;
}
