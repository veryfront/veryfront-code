import { createPrivateSet } from "#veryfront/security/private-set.ts";
import {
  isSupportedToolExposureCheckpointVersion,
  type ToolExposureCheckpoint,
} from "../runtime/tool-exposure.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Read the latest checkpoint overwritten by the authenticated server caller. */
export function getServerResolvedToolExposureCheckpoint(
  forwardedProps: Record<string, unknown> | undefined,
  serverEnvelopeVerified: boolean,
): ToolExposureCheckpoint | undefined {
  if (!serverEnvelopeVerified) return undefined;
  const value = forwardedProps?.serverResolvedToolExposureCheckpoint;
  if (
    !isRecord(value) ||
    !isSupportedToolExposureCheckpointVersion(value.version) ||
    !Array.isArray(value.loadedToolNames) ||
    !value.loadedToolNames.every((name) => typeof name === "string" && name.length > 0) ||
    createPrivateSet(value.loadedToolNames).size !== value.loadedToolNames.length
  ) {
    return undefined;
  }
  return {
    version: value.version,
    loadedToolNames: [...value.loadedToolNames],
  };
}
