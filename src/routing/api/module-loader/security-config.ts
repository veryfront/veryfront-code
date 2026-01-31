import { DEFAULT_ALLOWED_CDN_HOSTS, serverLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";

export async function loadSecurityConfig(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<string[]> {
  try {
    const { getConfig } = await import("#veryfront/config");
    const cfg: VeryfrontConfig = await getConfig(projectDir, adapter);
    const remote = cfg.security?.remoteHosts;

    if (Array.isArray(remote)) {
      return remote;
    }
  } catch (e) {
    logger.warn("Failed to load security.remoteHosts", e);
  }

  return DEFAULT_ALLOWED_CDN_HOSTS;
}
