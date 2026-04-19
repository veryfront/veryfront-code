import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

const MISSING_HTTP_BUNDLE_PATTERN = /veryfront-http-bundle\/http-([a-f0-9]+)\.mjs/;

export type TransformCapacityErrorMode = "plain" | "build";

export type ImportErrorClassification =
  | { type: "http-bundle-missing"; hash: string; message: string }
  | { type: "module-not-found"; message: string }
  | { type: "unknown"; message: string };

export function classifyImportError(importError: unknown): ImportErrorClassification {
  const message = importError instanceof Error ? importError.message : String(importError);
  const bundleMatch = message.match(MISSING_HTTP_BUNDLE_PATTERN);
  if (bundleMatch?.[1]) {
    return { type: "http-bundle-missing", hash: bundleMatch[1], message };
  }
  if (message.includes("Cannot find module") || message.includes("Module not found")) {
    return { type: "module-not-found", message };
  }
  return { type: "unknown", message };
}

export function createTransformCapacityError(
  mode: TransformCapacityErrorMode,
  message: string,
  filePath: string,
): Error {
  if (mode === "plain") return new Error(message);
  return toError(
    createError({
      type: "build",
      message,
      context: { file: filePath, phase: "transform" },
    }),
  );
}
