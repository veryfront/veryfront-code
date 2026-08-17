import {
  type JsonSnapshotValue,
  readRecord,
  snapshotProviderJsonValue,
} from "veryfront/provider/shared";
import {
  createGoogleToolCallCorrelationRegistry,
  type GoogleSupportedPartDataField,
  readGoogleCodeExecutionResult,
  readGoogleExecutableCode,
  readGooglePartDataField,
} from "./google-content-parts.ts";

const GOOGLE_METADATA_KEY = "google";
const RAW_ASSISTANT_PARTS_KEY = "rawAssistantParts";
const GROUNDING_METADATA_KEY = "groundingMetadata";
const MAX_GOOGLE_RAW_ASSISTANT_PARTS = 4_096;
export const MAX_GOOGLE_PROVIDER_METADATA_BYTES = 8 * 1024 * 1024;
const GOOGLE_PROVIDER_METADATA_SNAPSHOT_OPTIONS = {
  maxDepth: 64,
  maxNodes: 65_536,
  maxBytes: MAX_GOOGLE_PROVIDER_METADATA_BYTES,
} as const;

function snapshotGoogleProviderMetadata(value: unknown): JsonSnapshotValue {
  return snapshotProviderJsonValue(value, GOOGLE_PROVIDER_METADATA_SNAPSHOT_OPTIONS);
}

function asSnapshotRecord(value: JsonSnapshotValue): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readGoogleMetadataNamespace(
  providerMetadata: Record<string, unknown>,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(
      providerMetadata,
      GOOGLE_METADATA_KEY,
    );
  } catch {
    throw new TypeError("Google provider metadata could not be inspected");
  }
  if (descriptor === undefined) {
    return undefined;
  }
  if (
    descriptor.enumerable !== true ||
    !Object.hasOwn(descriptor, "value")
  ) {
    throw new TypeError(
      "Google provider metadata namespace must be an enumerable data property",
    );
  }
  return descriptor.value;
}

function readGoogleRawPartsValue(
  googleMetadata: unknown,
): unknown {
  if (
    googleMetadata === null ||
    typeof googleMetadata !== "object" ||
    Array.isArray(googleMetadata)
  ) {
    throw new TypeError("Google provider metadata must be an object");
  }
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(
      googleMetadata,
      RAW_ASSISTANT_PARTS_KEY,
    );
  } catch {
    throw new TypeError("Google provider metadata could not be inspected");
  }
  if (descriptor === undefined) {
    return undefined;
  }
  if (
    descriptor.enumerable !== true ||
    !Object.hasOwn(descriptor, "value")
  ) {
    throw new TypeError(
      "Google raw assistant parts must be an enumerable data property",
    );
  }
  return descriptor.value;
}

function hasGoogleReplayTriggerProperty(
  part: object,
  key: "thoughtSignature" | "executableCode" | "codeExecutionResult",
): boolean {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(part, key);
  } catch {
    throw new TypeError("Google assistant part could not be inspected");
  }
  if (descriptor === undefined) {
    return false;
  }
  // An accessor might conceal a replay trigger. Treat it as present so the
  // descriptor-based snapshot rejects it without invoking caller code.
  return !Object.hasOwn(descriptor, "value") || descriptor.value !== undefined;
}

