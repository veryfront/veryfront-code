import { readFile } from "node:fs/promises";
import { serverLogger as logger } from "#veryfront/utils";
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

/** Host flag that enables isolated hosted HTTP execution. Default off. */
export const HOSTED_HTTP_ISOLATION_ENV = "VERYFRONT_HOSTED_HTTP_ISOLATION";

const MAX_TOKEN_BYTES = 16 * 1024;
const MAX_CA_BYTES = 256 * 1024;
const MAX_RECORDS_BYTES = 4 * 1024 * 1024;
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
  createAllocatorClient?: typeof createHostedExecutorAllocatorClient;
  createBroker?: (options: HostedExecutorSessionPoolOptions) => HostedHttpCompositionBroker;
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
  const flag = read(HOSTED_HTTP_ISOLATION_ENV)?.trim().toLowerCase() ?? "";
  if (["", "0", "false", "no", "off"].includes(flag)) return undefined;
  if (!["1", "true", "yes", "on"].includes(flag)) {
    throw new TypeError(`${HOSTED_HTTP_ISOLATION_ENV} must be 1 or 0`);
  }
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
 * Compose the hosted HTTP allocator client, TLS transport, broker, resolver and ingress
 * from host configuration only. Refuses to start while the shared host-execution override
 * is set. The broker token file is read on every allocator call so rotation applies.
 */
export async function createHostedHttpComposition(
  config: HostedHttpCompositionConfig,
  dependencies: HostedHttpCompositionDependencies = {},
): Promise<HostedHttpComposition> {
  if ((dependencies.isOverrideEnabled ?? isHostProjectExecutionOverrideEnabled)()) {
    throw new TypeError("Hosted HTTP isolation requires host project execution to be disabled");
  }
  const read = dependencies.readFile ?? readFile;
  const ca = config.allocatorCaFile
    ? await readBoundedText(read, config.allocatorCaFile, MAX_CA_BYTES)
    : undefined;
  let records: unknown;
  try {
    records = JSON.parse(await readBoundedText(read, config.sourceRecordsFile, MAX_RECORDS_BYTES));
  } catch {
    throw new TypeError("Hosted HTTP source records file is unreadable");
  }
  const lookupSourceImage = createHostedHttpSourceRecordLookup(records as unknown[]);
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
    lookupSourceImage,
    session: {
      expectedBrokerInstanceId: config.brokerInstanceId,
      allocator,
      connectTransport: connectExecutorTransport,
    },
  });
  const broker = (dependencies.createBroker ?? createHostedHttpBroker)({
    maxActive: config.maxActive,
  });
  let stopped: Promise<void> | undefined;
  return Object.freeze({
    ingress: Object.freeze({ broker, resolve }),
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
