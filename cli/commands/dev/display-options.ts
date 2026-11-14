import { getHostEnvExcludingEnvFile } from "#cli/process-env";
import { getEnvSource } from "veryfront/utils/env-loader";

/**
 * A value the operator's process environment sets, trimmed, or undefined.
 * Values a project `.env` file copied into the environment do not count.
 */
export function processEnvValue(key: string): string | undefined {
  return getEnvSource(key).source === "process"
    ? getHostEnvExcludingEnvFile(key)?.trim() || undefined
    : undefined;
}

/** Capture operator display choices before importing the local project. */
export function captureDevDisplayOptions(): { studioUrl?: string; defaultModel?: string } {
  const studioUrl = processEnvValue("STUDIO_URL");
  const defaultModel = processEnvValue("VERYFRONT_DEFAULT_MODEL");
  return { ...(studioUrl ? { studioUrl } : {}), ...(defaultModel ? { defaultModel } : {}) };
}
