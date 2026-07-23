import type { ContentSource, FSAdapterConfig, StyleCallbacks } from "./types.ts";
import {
  assertReadableConfigObject,
  invalidFSAdapterConfig,
  readConfigProperty,
} from "./config-boundary.ts";
import { buildFileCacheOptions, buildRetryConfig } from "./adapter-helpers.ts";
import { snapshotInvalidationCallbacks } from "./default-invalidation-callbacks.ts";

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") invalidFSAdapterConfig(`${label} must be a string`);
  return value;
}

function optionalProjectDirectory(value: unknown): string | undefined {
  const projectDir = optionalString(value, "Veryfront filesystem projectDir");
  if (projectDir !== undefined && projectDir.length > 4_096) {
    invalidFSAdapterConfig(
      "Veryfront filesystem projectDir must be a string of at most 4096 characters",
    );
  }
  return projectDir;
}

function requiredSourceValue(value: unknown, label: string): string {
  const stringValue = optionalString(value, label);
  if (stringValue === undefined || stringValue.trim().length === 0) {
    invalidFSAdapterConfig(`${label} must be a non-empty string`);
  }
  return stringValue;
}

function snapshotContentSource(value: unknown): Readonly<ContentSource> | undefined {
  if (value === undefined) return undefined;
  assertReadableConfigObject(value, "Veryfront filesystem content source");
  const type = readConfigProperty(value, "type", "Veryfront filesystem content source");

  switch (type) {
    case "branch": {
      const branch = optionalString(
        readConfigProperty(value, "branch", "Veryfront filesystem content source"),
        "Veryfront filesystem branch",
      );
      if (branch !== undefined && branch.trim().length === 0) {
        invalidFSAdapterConfig("Veryfront filesystem branch must be a non-empty string");
      }
      return Object.freeze({ type, ...(branch === undefined ? {} : { branch }) });
    }
    case "environment":
      return Object.freeze({
        type,
        name: requiredSourceValue(
          readConfigProperty(value, "name", "Veryfront filesystem content source"),
          "Veryfront filesystem environment name",
        ),
      });
    case "domain":
      return Object.freeze({
        type,
        domain: requiredSourceValue(
          readConfigProperty(value, "domain", "Veryfront filesystem content source"),
          "Veryfront filesystem domain",
        ),
      });
    case "release": {
      const releaseId = optionalString(
        readConfigProperty(value, "releaseId", "Veryfront filesystem content source"),
        "Veryfront filesystem release ID",
      );
      if (releaseId !== undefined && releaseId.trim().length === 0) {
        invalidFSAdapterConfig("Veryfront filesystem release ID must be a non-empty string");
      }
      return Object.freeze({ type, ...(releaseId === undefined ? {} : { releaseId }) });
    }
    default:
      return invalidFSAdapterConfig("Veryfront filesystem content source type is invalid");
  }
}

function snapshotStyleCallbacks(value: unknown): Readonly<StyleCallbacks> | undefined {
  if (value === undefined) return undefined;
  assertReadableConfigObject(value, "Filesystem style callbacks");
  const pregenerateStyles = readConfigProperty(
    value,
    "pregenerateStyles",
    "Filesystem style callbacks",
  );
  if (pregenerateStyles !== undefined && typeof pregenerateStyles !== "function") {
    invalidFSAdapterConfig("Filesystem style callbacks must be functions");
  }
  return Object.freeze({
    ...(pregenerateStyles === undefined ? {} : { pregenerateStyles }),
  }) as Readonly<StyleCallbacks>;
}

