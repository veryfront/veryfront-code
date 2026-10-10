import { readFile } from "node:fs/promises";
import process from "node:process";
import { isDeno, isDenoCompiled, isNodeRuntime } from "#veryfront/platform/compat/runtime.ts";
import { serverLogger as logger } from "#veryfront/utils";
import { PROJECT_EXECUTION_UNAVAILABLE } from "#veryfront/errors";
import { getHostEnvExcludingEnvFile } from "#veryfront/platform/compat/process.ts";
import { isHostProjectExecutionOverrideEnabled } from "#veryfront/security/host-execution-policy.ts";
import { createHostedExecutorAllocatorClient } from "#veryfront/agent/hosted/executor-allocator-client.ts";
import { connectExecutorTransport } from "#veryfront/agent/hosted/executor-node-transport.ts";
import type { HostedExecutorSessionPoolOptions } from "#veryfront/agent/hosted/executor-session-pool.ts";
import { createHostedHttpBroker } from "./hosted-http-broker.ts";
import type { HostedHttpIngressOptions } from "./hosted-http-ingress.ts";
import {
  createHostedHttpResolver,
  createHostedHttpSourceRecordLookup,
} from "./hosted-http-resolver.ts";

import { HOSTED_HTTP_ISOLATION_ENV, isHostedHttpIsolationEnabled } from "./hosted-http-flag.ts";

export { HOSTED_HTTP_ISOLATION_ENV, isHostedHttpIsolationEnabled };
export {
  buildHostedHttpGenerationBindingInput,
  createHostedHttpResolver,
  createHostedHttpSourceRecordLookup,
  type HostedHttpGenerationBindingInput,
  type HostedHttpResolverOptions,
} from "./hosted-http-resolver.ts";

const MAX_TOKEN_BYTES = 16 * 1024;
const MAX_CA_BYTES = 256 * 1024;
const MAX_RECORDS_BYTES = 4 * 1024 * 1024;
/** How long one read of the source records file is used before it is read again. */
const SOURCE_RECORDS_REFRESH_MS = 60_000;
/** Broker shutdown and per-session cleanup bounds, inside the default 4 s process cleanup budget. */
const SHUTDOWN_TIMEOUT_MS = 3_000;
const BROKER_INSTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Host-owned settings, read once from the host process environment. */
export interface HostedHttpCompositionConfig {
  /** `VERYFRONT_EXECUTOR_ALLOCATOR_URL`: operator allocator HTTPS origin. */
  allocatorUrl: string;
  /** `VERYFRONT_EXECUTOR_ALLOCATOR_CA_FILE`: optional allocator trust root. */
  allocatorCaFile?: string;
  /** `VERYFRONT_EXECUTOR_BROKER_TOKEN_FILE`: projected, rotated broker token. */
  brokerTokenFile: string;
  /** `VERYFRONT_EXECUTOR_BROKER_INSTANCE_ID`: this broker Pod UID. */
  brokerInstanceId: string;
  /** `VERYFRONT_HOSTED_HTTP_SOURCE_RECORDS_FILE`: tenant-source lookup records. */
  sourceRecordsFile: string;
  /** `VERYFRONT_HOSTED_HTTP_SOURCE_API_ORIGIN`: source API origin named by each record. */
  sourceApiOrigin: string;
  /** `VERYFRONT_HOSTED_HTTP_SOURCE_IMAGE_REPOSITORY`: private tenant-source repository. */
  sourceImageRepository: string;
  /** `VERYFRONT_HOSTED_HTTP_SERVICE_ACCOUNT_ID`: service account named by edge source credentials. */
  serviceAccountId: string;
  /** `VERYFRONT_API_BASE_URL`: API that authorizes each request's source token. */
  apiBaseUrl: string;
  /** `VERYFRONT_HOSTED_HTTP_MAX_ACTIVE`: executor admission limit. Default 16, maximum 256. */
  maxActive: number;
}

/** Hosted HTTP ingress options and the owner of their executor broker. */
export interface HostedHttpComposition {
  /** Pass as `hostedHttp` to the production server. */
  readonly ingress: HostedHttpIngressOptions;
  /** Stop admission and release executor allocations. Idempotent. */
  shutdown(): Promise<void>;
}

type HostedHttpCompositionBroker =
  & HostedHttpIngressOptions["broker"]
  & Pick<ReturnType<typeof createHostedHttpBroker>, "shutdown">;

interface HostedHttpCompositionDependencies {
  /** @internal Host file reader; replaced in hermetic tests. */
  readFile?: (path: string, options: { signal?: AbortSignal }) => Promise<Uint8Array>;
  /** @internal Host override check; replaced in hermetic tests. */
  isOverrideEnabled?: () => boolean;
  /** @internal Runtime support check; replaced in hermetic tests. */
  runtime?: () => HostedHttpRuntimeSupport;
  /** @internal Monotonic clock for the source records refresh; replaced in hermetic tests. */
  now?: () => number;
  createAllocatorClient?: typeof createHostedExecutorAllocatorClient;
  createBroker?: (options: HostedExecutorSessionPoolOptions) => HostedHttpCompositionBroker;
}

