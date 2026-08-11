import { getConfig } from "veryfront/config";
import type { VeryfrontConfig } from "veryfront/config";

/**
 * Loads `veryfront.config` for a project, or `null` when it cannot be read.
 *
 * Doctor checks describe a project rather than run it, so a missing or broken
 * config is reported by the configuration check alone — every other check falls
 * back to framework defaults instead of failing.
 */
export async function loadConfigOrNull(projectDir: string): Promise<VeryfrontConfig | null> {
  try {
    const { runtime } = await import("veryfront/platform");
    const adapter = await runtime.get();
    return await getConfig(projectDir, adapter);
  } catch {
    return null;
  }
}
