import { open } from "node:fs/promises";
import process from "node:process";
import { isDeno, isDenoCompiled, isNodeRuntime } from "#veryfront/platform/compat/runtime.ts";
import { serverLogger as logger } from "#veryfront/utils";
import { CONFIG_INVALID, PROJECT_EXECUTION_UNAVAILABLE } from "#veryfront/errors";
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

const MAX_TOKEN_BYTES = 16 * 1024;
const MAX_CA_BYTES = 256 * 1024;
const MAX_RECORDS_BYTES = 4 * 1024 * 1024;
/** How long one read of the source records file is used before it is read again. */
const SOURCE_RECORDS_REFRESH_MS = 60_000;
/** Bound on the startup read of the allocator trust root. */
const HOST_FILE_READ_TIMEOUT_MS = 5_000;
/** Bound for closing a host file handle after its bytes were read. */
const HOST_FILE_CLOSE_TIMEOUT_MS = 2_000;
/** Host file reads are refused while this many handle closes have not settled. */
const MAX_STALLED_HOST_FILE_CLOSES = 4;
let stalledHostFileCloses = 0;
/** Bound on one broker token read, below the allocator client's 5 s request deadline. */
const TOKEN_READ_TIMEOUT_MS = 2_000;
/** Bound on one read of the source records file, below the resolver's 10 s deadline. */
const SOURCE_RECORDS_READ_TIMEOUT_MS = 5_000;
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
  /**
   * `VERYFRONT_HOSTED_HTTP_CONFIGURATION_KEY_FILE`: deployment-wide secret, at least 32 bytes,
   * so every replica derives the same configuration identity.
   */
  configurationKeyFile: string;
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
  readFile?: (
    path: string,
    options: { signal?: AbortSignal; maxBytes: number },
  ) => Promise<Uint8Array>;
  /** @internal Host override check; replaced in hermetic tests. */
  isOverrideEnabled?: () => boolean;
  /** @internal Startup host file read bound; replaced in hermetic tests. */
  hostFileReadTimeoutMs?: number;
  /** @internal Broker token read bound; replaced in hermetic tests. */
  tokenReadTimeoutMs?: number;
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
    configurationKeyFile: absolutePath(
      required("VERYFRONT_HOSTED_HTTP_CONFIGURATION_KEY_FILE"),
      "VERYFRONT_HOSTED_HTTP_CONFIGURATION_KEY_FILE",
    ),
    apiBaseUrl,
    maxActive,
  });
}

/**
 * Settle with `work`, or reject when `signal` aborts or `timeoutMs` passes. On rejection
 * `work` is detached, so a read that never settles cannot hold its caller.
 * @internal
 */
export async function settleWithin<T>(
  work: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  work.catch(() => {});
  signal.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stopped = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new DOMException("Host file read timed out", "TimeoutError")),
      timeoutMs,
    );
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work, stopped]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort!);
  }
}