/** Whether this process can run the hosted HTTP host, and how to name it in errors. */
export interface HostedHttpRuntimeSupport {
  supported: boolean;
  name: string;
}

/**
 * The allocator client and the TLS pre-shared-key transport need Node.js 22 or newer.
 * Deno, including the compiled Deno binary, and Bun are unsupported.
 */
export function detectHostedHttpRuntime(): HostedHttpRuntimeSupport {
  if (isDeno) {
    return { supported: false, name: isDenoCompiled ? "the compiled Deno binary" : "Deno" };
  }
  if (!isNodeRuntime() || process.release?.name !== "node") {
    return { supported: false, name: "this runtime" };
  }
  const version = process.versions.node;
  return { supported: Number(version.split(".")[0]) >= 22, name: `Node.js ${version}` };
}

function absolutePath(value: string | undefined, key: string): string {
  if (!value?.startsWith("/") || value.includes("\0")) {
    throw new TypeError(`${key} must be an absolute host path`);
  }
  return value;
}

/**
 * Read hosted HTTP settings from the host environment, excluding project env files.
 * Returns undefined when the flag is unset or off. An unrecognized flag value or an
 * incomplete configuration is a startup error, never a silent fallback.
 */
export function readHostedHttpCompositionConfig(
  read: (key: string) => string | undefined = getHostEnvExcludingEnvFile,
): HostedHttpCompositionConfig | undefined {
  if (!isHostedHttpIsolationEnabled(read)) return undefined;
  const required = (key: string): string => {
    const value = read(key)?.trim();
    if (!value) throw new TypeError(`${key} is required when ${HOSTED_HTTP_ISOLATION_ENV} is on`);
    return value;
  };
  const allocatorUrl = required("VERYFRONT_EXECUTOR_ALLOCATOR_URL");
  if (!allocatorUrl.startsWith("https://")) {
    throw new TypeError("VERYFRONT_EXECUTOR_ALLOCATOR_URL must be an HTTPS origin");
  }
  const brokerInstanceId = required("VERYFRONT_EXECUTOR_BROKER_INSTANCE_ID");
  if (!BROKER_INSTANCE_ID.test(brokerInstanceId)) {
    throw new TypeError("VERYFRONT_EXECUTOR_BROKER_INSTANCE_ID must be the broker Pod UID");
  }
  const caFile = read("VERYFRONT_EXECUTOR_ALLOCATOR_CA_FILE")?.trim();
  const rawMaxActive = read("VERYFRONT_HOSTED_HTTP_MAX_ACTIVE")?.trim();
  const maxActive = rawMaxActive ? Number(rawMaxActive) : 16;
  if (!Number.isSafeInteger(maxActive) || maxActive < 1 || maxActive > 256) {
    throw new TypeError("VERYFRONT_HOSTED_HTTP_MAX_ACTIVE must be between 1 and 256");
  }
  const apiBaseUrl = read("VERYFRONT_API_BASE_URL")?.trim();
  if (!apiBaseUrl) {
    throw new TypeError(
      `VERYFRONT_API_BASE_URL is required when ${HOSTED_HTTP_ISOLATION_ENV} is on`,
    );
  }
  return Object.freeze({
    allocatorUrl,
    ...(caFile
      ? { allocatorCaFile: absolutePath(caFile, "VERYFRONT_EXECUTOR_ALLOCATOR_CA_FILE") }
      : {}),
    brokerTokenFile: absolutePath(
      required("VERYFRONT_EXECUTOR_BROKER_TOKEN_FILE"),
      "VERYFRONT_EXECUTOR_BROKER_TOKEN_FILE",
    ),
    brokerInstanceId,
    sourceRecordsFile: absolutePath(
      required("VERYFRONT_HOSTED_HTTP_SOURCE_RECORDS_FILE"),
      "VERYFRONT_HOSTED_HTTP_SOURCE_RECORDS_FILE",
    ),
    sourceApiOrigin: required("VERYFRONT_HOSTED_HTTP_SOURCE_API_ORIGIN"),
    sourceImageRepository: required("VERYFRONT_HOSTED_HTTP_SOURCE_IMAGE_REPOSITORY"),
    serviceAccountId: required("VERYFRONT_HOSTED_HTTP_SERVICE_ACCOUNT_ID"),
    apiBaseUrl,
    maxActive,
  });
}

async function readBoundedText(
  read: NonNullable<HostedHttpCompositionDependencies["readFile"]>,
  path: string,
  maxBytes: number,
  signal?: AbortSignal,
) {
  const bytes = await read(path, { signal });
  try {
    if (bytes.byteLength > maxBytes) throw new TypeError("Hosted HTTP host file is too large");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    bytes.fill(0);
  }
}

