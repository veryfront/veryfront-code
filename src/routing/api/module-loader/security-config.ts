import { DEFAULT_ALLOWED_CDN_HOSTS, serverLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";

export async function loadSecurityConfig(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<string[]> {
  const { getConfig } = await import("#veryfront/config");
  const cfg: VeryfrontConfig = await getConfig(projectDir, adapter);
  const remote = cfg.security?.remoteHosts;

  if (Array.isArray(remote)) {
    if (remote.length === 0) {
      logger.warn(
        "security.remoteHosts is empty. Veryfront blocks all remote module imports.",
      );
    }
    return [...remote];
  }

  return [...DEFAULT_ALLOWED_CDN_HOSTS];
}
