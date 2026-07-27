import type { AuthProvider } from "#veryfront/extensions/auth/index.ts";

const AUTH_PROVIDER_METHODS = [
  "sign",
  "verify",
  "verifyWithJwks",
  "verifyWithPublicKey",
  "decode",
] as const satisfies readonly (keyof AuthProvider)[];
const EMPTY_AUTH_PROVIDER_OPTIONS = Object.freeze({});

function requireOwnFunction(
  value: object,
  key: string,
  label: string,
): (...args: never[]) => unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch (error) {
    throw new TypeError(`${label} is unreadable`, { cause: error });
  }
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
    throw new TypeError(`${label} must be an own data function`);
  }
  return descriptor.value as (...args: never[]) => unknown;
}

export function createProxyAuthProvider(
  extensionModule: unknown,
): AuthProvider {
  if (
    !extensionModule ||
    typeof extensionModule !== "object" ||
    Array.isArray(extensionModule)
  ) {
    throw new TypeError("Proxy auth extension module is invalid");
  }
  const createAuthProvider = requireOwnFunction(
    extensionModule,
    "createAuthProvider",
    "Proxy auth extension createAuthProvider export",
  );

  const provider = Reflect.apply(
    createAuthProvider,
    undefined,
    [EMPTY_AUTH_PROVIDER_OPTIONS],
  ) as unknown;
  if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
    throw new TypeError("Proxy auth extension returned an invalid AuthProvider");
  }
  for (const method of AUTH_PROVIDER_METHODS) {
    requireOwnFunction(
      provider,
      method,
      `Proxy AuthProvider ${method}`,
    );
  }
  return Object.freeze(provider) as AuthProvider;
}
