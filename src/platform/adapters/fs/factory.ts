import type {
  FSAdapter,
  FSAdapterConfig,
  InvalidationCallbacks,
  StyleCallbacks,
} from "./veryfront/types.ts";
import { CONFIG_INVALID } from "#veryfront/errors/error-registry/config.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const SAFE_TYPE_NAME = /^[a-z][a-z0-9-]{0,31}$/;
const INVALIDATION_CALLBACK_KEYS = [
  "clearSSRModuleCache",
  "clearSSRModuleCacheForProject",
  "clearRouterDetectionCacheForProject",
  "clearModulePathCache",
  "invalidateModulePaths",
  "clearSnippetCacheForProject",
  "triggerReload",
  "clearRendererCacheForProject",
  "clearProjectCSSCache",
  "clearDomainCache",
  "evictCurrentAdapter",
] as const satisfies readonly (keyof InvalidationCallbacks)[];

function invalidConfig(detail: string): never {
  throw CONFIG_INVALID.create({ detail });
}

function assertReadableObject(value: unknown, label: string): asserts value is object {
  if (typeof value !== "object" || value === null) {
    invalidConfig(`${label} must be an object`);
  }
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    invalidConfig(`${label} is not readable`);
  }
  if (isArray) invalidConfig(`${label} must be an object`);
}

function readProperty(value: object, property: PropertyKey, label: string): unknown {
  try {
    return Reflect.get(value, property);
  } catch {
    invalidConfig(`${label} is not readable`);
  }
}

function snapshotFunctionMap<T extends object>(
  value: unknown,
  label: string,
  keys: readonly PropertyKey[],
): T | undefined {
  if (value === undefined) return undefined;
  assertReadableObject(value, label);
  const snapshot: Record<PropertyKey, unknown> = {};
  for (const key of keys) {
    const callback = readProperty(value, key, label);
    if (callback !== undefined && typeof callback !== "function") {
      invalidConfig(`${label} callbacks must be functions`);
    }
    if (callback !== undefined) snapshot[key] = callback;
  }
  return Object.freeze(snapshot) as T;
}

function snapshotObjectProperties(
  value: unknown,
  label: string,
  keys: readonly PropertyKey[],
): Readonly<Record<PropertyKey, unknown>> | undefined {
  if (value === undefined) return undefined;
  assertReadableObject(value, label);
  const snapshot: Record<PropertyKey, unknown> = {};
  for (const key of keys) {
    const propertyValue = readProperty(value, key, label);
    if (propertyValue !== undefined) snapshot[key] = propertyValue;
  }
  return Object.freeze(snapshot);
}

function snapshotVeryfrontConfig(value: unknown): {
  readonly config: FSAdapterConfig["veryfront"];
  readonly proxyMode: boolean;
} {
  if (value === undefined) return { config: undefined, proxyMode: false };
  assertReadableObject(value, "Veryfront filesystem configuration");

  const proxyMode = readProperty(value, "proxyMode", "Veryfront filesystem configuration");
  if (proxyMode !== undefined && typeof proxyMode !== "boolean") {
    invalidConfig("Veryfront filesystem proxyMode must be a boolean");
  }
  const contentSource = snapshotObjectProperties(
    readProperty(value, "contentSource", "Veryfront filesystem configuration"),
    "Veryfront filesystem content source",
    ["type", "branch", "name", "domain", "releaseId"],
  );
  const cache = snapshotObjectProperties(
    readProperty(value, "cache", "Veryfront filesystem configuration"),
    "Veryfront filesystem cache configuration",
    ["enabled", "ttl"],
  );
  const retry = snapshotObjectProperties(
    readProperty(value, "retry", "Veryfront filesystem configuration"),
    "Veryfront filesystem retry configuration",
    ["maxRetries", "initialDelay", "maxDelay", "retryDelay"],
  );

  return {
    proxyMode: proxyMode ?? false,
    config: Object.freeze({
      apiToken: readProperty(value, "apiToken", "Veryfront filesystem configuration") as
        | string
        | undefined,
      projectSlug: readProperty(value, "projectSlug", "Veryfront filesystem configuration") as
        | string
        | undefined,
      projectId: readProperty(value, "projectId", "Veryfront filesystem configuration") as
        | string
        | undefined,
      apiBaseUrl: readProperty(value, "apiBaseUrl", "Veryfront filesystem configuration") as
        | string
        | undefined,
      proxyMode: proxyMode as boolean | undefined,
      contentSource: contentSource as FSAdapterConfig["veryfront"] extends infer V
        ? V extends { contentSource?: infer C } ? C
        : never
        : never,
      cache: cache as FSAdapterConfig["veryfront"] extends infer V
        ? V extends { cache?: infer C } ? C
        : never
        : never,
      retry: retry as FSAdapterConfig["veryfront"] extends infer V
        ? V extends { retry?: infer R } ? R
        : never
        : never,
    }),
  };
}

