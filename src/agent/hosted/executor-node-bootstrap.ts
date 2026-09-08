import { constants } from "node:fs";
import { open } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import process from "node:process";
import { isNodeRuntime } from "#veryfront/platform/compat/runtime.ts";
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import {
  createExecutorChannel,
  type ExecutorChannel,
  type ExecutorOperation,
} from "#veryfront/agent/executor/channel.ts";
import {
  type ExecutorTransportListener,
  listenExecutorTransport,
} from "./executor-node-transport.ts";

type BootstrapVariable =
  | "VERYFRONT_EXECUTOR_ALLOCATION_ID"
  | "VERYFRONT_EXECUTOR_GENERATION"
  | "VERYFRONT_EXECUTOR_INVOCATION_ID"
  | "VERYFRONT_EXECUTOR_ACTIVE_DEADLINE_SECONDS"
  | "VERYFRONT_EXECUTOR_HARD_DEADLINE_AT"
  | "PORT";

/** Fixed operator-owned input boundary. No environment enumeration or forwarding. */
export interface ExecutorBootstrapEnvironment {
  get(name: BootstrapVariable): string | undefined;
}

export interface ExecutorNodeBootstrapOptions {
  /** Register trusted handlers before any project imports. The map is snapshotted at startup. */
  operations: ReadonlyMap<string, ExecutorOperation>;
  signal?: AbortSignal;
  environment?: ExecutorBootstrapEnvironment;
  /**
   * Trusted test boundary for the fixed key file, never a configurable path.
   * Transfer ownership of returned bytes: startup wipes them after use or failure.
   */
  readKey?: (signal: AbortSignal) => Promise<Uint8Array>;
}