/**
 * Serve tenant-source records from a host file that is read again at most once per
 * refresh interval. Until the first lookup after the interval, releases published since
 * the last read are refused. A failed read or parse refuses every lookup until a later
 * read succeeds; stale records are never served after a failed read.
 * @internal
 */
export async function createRefreshingSourceRecordLookup(options: {
  readText(): Promise<string>;
  now(): number;
  refreshMs: number;
}): Promise<Parameters<typeof createHostedHttpResolver>[0]["lookupSourceImage"]> {
  type Lookup = ReturnType<typeof createHostedHttpSourceRecordLookup>;
  let lookup: Lookup | undefined;
  let loadedAt = 0;
  let loading: Promise<void> | undefined;
  const load = async () => {
    try {
      lookup = createHostedHttpSourceRecordLookup(JSON.parse(await options.readText()));
    } catch {
      lookup = undefined;
    } finally {
      loadedAt = options.now();
    }
  };
  await load();
  if (!lookup) throw new TypeError("Hosted HTTP source records file is unreadable");
  return async (request, signal) => {
    signal.throwIfAborted();
    if (options.now() - loadedAt >= options.refreshMs) {
      loading ??= load().finally(() => {
        loading = undefined;
      });
      await loading;
      signal.throwIfAborted();
    }
    if (!lookup) {
      throw PROJECT_EXECUTION_UNAVAILABLE.create({ detail: "Source records are unavailable" });
    }
    return await lookup(request, signal);
  };
}

/**
 * Compose the hosted HTTP allocator client, TLS transport, broker, resolver and ingress
 * from host configuration only. Node.js 22 or newer only: on any other runtime it refuses to
 * start rather than serve without isolation. Refuses to start while the shared host-execution override
 * is set. The broker token file is read on every allocator call so rotation applies. The
 * source records file is read at startup and again at most once a minute, so a newly
 * published release is refused for up to one minute and a broken file refuses every release.
 */
export async function createHostedHttpComposition(
  config: HostedHttpCompositionConfig,
  dependencies: HostedHttpCompositionDependencies = {},
): Promise<HostedHttpComposition> {
  const runtime = (dependencies.runtime ?? detectHostedHttpRuntime)();
  if (!runtime.supported) {
    throw new TypeError(
      `${HOSTED_HTTP_ISOLATION_ENV} requires Node.js 22 or newer and is unsupported on ${runtime.name}`,
    );
  }
  if ((dependencies.isOverrideEnabled ?? isHostProjectExecutionOverrideEnabled)()) {
    throw new TypeError("Hosted HTTP isolation requires host project execution to be disabled");
  }
  const read = dependencies.readFile ?? readFile;
  const ca = config.allocatorCaFile
    ? await readBoundedText(read, config.allocatorCaFile, MAX_CA_BYTES)
    : undefined;
  const lookupSourceImage = await createRefreshingSourceRecordLookup({
    readText: () => readBoundedText(read, config.sourceRecordsFile, MAX_RECORDS_BYTES),
    now: dependencies.now ?? (() => performance.now()),
    refreshMs: SOURCE_RECORDS_REFRESH_MS,
  });
  const tokenFile = config.brokerTokenFile;
  const allocator = (dependencies.createAllocatorClient ?? createHostedExecutorAllocatorClient)({
    baseUrl: config.allocatorUrl,
    ...(ca === undefined ? {} : { ca }),
    async readBrokerToken(signal) {
      const token = (await readBoundedText(read, tokenFile, MAX_TOKEN_BYTES, signal)).trim();
      if (!token) throw new Error("Executor broker token is unavailable");
      return token;
    },
  });
  const resolve = createHostedHttpResolver({
    apiBaseUrl: config.apiBaseUrl,
    sourceApiOrigin: config.sourceApiOrigin,
    sourceImageRepository: config.sourceImageRepository,
    serviceAccountId: config.serviceAccountId,
    lookupSourceImage,
    session: {
      expectedBrokerInstanceId: config.brokerInstanceId,
      allocator,
      connectTransport: connectExecutorTransport,
      cleanupTimeoutMs: SHUTDOWN_TIMEOUT_MS,
    },
  });
  const broker = (dependencies.createBroker ?? createHostedHttpBroker)({
    maxActive: config.maxActive,
    shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
  });
  let stopped: Promise<void> | undefined;
  return Object.freeze({
    ingress: Object.freeze({ broker, resolve, maxPreparing: config.maxActive }),
    shutdown() {
      stopped ??= broker.shutdown().then(({ release, pending }) => {
        if (release === "reaper-required" || pending > 0) {
          logger.warn("Hosted HTTP executor shutdown left allocations for the reaper", {
            release,
            pending,
          });
        }
      });
      return stopped;
    },
  });
}
