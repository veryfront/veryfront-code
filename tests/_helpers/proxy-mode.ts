export const TEST_CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAfhOk6ZikxNjGIMFLYW4kpA+Kf01Delncn1qTke0Ifcg=
-----END PUBLIC KEY-----`;

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