/** The part of a file handle a bounded host file read uses. */
interface HostFileHandle {
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: null,
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

/**
 * Read at most `maxBytes + 1` bytes of a host file, so an oversized file is detected
 * without loading it whole. The read buffer is wiped before the handle closes, and a
 * failed or stalled close wipes the returned copy too, so no exit leaves the bytes behind.
 * @internal
 */
export async function readHostFilePrefix(
  path: string,
  options: {
    signal?: AbortSignal;
    maxBytes: number;
    /** @internal Opens the file; replaced in hermetic tests. */
    open?: (path: string, flags: "r") => Promise<HostFileHandle>;
    /** @internal Bound for closing the handle; shortened in hermetic tests. */
    closeTimeoutMs?: number;
  },
): Promise<Uint8Array> {
  options.signal?.throwIfAborted();
  if (stalledHostFileCloses >= MAX_STALLED_HOST_FILE_CLOSES) {
    throw new Error("Host file handles are still closing");
  }
  const limit = options.maxBytes + 1;
  const handle = await (options.open ?? open)(path, "r");
  const buffer = new Uint8Array(limit);
  let result: Uint8Array | undefined;
  let failed = false;
  let failure: unknown;
  try {
    let length = 0;
    while (length < limit) {
      options.signal?.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, length, limit - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    result = buffer.slice(0, length);
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    // Wipe before closing, so a close that never settles cannot retain the bytes.
    buffer.fill(0);
  }
  let closeSettled = false;
  const closing = handle.close();
  closing.then(() => closeSettled = true, () => closeSettled = true);
  try {
    await settleWithin(
      closing,
      options.signal ?? new AbortController().signal,
      options.closeTimeoutMs ?? HOST_FILE_CLOSE_TIMEOUT_MS,
    );
  } catch (closeError) {
    // A failed or stalled close returns nothing, so the copy is wiped as well.
    result?.fill(0);
    if (!closeSettled) {
      // The handle stays open until its close settles; count it so stalled closes
      // cannot accumulate handles.
      stalledHostFileCloses++;
      const settled = () => {
        stalledHostFileCloses--;
      };
      closing.then(settled, settled);
    }
    if (!failed) throw closeError;
  }
  if (failed) throw failure;
  return result!;
}

/**
 * Read a bounded UTF-8 host file. Failures name the setting, never the host path,
 * so file system errors do not reach user-facing output or error reporting.
 */
async function readBoundedBytes(
  read: NonNullable<HostedHttpCompositionDependencies["readFile"]>,
  setting: string,
  path: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    bytes = await read(path, { signal, maxBytes });
  } catch {
    signal?.throwIfAborted();
    throw CONFIG_INVALID.create({ detail: `The file named by ${setting} could not be read` });
  }
  if (bytes.byteLength > maxBytes) {
    bytes.fill(0);
    throw CONFIG_INVALID.create({ detail: `The file named by ${setting} is too large` });
  }
  return bytes;
}

async function readBoundedText(
  read: NonNullable<HostedHttpCompositionDependencies["readFile"]>,
  setting: string,
  path: string,
  maxBytes: number,
  signal?: AbortSignal,
) {
  const bytes = await readBoundedBytes(read, setting, path, maxBytes, signal);
  try {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw CONFIG_INVALID.create({ detail: `The file named by ${setting} is not UTF-8` });
    }
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
  readText(signal: AbortSignal): Promise<string>;
  now(): number;
  refreshMs: number;
  /** Bound on one read. A read still pending at the bound is aborted and treated as failed. */
  readTimeoutMs: number;
}): Promise<Parameters<typeof createHostedHttpResolver>[0]["lookupSourceImage"]> {
  type Lookup = ReturnType<typeof createHostedHttpSourceRecordLookup>;
  let lookup: Lookup | undefined;
  let loadedAt = 0;
  let loading: Promise<void> | undefined;
  // One raw read at a time. A read that outlives its timeout stays here until it
  // settles only to block a second concurrent read, so a prolonged mount failure
  // cannot accumulate open reads; its result is never used, because the file may
  // have rotated while it stalled. The first refresh after it settles reads again.
  let pendingRead: Promise<string> | undefined;
  const readWithin = async (): Promise<string> => {
    if (pendingRead) throw new Error("A timed-out source records read is still pending");
    const deadline = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        deadline.abort();
        reject(new Error("Source records read timed out"));
      }, options.readTimeoutMs);
    });
    const reading: Promise<string> = options.readText(deadline.signal).finally(() => {
      if (pendingRead === reading) pendingRead = undefined;
    });
    pendingRead = reading;
    reading.catch(() => {});
    try {
      return await Promise.race([reading, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  };
  const load = async () => {
    try {
      lookup = createHostedHttpSourceRecordLookup(JSON.parse(await readWithin()));
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
  const read = dependencies.readFile ?? readHostFilePrefix;
  const readStartupFile = async <T>(
    setting: string,
    readFile: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    const startup = new AbortController();
    try {
      return await settleWithin(
        readFile(startup.signal),
        startup.signal,
        dependencies.hostFileReadTimeoutMs ?? HOST_FILE_READ_TIMEOUT_MS,
      );
    } catch (error) {
      startup.abort();
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw CONFIG_INVALID.create({
          detail: `The file named by ${setting} could not be read in time`,
        });
      }
      throw error;
    }
  };
  const ca = config.allocatorCaFile
    ? await readStartupFile(
      "VERYFRONT_EXECUTOR_ALLOCATOR_CA_FILE",
      (signal) =>
        readBoundedText(
          read,
          "VERYFRONT_EXECUTOR_ALLOCATOR_CA_FILE",
          config.allocatorCaFile!,
          MAX_CA_BYTES,
          signal,
        ),
    )
    : undefined;
  const lookupSourceImage = await createRefreshingSourceRecordLookup({
    readText: (signal) =>
      readBoundedText(
        read,
        "VERYFRONT_HOSTED_HTTP_SOURCE_RECORDS_FILE",
        config.sourceRecordsFile,
        MAX_RECORDS_BYTES,
        signal,
      ),
    readTimeoutMs: SOURCE_RECORDS_READ_TIMEOUT_MS,
    now: dependencies.now ?? (() => performance.now()),
    refreshMs: SOURCE_RECORDS_REFRESH_MS,
  });
  const tokenFile = config.brokerTokenFile;
  const tokenReadTimeoutMs = dependencies.tokenReadTimeoutMs ?? TOKEN_READ_TIMEOUT_MS;
  let tokenRead: { promise: Promise<string>; retired: boolean } | undefined;
  const allocator = (dependencies.createAllocatorClient ?? createHostedExecutorAllocatorClient)({
    baseUrl: config.allocatorUrl,
    ...(ca === undefined ? {} : { ca }),
    async readBrokerToken(signal) {
      // A file read cannot be interrupted once in flight. At most one raw read runs
      // at a time and callers share it; each caller races it against its own signal
      // and a fixed bound, so a stalled file system cannot accumulate reads. Once any
      // caller gives up on a read (its bound or its own abort), the read may return a
      // token rotated away meanwhile: it is retired, stays only to block a second
      // read, its result is never used, and callers are refused until it settles and
      // the next caller reads again.
      if (tokenRead?.retired) throw new Error("Executor broker token is unavailable");
      if (!tokenRead) {
        const entry = { retired: false } as { promise: Promise<string>; retired: boolean };
        entry.promise = readBoundedText(
          read,
          "VERYFRONT_EXECUTOR_BROKER_TOKEN_FILE",
          tokenFile,
          MAX_TOKEN_BYTES,
        ).finally(() => {
          if (tokenRead === entry) tokenRead = undefined;
        });
        tokenRead = entry;
      }
      const current = tokenRead;
      let token: string;
      try {
        token = (await settleWithin(current.promise, signal, tokenReadTimeoutMs)).trim();
      } catch (error) {
        current.retired = true;
        throw error;
      }
      if (current.retired || !token) throw new Error("Executor broker token is unavailable");
      return token;
    },
  });
  // The key is raw bytes: it is neither decoded as text nor trimmed.
  const configurationKey = await readStartupFile(
    "VERYFRONT_HOSTED_HTTP_CONFIGURATION_KEY_FILE",
    (signal) => {
      const reading = readBoundedBytes(
        read,
        "VERYFRONT_HOSTED_HTTP_CONFIGURATION_KEY_FILE",
        config.configurationKeyFile,
        MAX_TOKEN_BYTES,
        signal,
      );
      // A read that outlives the startup deadline still returns the key to nobody;
      // wipe it as soon as it arrives.
      reading.then((bytes) => {
        if (signal.aborted) bytes.fill(0);
      }, () => {});
      return reading;
    },
  );
  // The resolver snapshots the key; this buffer is wiped once that is done or startup
  // fails, so no second copy of the secret outlives startup. The key is read last so
  // no other startup step runs while it is held.
  let resolve: ReturnType<typeof createHostedHttpResolver>;
  try {
    if (configurationKey.byteLength < 32) {
      throw CONFIG_INVALID.create({
        detail:
          "The file named by VERYFRONT_HOSTED_HTTP_CONFIGURATION_KEY_FILE must hold at least 32 bytes",
      });
    }
    resolve = createHostedHttpResolver({
      apiBaseUrl: config.apiBaseUrl,
      sourceApiOrigin: config.sourceApiOrigin,
      sourceImageRepository: config.sourceImageRepository,
      serviceAccountId: config.serviceAccountId,
      configurationKey,
      lookupSourceImage,
      session: {
        expectedBrokerInstanceId: config.brokerInstanceId,
        allocator,
        connectTransport: connectExecutorTransport,
        cleanupTimeoutMs: SHUTDOWN_TIMEOUT_MS,
      },
    });
  } finally {
    configurationKey.fill(0);
  }
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
