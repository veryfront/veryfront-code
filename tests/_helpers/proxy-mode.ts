export const TEST_CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAfhOk6ZikxNjGIMFLYW4kpA+Kf01Delncn1qTke0Ifcg=
-----END PUBLIC KEY-----`;

const HOST_BINARY_TEST_ENV_BLOCKLIST = [
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
  for (const key of HOST_BINARY_TEST_ENV_BLOCKLIST) {
    delete sanitized[key];
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
