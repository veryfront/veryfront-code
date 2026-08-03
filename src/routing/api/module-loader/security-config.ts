import { DEFAULT_ALLOWED_CDN_HOSTS, serverLogger as logger } from "#veryfront/utils";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";

export async function loadSecurityConfig(
  projectDir: string,
  adapter: RuntimeAdapter,
  config?: VeryfrontConfig,
): Promise<string[]> {
  // A supplied config has already crossed the caller's trust boundary (for
  // example, authenticated hosted config). Keep that snapshot authoritative:
  // reloading here can either fail and broaden policy to the defaults or race a
  // different config version during the same request.
  if (config !== undefined) {
    return remoteHostsFromConfig(config);
  }

  try {
    const { getConfig } = await import("#veryfront/config");
    const cfg: VeryfrontConfig = await getConfig(projectDir, adapter);
    return remoteHostsFromConfig(cfg);
  } catch (e) {
    logger.warn("Failed to load security.remoteHosts", e);
  }

  return [...DEFAULT_ALLOWED_CDN_HOSTS];
}

function remoteHostsFromConfig(config: VeryfrontConfig): string[] {
  const remoteHosts = config.security?.remoteHosts;
  if (!Array.isArray(remoteHosts)) return [...DEFAULT_ALLOWED_CDN_HOSTS];

  if (remoteHosts.length === 0) {
    logger.warn(
      "security.remoteHosts is set to an empty array — all remote requests will be blocked. " +
        "If this is intentional, you can ignore this warning.",
    );
  }

  return [...remoteHosts];
}