function needsGoogleExactReplay(
  parts: Array<Record<string, unknown>>,
): boolean {
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    lengthDescriptor = Object.getOwnPropertyDescriptor(parts, "length");
  } catch {
    throw new TypeError("Google assistant parts could not be inspected");
  }
  if (
    lengthDescriptor === undefined ||
    !Object.hasOwn(lengthDescriptor, "value") ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    throw new TypeError("Google assistant parts had an invalid length");
  }
  const partsLength = lengthDescriptor.value as number;
  let partKeys: (string | symbol)[];
  try {
    partKeys = Reflect.ownKeys(parts);
  } catch {
    throw new TypeError("Google assistant parts could not be inspected");
  }
  for (const partKey of partKeys) {
    if (partKey === "length" || typeof partKey !== "string") {
      continue;
    }
    const partIndex = Number(partKey);
    if (
      !Number.isSafeInteger(partIndex) ||
      partIndex < 0 ||
      partIndex >= partsLength ||
      String(partIndex) !== partKey
    ) {
      continue;
    }
    let partDescriptor: PropertyDescriptor | undefined;
    try {
      partDescriptor = Object.getOwnPropertyDescriptor(
        parts,
        partKey,
      );
    } catch {
      throw new TypeError("Google assistant parts could not be inspected");
    }
    if (partDescriptor === undefined) {
      throw new TypeError("Google assistant parts changed while being inspected");
    }
    if (!Object.hasOwn(partDescriptor, "value")) {
      // Force the protected snapshot path, which rejects array accessors
      // without invoking them.
      return true;
    }
    const part = partDescriptor.value;
    if (part === null || typeof part !== "object") {
      continue;
    }
    if (
      hasGoogleReplayTriggerProperty(part, "thoughtSignature") ||
      hasGoogleReplayTriggerProperty(part, "executableCode") ||
      hasGoogleReplayTriggerProperty(part, "codeExecutionResult")
    ) {
      return true;
    }
  }
  return false;
}

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
        (functionCall.args !== undefined && !readRecord(functionCall.args))
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
  const needsExactReplay = needsGoogleExactReplay(parts);
  if (!needsExactReplay && groundingMetadata === undefined) {
    return undefined;
  }
  let ownedParts: readonly Record<string, unknown>[] | undefined;
  if (needsExactReplay) {
    const partsSnapshot = snapshotGoogleProviderMetadata(parts);
    if (!Array.isArray(partsSnapshot)) {
      throw new TypeError("Google raw assistant parts must be an array");
    }
    if (partsSnapshot.length > MAX_GOOGLE_RAW_ASSISTANT_PARTS) {
      throw new TypeError(
        `Google raw assistant parts exceeded ${MAX_GOOGLE_RAW_ASSISTANT_PARTS} entries`,
      );
    }
    ownedParts = validateGoogleRawAssistantParts(
      partsSnapshot as readonly JsonSnapshotValue[],
    );
  }

  const metadata = snapshotGoogleProviderMetadata({
    [GOOGLE_METADATA_KEY]: {
      ...(needsExactReplay ? { [RAW_ASSISTANT_PARTS_KEY]: ownedParts } : {}),
      ...(groundingMetadata !== undefined ? { [GROUNDING_METADATA_KEY]: groundingMetadata } : {}),
    },
  });
  const metadataRecord = asSnapshotRecord(metadata);
  if (!metadataRecord) {
    throw new TypeError("Google provider metadata must be an object");
  }
  return metadataRecord;
}

function validateGoogleRawAssistantParts(
  rawParts: readonly JsonSnapshotValue[],
): readonly Record<string, unknown>[] {
  if (rawParts.length === 0) {
    throw new TypeError("Google raw assistant parts must be a non-empty array");
  }
  if (rawParts.length > MAX_GOOGLE_RAW_ASSISTANT_PARTS) {
    throw new TypeError(
      `Google raw assistant parts exceeded ${MAX_GOOGLE_RAW_ASSISTANT_PARTS} entries`,
    );
  }

  let hasThoughtSignature = false;
  let hasCodeExecution = false;
  const toolCallRegistry = createGoogleToolCallCorrelationRegistry();
  for (let partIndex = 0; partIndex < rawParts.length; partIndex += 1) {
    const rawPart = rawParts[partIndex];
    if (rawPart === undefined) {
      throw new TypeError("Google raw assistant parts must be dense");
    }
    const part = asSnapshotRecord(rawPart);
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
      try {
        toolCallRegistry.registerFunctionCall(partIndex, functionCallId);
      } catch {
        throw new TypeError("Google raw assistant tool call id was duplicated");
      }
    } else if (dataField === "executableCode") {
      const executableCode = readGoogleExecutableCode(part.executableCode);
      hasCodeExecution = true;
      try {
        toolCallRegistry.registerCodeExecution(executableCode.providerId);
      } catch {
        throw new TypeError("Google raw assistant executable code id was duplicated");
      }
    } else if (dataField === "codeExecutionResult") {
      const result = readGoogleCodeExecutionResult(part.codeExecutionResult);
      hasCodeExecution = true;
      try {
        toolCallRegistry.resolveCodeExecutionResult(result.providerId);
      } catch {
        throw new TypeError(
          result.providerId === undefined
            ? "Google raw assistant code execution result had no matching executable code"
            : "Google raw assistant code execution result id did not match executable code",
        );
      }
    }
  }

  if (!hasThoughtSignature && !hasCodeExecution) {
    throw new TypeError(
      "Google raw assistant parts contained neither a thought signature nor code execution",
    );
  }
  try {
    toolCallRegistry.assertSettled();
  } catch {
    throw new TypeError("Google raw assistant executable code had no matching result");
  }
  // Return the exact frozen snapshot array that was validated. Do not rebuild
  // a shallow collection whose contents could diverge before serialization.
  return rawParts as readonly Record<string, unknown>[];
}

