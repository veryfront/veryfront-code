import { readRecord } from "veryfront/provider/shared";

export const GOOGLE_CODE_EXECUTION_TOOL_NAME = "code_execution";

const GOOGLE_PART_DATA_FIELDS = [
  "text",
  "inlineData",
  "functionCall",
  "functionResponse",
  "fileData",
  "executableCode",
  "codeExecutionResult",
  "toolCall",
  "toolResponse",
] as const;

const GOOGLE_PART_METADATA_FIELDS = new Set([
  "mediaResolution",
  "partMetadata",
  "thought",
  "thoughtSignature",
  "videoMetadata",
]);

export type GoogleSupportedPartDataField =
  | "text"
  | "functionCall"
  | "executableCode"
  | "codeExecutionResult";

export type GoogleExecutableCode = {
  providerId?: string;
  language: "PYTHON";
  code: string;
};

export type GoogleCodeExecutionResult = {
  providerId?: string;
  outcome: "OUTCOME_OK" | "OUTCOME_FAILED" | "OUTCOME_DEADLINE_EXCEEDED";
  output: string;
  isError: boolean;
};

/**
 * Validates the documented `Part.data` oneof and returns the supported field.
 *
 * The extension intentionally fails closed for media/file/function-response
 * output parts until it has a canonical runtime representation for them.
 */
export function readGooglePartDataField(
  part: Record<string, unknown>,
): GoogleSupportedPartDataField {
  const unknownField = Object.keys(part).find((field) =>
    !GOOGLE_PART_DATA_FIELDS.includes(
      field as (typeof GOOGLE_PART_DATA_FIELDS)[number],
    ) && !GOOGLE_PART_METADATA_FIELDS.has(field)
  );
  if (unknownField !== undefined) {
    throw new TypeError(`Google part field "${unknownField}" is unknown`);
  }

  const presentFields = GOOGLE_PART_DATA_FIELDS.filter((field) => part[field] !== undefined);
  if (presentFields.length !== 1) {
    throw new TypeError("Google part must contain exactly one data field");
  }

  const field = presentFields[0];
  switch (field) {
    case "text":
    case "functionCall":
    case "executableCode":
    case "codeExecutionResult":
      return field;
    default:
      throw new TypeError(`Google part data field "${field}" is unsupported`);
  }
}

function readOptionalProviderId(
  record: Record<string, unknown>,
  subject: string,
): string | undefined {
  if (record.id === undefined) {
    return undefined;
  }
  if (typeof record.id !== "string" || record.id.length === 0) {
    throw new TypeError(`Google ${subject} id must be a non-empty string`);
  }
  return record.id;
}

export function readGoogleExecutableCode(value: unknown): GoogleExecutableCode {
  const record = readRecord(value);
  if (
    !record ||
    record.language !== "PYTHON" ||
    typeof record.code !== "string" ||
    record.code.length === 0
  ) {
    throw new TypeError("Google executable code is malformed");
  }

  const providerId = readOptionalProviderId(record, "executable code");
  return {
    ...(providerId !== undefined ? { providerId } : {}),
    language: "PYTHON",
    code: record.code,
  };
}

export function readGoogleCodeExecutionResult(value: unknown): GoogleCodeExecutionResult {
  const record = readRecord(value);
  if (!record) {
    throw new TypeError("Google code execution result is malformed");
  }

  const providerId = readOptionalProviderId(record, "code execution result");
  const outcome = record.outcome;
  if (
    outcome !== "OUTCOME_OK" &&
    outcome !== "OUTCOME_FAILED" &&
    outcome !== "OUTCOME_DEADLINE_EXCEEDED"
  ) {
    throw new TypeError("Google code execution result outcome is malformed");
  }
  if (record.output !== undefined && typeof record.output !== "string") {
    throw new TypeError("Google code execution result output is malformed");
  }

  return {
    ...(providerId !== undefined ? { providerId } : {}),
    outcome,
    output: typeof record.output === "string" ? record.output : "",
    isError: outcome !== "OUTCOME_OK",
  };
}

export function googleCodeExecutionInput(
  executableCode: GoogleExecutableCode,
): { language: "PYTHON"; code: string } {
  return {
    language: executableCode.language,
    code: executableCode.code,
  };
}

export function googleCodeExecutionOutput(
  result: GoogleCodeExecutionResult,
): {
  outcome: GoogleCodeExecutionResult["outcome"];
  output: string;
} {
  return {
    outcome: result.outcome,
    output: result.output,
  };
}