export interface ExecutorNodeBootstrap {
  readonly address: Readonly<AddressInfo>;
  /** Resolves after TLS authentication and the invocation-channel handshake. */
  readonly ready: Promise<ExecutorChannel>;
  close(): void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Validate the fixed Operator environment without enumerating or forwarding it. */
export function readExecutorBootstrapConfiguration(environment: ExecutorBootstrapEnvironment) {
  try {
    const allocationId = environment.get("VERYFRONT_EXECUTOR_ALLOCATION_ID");
    const generation = environment.get("VERYFRONT_EXECUTOR_GENERATION");
    const invocationId = environment.get("VERYFRONT_EXECUTOR_INVOCATION_ID");
    const seconds = environment.get("VERYFRONT_EXECUTOR_ACTIVE_DEADLINE_SECONDS");
    const hardDeadlineAt = environment.get("VERYFRONT_EXECUTOR_HARD_DEADLINE_AT");
    const port = environment.get("PORT");
    if (
      typeof allocationId !== "string" || allocationId.length !== 36 || !UUID.test(allocationId) ||
      typeof invocationId !== "string" || invocationId.length !== 36 || !UUID.test(invocationId) ||
      !canonicalPositiveInteger(generation, Number.MAX_SAFE_INTEGER) ||
      !canonicalPositiveInteger(seconds, 86_400) ||
      !canonicalPositiveInteger(hardDeadlineAt, Number.MAX_SAFE_INTEGER) || port !== "8081"
    ) throw new Error();
    return {
      binding: Object.freeze({ allocationId, generation: Number(generation), invocationId }),
      lifetimeMs: Number(seconds) * 1_000,
      hardDeadlineAt: Number(hardDeadlineAt),
    };
  } catch {
    throw new TypeError("Invalid executor bootstrap environment");
  }
}

function canonicalPositiveInteger(value: unknown, maximum: number): value is string {
  if (typeof value !== "string" || value.length > 16 || !/^[1-9][0-9]*$/.test(value)) return false;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= maximum;
}

/** Read at most 33 bytes, including one byte that detects an oversized key. */
async function readFixedChannelKey(
  signal: AbortSignal,
  remaining: () => number,
): Promise<Uint8Array> {
  const bytes = new Uint8Array(33);
  let file: Awaited<ReturnType<typeof open>> | undefined;
  let offset = 0;
  let failed = false;
  const assertActive = () => {
    signal.throwIfAborted();
    remaining();
  };
  try {
    assertActive();
    // Secret volume paths contain Kubernetes-managed symlinks. Open only this
    // fixed path; nonblocking open plus fstat rejects non-regular files safely.
    file = await open(
      "/var/run/veryfront-executor/channel-key",
      constants.O_RDONLY | constants.O_NONBLOCK,
    );
    assertActive();
    const stat = await file.stat();
    assertActive();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o440 || stat.gid !== 1000) {
      throw new Error();
    }
    while (offset < bytes.byteLength) {
      assertActive();
      const { bytesRead } = await file.read(bytes, offset, bytes.byteLength - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    assertActive();
  } catch {
    failed = true;
  } finally {
    try {
      await file?.close();
    } catch {
      failed = true;
    }
  }
  if (failed) {
    bytes.fill(0);
    throw new Error("Executor bootstrap key read failed");
  }
  return bytes.subarray(0, offset);
}

/**
 * Start the fixed Node executor endpoint before importing any project code.
 * The trusted entrypoint must first register its first-party SchemaValidator.
 * This helper does not load an app, environment files, or project extensions.
 * The earlier workload or allocation deadline bounds startup and channel I/O.
 * Timer-driven closure is cooperative, not kernel process termination under a
 * blocked event loop. Live authority and the reaper fence remain broker-owned.
 */
export async function startExecutorNodeBootstrap(
  options: ExecutorNodeBootstrapOptions,
): Promise<ExecutorNodeBootstrap> {
  if (
    !isNodeRuntime() || process.release.name !== "node" ||
    Number(process.versions.node.split(".")[0]) < 22
  ) throw new Error("Executor bootstrap requires Node.js 22 or newer");
  const startedAt = Date.now();
  const { binding, lifetimeMs, hardDeadlineAt } = readExecutorBootstrapConfiguration(
    options.environment ?? { get: (name) => process.env[name] },
  );
  const deadline = Math.min(startedAt + lifetimeMs, hardDeadlineAt);
  const remaining = () => {
    const value = deadline - Date.now();
    if (value <= 0) throw new Error("Executor bootstrap deadline exceeded");
    return value;
  };
  remaining();
  if (!tryResolve("SchemaValidator")) {
    throw new Error("Executor bootstrap requires a registered schema validator");
  }
  if (!options.operations) throw new TypeError("Executor bootstrap requires registered operations");
  const operations = new Map(options.operations);
  const lifetimeRemaining = remaining();
  const authority = new AbortController();
  const ready = Promise.withResolvers<ExecutorChannel>();
  const closed = Promise.withResolvers<never>();
  void ready.promise.catch(() => {});
  void closed.promise.catch(() => {});
  let key: Uint8Array | undefined;
  let listener: ExecutorTransportListener | undefined;
  let channel: ExecutorChannel | undefined;
  let failure: Error | undefined;
  const stop = (error: Error) => {
    if (failure) return;
    failure = error;
    clearTimeout(lifetimeTimer);
    clearTimeout(keyTimer);
    options.signal?.removeEventListener("abort", abort);
    authority.abort(error);
    key?.fill(0);
    key = undefined;
    listener?.close();
    channel?.close();
    ready.reject(error);
    closed.reject(error);
  };
  const abort = () => stop(new Error("Executor bootstrap aborted"));
  const lifetimeTimer = setTimeout(
    () => stop(new Error("Executor bootstrap deadline exceeded")),
    lifetimeRemaining,
  );
  const keyTimer = setTimeout(
    () => stop(new Error("Executor bootstrap key read deadline exceeded")),
    Math.min(lifetimeRemaining, 5_000),
  );
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    if (options.signal?.aborted) abort();
    if (failure) throw failure;
    const reading = Promise.resolve().then(() => {
      remaining();
      return options.readKey
        ? options.readKey(authority.signal)
        : readFixedChannelKey(authority.signal, remaining);
    }).then((bytes) => {
      if (!(bytes instanceof Uint8Array)) {
        throw new Error("Executor bootstrap requires exactly 32 key bytes");
      }
      if (failure) {
        bytes.fill(0);
        throw failure;
      }
      key = bytes;
      remaining();
      if (key.byteLength !== 32) {
        throw new Error("Executor bootstrap requires exactly 32 key bytes");
      }
    }, () => {
      remaining();
      throw new Error("Executor bootstrap key read failed");
    });
    await Promise.race([reading, closed.promise]);
    clearTimeout(keyTimer);
    if (failure) throw failure;
    // The TLS listener synchronously snapshots its key before returning its promise.
    const listening = listenExecutorTransport({
      host: "0.0.0.0",
      port: 8081,
      binding,
      key: key!,
      signal: authority.signal,
      timeoutMs: remaining(),
    });
    key!.fill(0);
    key = undefined;
    try {
      listener = await listening;
    } catch {
      remaining();
      throw new Error("Executor bootstrap could not bind port 8081");
    }
    if (failure) {
      listener.close();
      throw failure;
    }
    remaining();
    void listener.connection.then(async (transport) => {
      if (failure) {
        transport.close();
        return;
      }
      const channelLifetime = remaining();
      channel = createExecutorChannel({
        binding,
        transport,
        operations,
        defaultTimeoutMs: channelLifetime,
        handshakeTimeoutMs: Math.min(5_000, channelLifetime),
        cancellationTimeoutMs: Math.min(5_000, channelLifetime),
      });
      void channel.closed.then(() =>
        stop(
          new Error(
            Date.now() >= deadline
              ? "Executor bootstrap deadline exceeded"
              : "Executor bootstrap channel closed",
          ),
        )
      );
      await channel.ready;
      remaining();
      if (!failure) ready.resolve(channel);
    }).catch(() =>
      stop(
        new Error(
          Date.now() >= deadline
            ? "Executor bootstrap deadline exceeded"
            : "Executor bootstrap channel setup failed",
        ),
      )
    );
    return {
      address: listener.address,
      ready: ready.promise,
      close: () => stop(new Error("Executor bootstrap closed")),
    };
  } catch (error) {
    stop(error instanceof Error ? error : new Error("Executor bootstrap failed"));
    throw failure;
  }
}