export function readGoogleRawAssistantParts(
  providerMetadata: Record<string, unknown> | undefined,
): readonly Record<string, unknown>[] | undefined {
  if (providerMetadata === undefined) {
    return undefined;
  }
  const rawGoogleMetadata = readGoogleMetadataNamespace(providerMetadata);
  if (rawGoogleMetadata === undefined) {
    return undefined;
  }
  const rawParts = readGoogleRawPartsValue(rawGoogleMetadata);
  if (rawParts === undefined) {
    return undefined;
  }
  // Grounding and future Google metadata fields are not replayed. Snapshot
  // only the exact wire value that will be validated and transmitted so those
  // independent fields cannot consume replay budgets or invoke accessors.
  const rawPartsSnapshot = snapshotGoogleProviderMetadata(rawParts);
  if (!Array.isArray(rawPartsSnapshot)) {
    throw new TypeError("Google raw assistant parts must be a non-empty array");
  }
  return validateGoogleRawAssistantParts(
    rawPartsSnapshot as readonly JsonSnapshotValue[],
  );
}

/**
 * Remove provider tool parts that the runtime deliberately suppressed while
 * preserving the exact signed parts for every surviving Google tool call.
 */
export function reconcileGoogleProviderMetadata(
  providerMetadata: Record<string, unknown>,
  suppressedToolCalls: readonly { id: string; name: string }[],
): Record<string, unknown> | undefined {
  if (suppressedToolCalls.length === 0) {
    return providerMetadata;
  }

  const rawAssistantParts = readGoogleRawAssistantParts(providerMetadata);
  if (rawAssistantParts === undefined) {
    return providerMetadata;
  }

  const suppressedIds = new Set(suppressedToolCalls.map((toolCall) => toolCall.id));
  const matchedSuppressedIds = new Set<string>();
  const retainedParts: Record<string, unknown>[] = [];
  const registry = createGoogleToolCallCorrelationRegistry();
  let retainedToolPart = false;

  for (let partIndex = 0; partIndex < rawAssistantParts.length; partIndex += 1) {
    const part = rawAssistantParts[partIndex];
    if (part === undefined) {
      throw new TypeError("Google raw assistant parts must be dense");
    }

    const dataField = readGooglePartDataField(part);
    let toolCallId: string | undefined;
    if (dataField === "functionCall") {
      const functionCall = readRecord(part.functionCall);
      const providerId = typeof functionCall?.id === "string" ? functionCall.id : undefined;
      toolCallId = registry.registerFunctionCall(partIndex, providerId);
    } else if (dataField === "executableCode") {
      const executableCode = readGoogleExecutableCode(part.executableCode);
      toolCallId = registry.registerCodeExecution(executableCode.providerId);
    } else if (dataField === "codeExecutionResult") {
      const result = readGoogleCodeExecutionResult(part.codeExecutionResult);
      toolCallId = registry.resolveCodeExecutionResult(result.providerId);
    }

    if (toolCallId !== undefined && suppressedIds.has(toolCallId)) {
      matchedSuppressedIds.add(toolCallId);
      continue;
    }

    retainedParts.push(part);
    retainedToolPart ||= dataField === "functionCall" ||
      dataField === "executableCode" ||
      dataField === "codeExecutionResult";
  }

  registry.assertSettled();
  if (matchedSuppressedIds.size === 0) {
    return providerMetadata;
  }
  if (retainedParts.length === 0) {
    return undefined;
  }

  const reconciled = createGoogleProviderMetadata(retainedParts);
  if (reconciled === undefined && retainedToolPart) {
    throw new TypeError(
      "Google provider metadata could not preserve a surviving signed tool call",
    );
  }
  return reconciled;
}
