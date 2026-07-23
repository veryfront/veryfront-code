import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry/general.ts";

/** Context fields the platform resolver can consume without depending on providers. */
export interface VeryfrontCloudContextSnapshot {
  readonly apiBaseUrl?: string;
  readonly apiToken?: string;
  readonly projectSlug?: string;
  readonly serviceLayer?: string;
}

export interface RuntimeConfigSnapshot {
  readonly fs?: {
    readonly veryfront?: { readonly apiToken?: string; readonly projectSlug?: string };
    readonly type?: string;
  };
  readonly projectSlug?: string;
}

interface RuntimeConfigProvider {
  getConfig(): unknown;
  isInitialized(): unknown;
}

type CloudContextProvider = () => unknown;

let cloudContextProvider: CloudContextProvider | undefined;
let runtimeConfigProvider: RuntimeConfigProvider | undefined;
let runtimeConfigProviderSource: RuntimeConfigProvider | undefined;

/** Register the higher-layer request-context accessor without creating a reverse import edge. */
export function registerVeryfrontCloudContextProvider(provider: CloudContextProvider): void {
  if (typeof provider !== "function") {
    throw INVALID_ARGUMENT.create({
      message: "Veryfront Cloud context provider must be a function",
    });
  }
  cloudContextProvider = provider;
}

/** Register the config-layer accessor without storing configuration on globalThis. */
export function registerRuntimeConfigProvider(provider: RuntimeConfigProvider): void {
  if (typeof provider !== "object" || provider === null) {
    throw INVALID_ARGUMENT.create({ message: "Runtime config provider is invalid" });
  }
  if (provider === runtimeConfigProviderSource) return;

  let getConfig: unknown;
  let isInitialized: unknown;
  try {
    getConfig = Reflect.get(provider, "getConfig");
    isInitialized = Reflect.get(provider, "isInitialized");
  } catch {
    throw INVALID_ARGUMENT.create({ message: "Runtime config provider is not readable" });
  }
  if (typeof getConfig !== "function" || typeof isInitialized !== "function") {
    throw INVALID_ARGUMENT.create({ message: "Runtime config provider is invalid" });
  }

  runtimeConfigProvider = Object.freeze({
    getConfig: () => Reflect.apply(getConfig, provider, []),
    isInitialized: () => Reflect.apply(isInitialized, provider, []),
  });
  runtimeConfigProviderSource = provider;
}

function readOptionalString(
  value: object,
  key: keyof VeryfrontCloudContextSnapshot,
): string | undefined {
  const field = readOwnField(value, key, "Veryfront Cloud context is not readable");
  if (field === undefined) return undefined;
  if (typeof field !== "string") {
    throw INVALID_ARGUMENT.create({ message: `Veryfront Cloud context ${key} must be a string` });
  }
  return field;
}

/** Read one immutable context snapshot from the currently registered higher layer. */
export function getRegisteredVeryfrontCloudContext(): VeryfrontCloudContextSnapshot | undefined {
  let context: unknown;
  try {
    context = cloudContextProvider?.();
  } catch {
    throw INVALID_ARGUMENT.create({ message: "Veryfront Cloud context is not readable" });
  }
  if (context === undefined) return undefined;
  if (typeof context !== "object" || context === null) {
    throw INVALID_ARGUMENT.create({ message: "Veryfront Cloud context must be an object" });
  }
  let contextIsArray: boolean;
  try {
    contextIsArray = Array.isArray(context);
  } catch {
    throw INVALID_ARGUMENT.create({ message: "Veryfront Cloud context is not readable" });
  }
  if (contextIsArray) {
    throw INVALID_ARGUMENT.create({ message: "Veryfront Cloud context must be an object" });
  }

  return Object.freeze({
    apiBaseUrl: readOptionalString(context, "apiBaseUrl"),
    apiToken: readOptionalString(context, "apiToken"),
    projectSlug: readOptionalString(context, "projectSlug"),
    serviceLayer: readOptionalString(context, "serviceLayer"),
  });
}

export function isRegisteredRuntimeConfigInitialized(): boolean {
  if (!runtimeConfigProvider) return false;

  let initialized: unknown;
  try {
    initialized = runtimeConfigProvider.isInitialized();
  } catch {
    throw INVALID_ARGUMENT.create({ message: "Runtime config provider is not readable" });
  }
  if (typeof initialized !== "boolean") {
    throw INVALID_ARGUMENT.create({ message: "Runtime config provider returned an invalid state" });
  }
  return initialized;
}

export function getRegisteredRuntimeConfig(): RuntimeConfigSnapshot {
  if (!runtimeConfigProvider) return Object.freeze({});

  let config: unknown;
  try {
    config = runtimeConfigProvider.getConfig();
  } catch {
    throw INVALID_ARGUMENT.create({ message: "Runtime config is not readable" });
  }
  if (typeof config !== "object" || config === null) {
    throw INVALID_ARGUMENT.create({
      message: "Runtime config provider returned an invalid config",
    });
  }
  let configIsArray: boolean;
  try {
    configIsArray = Array.isArray(config);
  } catch {
    throw INVALID_ARGUMENT.create({ message: "Runtime config is not readable" });
  }
  if (configIsArray) {
    throw INVALID_ARGUMENT.create({
      message: "Runtime config provider returned an invalid config",
    });
  }

  const projectSlug = readOptionalRuntimeString(config, "projectSlug");
  const fs = readOptionalRuntimeObject(config, "fs");
  if (fs === undefined) return Object.freeze({ projectSlug });

  const type = readOptionalRuntimeString(fs, "type");
  const veryfront = readOptionalRuntimeObject(fs, "veryfront");
  const veryfrontSnapshot = veryfront === undefined ? undefined : Object.freeze({
    apiToken: readOptionalRuntimeString(veryfront, "apiToken"),
    projectSlug: readOptionalRuntimeString(veryfront, "projectSlug"),
  });

  return Object.freeze({
    fs: Object.freeze({ type, veryfront: veryfrontSnapshot }),
    projectSlug,
  });
}

function readOptionalRuntimeObject(value: object, key: PropertyKey): object | undefined {
  const field = readOwnField(value, key, "Runtime config is not readable");
  if (field === undefined) return undefined;
  if (typeof field !== "object" || field === null) {
    throw INVALID_ARGUMENT.create({ message: "Runtime config contains an invalid object" });
  }
  let fieldIsArray: boolean;
  try {
    fieldIsArray = Array.isArray(field);
  } catch {
    throw INVALID_ARGUMENT.create({ message: "Runtime config is not readable" });
  }
  if (fieldIsArray) {
    throw INVALID_ARGUMENT.create({ message: "Runtime config contains an invalid object" });
  }
  return field;
}

function readOptionalRuntimeString(value: object, key: PropertyKey): string | undefined {
  const field = readOwnField(value, key, "Runtime config is not readable");
  if (field === undefined) return undefined;
  if (typeof field !== "string") {
    throw INVALID_ARGUMENT.create({ message: "Runtime config contains an invalid string" });
  }
  return field;
}

function readOwnField(value: object, key: PropertyKey, errorMessage: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Reflect.getOwnPropertyDescriptor(value, key);
  } catch {
    throw INVALID_ARGUMENT.create({ message: errorMessage });
  }
  if (!descriptor) return undefined;
  if ("value" in descriptor) return descriptor.value;
  if (!descriptor.get) return undefined;

  try {
    return Reflect.apply(descriptor.get, value, []);
  } catch {
    throw INVALID_ARGUMENT.create({ message: errorMessage });
  }
}
