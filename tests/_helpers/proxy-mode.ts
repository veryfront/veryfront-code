export const TEST_CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAfhOk6ZikxNjGIMFLYW4kpA+Kf01Delncn1qTke0Ifcg=
-----END PUBLIC KEY-----`;

const HOST_BINARY_TEST_ENV_BLOCKLIST = [
  "VERYFRONT_API_BASE_URL",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_API_KEY",
  "VF_CACHE_BACKEND",
  "VF_DISK_CACHE_DIR",
  "REDIS_URL",
  "CACHE_TYPE",
  "REDIS_PREFIX",
  "SSR_REDIS_CACHE_ENABLED",
  "VERYFRONT_BUNDLE_MANIFEST_REDIS_URL",
] as const;

export function withoutHostBinaryInfraEnv(
  env: Record<string, string>,
): Record<string, string> {
  const sanitized = { ...env };
  // Windows environment names are case-insensitive, so a credential spelled
  // veryfront_api_key would survive an exact-case delete. Match by folded name.
  const blocked = new Set<string>(HOST_BINARY_TEST_ENV_BLOCKLIST);
  for (const key of Object.keys(sanitized)) {
    if (blocked.has(key.toUpperCase())) delete sanitized[key];
  }
  return sanitized;
}

export function withProxyModeControlPlaneKey(
  env: Record<string, string>,
): Record<string, string> {
  if (env.PROXY_MODE !== "1" || env.CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY) {
    return env;
  }

  return {
    ...env,
    CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY: TEST_CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY_PEM,
  };
}
