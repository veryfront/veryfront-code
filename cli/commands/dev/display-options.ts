import { getHostEnvExcludingEnvFile } from "#cli/process-env";
import { getEnvSource } from "veryfront/utils/env-loader";

/** Capture operator display choices before importing the local project. */
export function captureDevDisplayOptions(): { studioUrl?: string; defaultModel?: string } {
  const processValue = (key: string): string | undefined =>
    getEnvSource(key).source === "process"
      ? getHostEnvExcludingEnvFile(key)?.trim() || undefined
      : undefined;
  const studioUrl = processValue("STUDIO_URL");
  const defaultModel = processValue("VERYFRONT_DEFAULT_MODEL");
  return { ...(studioUrl ? { studioUrl } : {}), ...(defaultModel ? { defaultModel } : {}) };
}
