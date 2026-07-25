import { readRecord } from "veryfront/provider/shared";
import {
  type GoogleSupportedPartDataField,
  readGoogleCodeExecutionResult,
  readGoogleExecutableCode,
  readGooglePartDataField,
} from "./google-content-parts.ts";

const GOOGLE_METADATA_KEY = "google";
const RAW_ASSISTANT_PARTS_KEY = "rawAssistantParts";
const GROUNDING_METADATA_KEY = "groundingMetadata";

function validateReplayableGooglePart(
  part: Record<string, unknown>,
): GoogleSupportedPartDataField {
  if (part.thought !== undefined && typeof part.thought !== "boolean") {
    throw new TypeError("Google raw assistant thought marker must be a boolean");
  }
  const dataField = readGooglePartDataField(part);
  switch (dataField) {
    case "text":
      if (typeof part.text !== "string") {
        throw new TypeError("Google raw assistant text must be a string");
      }
      break;
    case "functionCall": {
      const functionCall = readRecord(part.functionCall);
      if (
        !functionCall ||
        typeof functionCall.name !== "string" ||
        functionCall.name.length === 0 ||
        !readRecord(functionCall.args)
      ) {
        throw new TypeError("Google raw assistant function call is malformed");
      }
      if (
        functionCall.id !== undefined &&
        (typeof functionCall.id !== "string" || functionCall.id.length === 0)
      ) {
        throw new TypeError("Google raw assistant function call id is malformed");
      }
      break;
    }
    case "executableCode":
      readGoogleExecutableCode(part.executableCode);
      break;
    case "codeExecutionResult":
      readGoogleCodeExecutionResult(part.codeExecutionResult);
      break;
  }
  return dataField;
}

export function readGoogleThoughtSignature(
  part: Record<string, unknown>,
): string | undefined {
  const signature = part.thoughtSignature;
  if (signature === undefined) {
    return undefined;
  }
  if (typeof signature !== "string" || signature.length === 0) {
    throw new TypeError("Google thought signature must be a non-empty string");
  }
  return signature;
}

export function createGoogleProviderMetadata(
  parts: Array<Record<string, unknown>>,
  groundingMetadata?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const needsExactReplay = parts.some((part) =>
    readGoogleThoughtSignature(part) !== undefined ||
    part.executableCode !== undefined ||
    part.codeExecutionResult !== undefined
  );
  if (!needsExactReplay && groundingMetadata === undefined) {
    return undefined;
  }

  return {
    [GOOGLE_METADATA_KEY]: {
      ...(needsExactReplay ? { [RAW_ASSISTANT_PARTS_KEY]: parts } : {}),
      ...(groundingMetadata !== undefined ? { [GROUNDING_METADATA_KEY]: groundingMetadata } : {}),
    },
  };
}

export function readGoogleRawAssistantParts(
  providerMetadata: Record<string, unknown> | undefined,
): Array<Record<string, unknown>> | undefined {
  const rawGoogleMetadata = providerMetadata?.[GOOGLE_METADATA_KEY];
  if (rawGoogleMetadata === undefined) {
    return undefined;
  }
  const googleMetadata = readRecord(rawGoogleMetadata);
  if (!googleMetadata) {
    throw new TypeError("Google provider metadata must be an object");
  }
  const rawParts = googleMetadata?.[RAW_ASSISTANT_PARTS_KEY];
  if (rawParts === undefined) {
    return undefined;
  }
  if (!Array.isArray(rawParts) || rawParts.length === 0) {
    throw new TypeError("Google raw assistant parts must be a non-empty array");
  }

  const parts: Array<Record<string, unknown>> = [];
  let hasThoughtSignature = false;
  let hasCodeExecution = false;
  const pendingByProviderId = new Map<string, true>();
  const seenToolCallIds = new Set<string>();
  let pendingAnonymousExecutions = 0;
  for (const rawPart of rawParts) {
    const part = readRecord(rawPart);
    if (!part) {
      throw new TypeError("Google raw assistant part must be an object");
    }
    const dataField = validateReplayableGooglePart(part);
    if (readGoogleThoughtSignature(part) !== undefined) {
      hasThoughtSignature = true;
    }
    if (dataField === "functionCall") {
      const functionCall = readRecord(part.functionCall);
      const functionCallId = typeof functionCall?.id === "string" ? functionCall.id : undefined;
      if (functionCallId !== undefined) {
        if (seenToolCallIds.has(functionCallId)) {
          throw new TypeError("Google raw assistant tool call id was duplicated");
        }
        seenToolCallIds.add(functionCallId);
      }
    } else if (dataField === "executableCode") {
      const executableCode = readGoogleExecutableCode(part.executableCode);
      hasCodeExecution = true;
      if (executableCode.providerId === undefined) {
        pendingAnonymousExecutions += 1;
      } else {
        if (seenToolCallIds.has(executableCode.providerId)) {
          throw new TypeError("Google raw assistant executable code id was duplicated");
        }
        seenToolCallIds.add(executableCode.providerId);
        pendingByProviderId.set(executableCode.providerId, true);
      }
    } else if (dataField === "codeExecutionResult") {
      const result = readGoogleCodeExecutionResult(part.codeExecutionResult);
      hasCodeExecution = true;
      if (result.providerId === undefined) {
        if (pendingAnonymousExecutions === 0) {
          throw new TypeError(
            "Google raw assistant code execution result had no matching executable code",
          );
        }
        pendingAnonymousExecutions -= 1;
      } else if (!pendingByProviderId.delete(result.providerId)) {
        throw new TypeError(
          "Google raw assistant code execution result id did not match executable code",
        );
      }
    }
    parts.push(part);
  }

  if (!hasThoughtSignature && !hasCodeExecution) {
    throw new TypeError(
      "Google raw assistant parts contained neither a thought signature nor code execution",
    );
  }
  if (pendingByProviderId.size > 0 || pendingAnonymousExecutions > 0) {
    throw new TypeError("Google raw assistant executable code had no matching result");
  }
  return parts;
}