function snapshotVeryfrontOptions(
  value: unknown,
): Readonly<NonNullable<FSAdapterConfig["veryfront"]>> {
  if (value === undefined) {
    invalidFSAdapterConfig("Veryfront adapter requires veryfront configuration");
  }
  assertReadableConfigObject(value, "Veryfront filesystem configuration");

  const apiToken = optionalString(
    readConfigProperty(value, "apiToken", "Veryfront filesystem configuration"),
    "Veryfront filesystem API token",
  );
  const projectSlug = optionalString(
    readConfigProperty(value, "projectSlug", "Veryfront filesystem configuration"),
    "Veryfront filesystem project slug",
  );
  const projectId = optionalString(
    readConfigProperty(value, "projectId", "Veryfront filesystem configuration"),
    "Veryfront filesystem project ID",
  );
  const apiBaseUrl = optionalString(
    readConfigProperty(value, "apiBaseUrl", "Veryfront filesystem configuration"),
    "Veryfront filesystem API base URL",
  );
  const proxyMode = readConfigProperty(
    value,
    "proxyMode",
    "Veryfront filesystem configuration",
  );
  if (proxyMode !== undefined && typeof proxyMode !== "boolean") {
    invalidFSAdapterConfig("Veryfront filesystem proxyMode must be a boolean");
  }

  const contentSource = snapshotContentSource(
    readConfigProperty(value, "contentSource", "Veryfront filesystem configuration"),
  );
  const cacheOptions = buildFileCacheOptions(
    readConfigProperty(value, "cache", "Veryfront filesystem configuration") as NonNullable<
      FSAdapterConfig["veryfront"]
    >["cache"],
  );
  const retry = buildRetryConfig(
    readConfigProperty(value, "retry", "Veryfront filesystem configuration") as NonNullable<
      FSAdapterConfig["veryfront"]
    >["retry"],
  );

  return Object.freeze({
    apiToken,
    projectSlug,
    projectId,
    apiBaseUrl,
    proxyMode: proxyMode as boolean | undefined,
    contentSource,
    cache: Object.freeze({ enabled: cacheOptions.enabled, ttl: cacheOptions.ttl }),
    retry,
  });
}

const PROXY_BASE_CONFIG_TYPES: ReadonlySet<string> = new Set(
  ["local", "veryfront-api"] as const satisfies readonly NonNullable<
    FSAdapterConfig["type"]
  >[],
);

function snapshotAdapterConfig(
  input: unknown,
  mode: "concrete" | "proxy-base",
): Readonly<FSAdapterConfig> {
  assertReadableConfigObject(input, "Veryfront filesystem adapter configuration");
  const type = readConfigProperty(input, "type", "Veryfront filesystem adapter configuration");
  if (
    type !== undefined &&
    (typeof type !== "string" ||
      (mode === "concrete" ? type !== "veryfront-api" : !PROXY_BASE_CONFIG_TYPES.has(type)))
  ) {
    invalidFSAdapterConfig(
      mode === "concrete"
        ? "Veryfront filesystem adapter type must be veryfront-api"
        : "Proxy filesystem base adapter type is invalid",
    );
  }
  const projectDir = optionalProjectDirectory(
    readConfigProperty(input, "projectDir", "Veryfront filesystem adapter configuration"),
  );
  const veryfrontInput = readConfigProperty(
    input,
    "veryfront",
    "Veryfront filesystem adapter configuration",
  );
  if (mode === "concrete" && veryfrontInput === undefined) {
    invalidFSAdapterConfig("Veryfront adapter requires veryfront configuration");
  }
  const veryfront = veryfrontInput === undefined
    ? undefined
    : snapshotVeryfrontOptions(veryfrontInput);
  const invalidationCallbacks = snapshotInvalidationCallbacks(
    readConfigProperty(
      input,
      "invalidationCallbacks",
      "Veryfront filesystem adapter configuration",
    ) as FSAdapterConfig["invalidationCallbacks"],
  );
  const styleCallbacks = snapshotStyleCallbacks(
    readConfigProperty(input, "styleCallbacks", "Veryfront filesystem adapter configuration"),
  );

  return Object.freeze({
    ...(type === undefined ? {} : { type }),
    projectDir,
    veryfront,
    invalidationCallbacks,
    styleCallbacks,
  }) as Readonly<FSAdapterConfig>;
}

/**
 * Snapshot the full configuration accepted by a concrete Veryfront filesystem
 * adapter before constructors create clients, caches, timers, or other state.
 */
export function snapshotVeryfrontFSAdapterConfig(
  input: unknown,
): Readonly<FSAdapterConfig> {
  return snapshotAdapterConfig(input, "concrete");
}

/** Snapshot manager state without requiring it to materialize a concrete adapter. */
export function snapshotProxyFSAdapterBaseConfig(
  input: unknown,
): Readonly<FSAdapterConfig> {
  return snapshotAdapterConfig(input, "proxy-base");
}