function snapshotGitHubConfig(value: unknown): FSAdapterConfig["github"] {
  if (value === undefined) return undefined;
  assertReadableObject(value, "GitHub filesystem configuration");
  const cache = snapshotObjectProperties(
    readProperty(value, "cache", "GitHub filesystem configuration"),
    "GitHub filesystem cache configuration",
    ["enabled", "ttl", "maxSize", "maxMemory"],
  );
  const retry = snapshotObjectProperties(
    readProperty(value, "retry", "GitHub filesystem configuration"),
    "GitHub filesystem retry configuration",
    [
      "maxRetries",
      "initialDelay",
      "maxDelay",
      "requestTimeout",
      "totalTimeout",
      "maxResponseBytes",
    ],
  );

  return Object.freeze({
    token: readProperty(value, "token", "GitHub filesystem configuration") as string,
    owner: readProperty(value, "owner", "GitHub filesystem configuration") as string,
    repo: readProperty(value, "repo", "GitHub filesystem configuration") as string,
    ref: readProperty(value, "ref", "GitHub filesystem configuration") as string | undefined,
    cache: cache as NonNullable<FSAdapterConfig["github"]>["cache"],
    retry: retry as NonNullable<FSAdapterConfig["github"]>["retry"],
  });
}

function snapshotMemoryConfig(value: unknown): FSAdapterConfig["memory"] {
  if (value === undefined) return undefined;
  assertReadableObject(value, "Memory filesystem configuration");
  const files = readProperty(value, "files", "Memory filesystem configuration");
  if (files === undefined) return Object.freeze({});
  assertReadableObject(files, "Memory filesystem files");

  let paths: string[];
  try {
    paths = Object.keys(files);
  } catch {
    invalidConfig("Memory filesystem files are not readable");
  }

  const snapshot = Object.create(null) as Record<string, string | Uint8Array>;
  for (const path of paths) {
    const content = readProperty(files, path, "Memory filesystem files");
    if (typeof content === "string") {
      Object.defineProperty(snapshot, path, {
        enumerable: true,
        value: content,
      });
      continue;
    }
    if (content instanceof Uint8Array) {
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(content);
      } catch {
        invalidConfig("Memory filesystem file content is not readable");
      }
      Object.defineProperty(snapshot, path, {
        enumerable: true,
        value: bytes,
      });
      continue;
    }
    invalidConfig("Memory filesystem file content must be a string or Uint8Array");
  }

  return Object.freeze({ files: Object.freeze(snapshot) });
}

