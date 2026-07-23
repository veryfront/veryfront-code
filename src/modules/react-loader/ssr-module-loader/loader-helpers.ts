import { SERVICE_OVERLOADED } from "#veryfront/errors";

const MISSING_HTTP_BUNDLE_PATTERN = /veryfront-http-bundle\/http-([a-f0-9]{8,128})\.mjs/i;
const MAX_IMPORT_ERROR_MESSAGE_LENGTH = 4_096;

export type TransformCapacityErrorMode = "plain" | "build";

export type ImportErrorClassification =
  | { type: "http-bundle-missing"; hash: string; message: string }
  | { type: "module-not-found"; message: string }
  | { type: "unknown"; message: string };

export function classifyImportError(importError: unknown): ImportErrorClassification {
  let rawMessage: string;
  try {
    rawMessage = importError instanceof Error ? importError.message : String(importError);
  } catch {
    rawMessage = "Unknown import error";
  }
  const message = rawMessage.slice(0, MAX_IMPORT_ERROR_MESSAGE_LENGTH);
  const bundleMatch = message.match(MISSING_HTTP_BUNDLE_PATTERN);
  if (bundleMatch?.[1]) {
    return { type: "http-bundle-missing", hash: bundleMatch[1], message };
  }
  if (/cannot find module|module not found/i.test(message)) {
    return { type: "module-not-found", message };
  }
  return { type: "unknown", message };
}

export function createTransformCapacityError(
  mode: TransformCapacityErrorMode,
  message: string,
  _filePath: string,
): Error {
  if (mode === "plain") return new Error(message);
  return SERVICE_OVERLOADED.create({ detail: message });
}