function snapshotConfig(input: unknown): {
  readonly type: NonNullable<FSAdapterConfig["type"]>;
  readonly proxyMode: boolean;
  readonly config: FSAdapterConfig;
} {
  assertReadableObject(input, "Filesystem adapter configuration");
  const typeInput = readProperty(input, "type", "Filesystem adapter configuration");
  const type = typeInput ?? "local";
  if (typeof type !== "string") invalidConfig("Filesystem adapter type must be a string");

  if (type !== "local" && type !== "veryfront-api" && type !== "github" && type !== "memory") {
    const typeDescription = SAFE_TYPE_NAME.test(type) ? ` \"${type}\"` : "";
    invalidConfig(
      `FSAdapter type${typeDescription} is not implemented. Supported types: \"local\" (default, uses RuntimeAdapter.fs), \"veryfront-api\", \"github\", \"memory\".`,
    );
  }

  if (type === "local") {
    return { type, proxyMode: false, config: Object.freeze({ type }) };
  }

  const projectDir = readProperty(input, "projectDir", "Filesystem adapter configuration");
  if (projectDir !== undefined && (typeof projectDir !== "string" || projectDir.length > 4_096)) {
    invalidConfig("Filesystem adapter projectDir must be a string of at most 4096 characters");
  }

  if (type === "github") {
    return {
      type,
      proxyMode: false,
      config: Object.freeze({
        type,
        projectDir: projectDir as string | undefined,
        github: snapshotGitHubConfig(
          readProperty(input, "github", "Filesystem adapter configuration"),
        ),
      }),
    };
  }

  if (type === "memory") {
    return {
      type,
      proxyMode: false,
      config: Object.freeze({
        type,
        projectDir: projectDir as string | undefined,
        memory: snapshotMemoryConfig(
          readProperty(input, "memory", "Filesystem adapter configuration"),
        ),
      }),
    };
  }

  const veryfront = snapshotVeryfrontConfig(
    readProperty(input, "veryfront", "Filesystem adapter configuration"),
  );
  const invalidationCallbacks = snapshotFunctionMap<InvalidationCallbacks>(
    readProperty(input, "invalidationCallbacks", "Filesystem adapter configuration"),
    "Filesystem invalidation callbacks",
    INVALIDATION_CALLBACK_KEYS,
  );
  const styleCallbacks = snapshotFunctionMap<StyleCallbacks>(
    readProperty(input, "styleCallbacks", "Filesystem adapter configuration"),
    "Filesystem style callbacks",
    ["pregenerateStyles"],
  );

  return {
    type,
    proxyMode: veryfront.proxyMode,
    config: Object.freeze({
      type,
      projectDir: projectDir as string | undefined,
      veryfront: veryfront.config,
      invalidationCallbacks,
      styleCallbacks,
    }),
  };
}

export async function createFSAdapter(config: FSAdapterConfig): Promise<FSAdapter> {
  const snapshot = snapshotConfig(config);
  const { type, proxyMode } = snapshot;

  return await withSpan(
    "platform.fs.createAdapter",
    async () => {
      if (type === "local") {
        invalidConfig(
          `FSAdapter type "local" should not use this factory. ` +
            `Use RuntimeAdapter.fs directly for local filesystem access. ` +
            `If you see this error, check your veryfront.config.ts fs configuration.`,
        );
      }

      if (type === "veryfront-api") {
        if (proxyMode) {
          const { MultiProjectFSAdapter } = await import("./veryfront/multi-project-adapter.ts");
          const adapter = new MultiProjectFSAdapter(snapshot.config);
          await adapter.initialize?.();
          return adapter;
        }

        const { VeryfrontFSAdapter } = await import("./veryfront/index.ts");
        const adapter = new VeryfrontFSAdapter(snapshot.config);
        await adapter.initialize?.();
        return adapter;
      }

      if (type === "github") {
        if (!snapshot.config.github) {
          invalidConfig(
            "GitHub adapter requires github configuration. " +
              "Provide github.owner, github.repo, and github.token (or GITHUB_TOKEN env var).",
          );
        }

        const { GitHubFSAdapter } = await import("./github/index.ts");
        const adapter = new GitHubFSAdapter(snapshot.config);
        await adapter.initialize?.();
        return adapter;
      }

      if (type === "memory") {
        const { MemoryFSAdapter } = await import("./memory/adapter.ts");
        return new MemoryFSAdapter(snapshot.config);
      }

      return invalidConfig("Filesystem adapter type is not implemented");
    },
    { "fs.adapter.type": type, "fs.adapter.proxyMode": proxyMode },
  );
}
