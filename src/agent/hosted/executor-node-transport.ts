import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { type AddressInfo, isIP, type Socket } from "node:net";
import process from "node:process";
import { connect, createServer, type TLSSocket } from "node:tls";
import type { ExecutorByteTransport } from "#veryfront/agent/executor/channel.ts";
import type { ExecutorBinding } from "#veryfront/agent/executor/protocol.ts";

const MAX_CHUNK_BYTES = 1024 * 1024;
const HIGH_WATER_MARK = 16 * 1024;
const HANDSHAKE_TIMEOUT_MS = 5_000;
const MAX_PENDING_SOCKETS = 4;
const TLS_OPTIONS = {
  minVersion: "TLSv1.3",
  maxVersion: "TLSv1.3",
  ciphers: "TLS_AES_128_GCM_SHA256",
  highWaterMark: HIGH_WATER_MARK,
} as const;

interface ExecutorTransportOptions {
  binding: ExecutorBinding;
  /** Fresh 32-byte allocation authority, delivered to both peers by their owner. */
  key: Uint8Array;
  signal?: AbortSignal;
  /** Total lifetime from setup. Use the allocation's remaining lifetime. Default 30s, maximum 24h. */
  timeoutMs?: number;
}

export interface ConnectExecutorTransportOptions extends ExecutorTransportOptions {
  /** IP literal returned by the trusted allocator. Hostnames and URLs are rejected. */
  podIp: string;
  port: number;
}

export interface ListenExecutorTransportOptions extends ExecutorTransportOptions {
  host: string;
  /** Zero requests an ephemeral port. */
  port: number;
}

export interface ExecutorNodeTransport extends ExecutorByteTransport {
  /** Permanently destroy both directions and settle pending I/O. */
  close(): void;
}

export interface ExecutorTransportListener {
  readonly address: Readonly<AddressInfo>;
  readonly connection: Promise<ExecutorNodeTransport>;
  /** Revoke the allocation, including an already attached connection. */
  close(): void;
}

function validateOptions(
  options: ExecutorTransportOptions,
  host: string,
  port: number,
  listen = false,
) {
  if (
    "Deno" in globalThis || "Bun" in globalThis || process.release.name !== "node" ||
    Number(process.versions.node.split(".")[0]) < 22
  ) {
    throw new Error("Executor TLS transport requires Node.js 22 or newer");
  }
  const binding = options.binding;
  if (
    !binding || Object.keys(binding).length !== 3 ||
    !Object.hasOwn(binding, "allocationId") || !Object.hasOwn(binding, "generation") ||
    !Object.hasOwn(binding, "invocationId") ||
    typeof binding.allocationId !== "string" || !binding.allocationId.length ||
    binding.allocationId.length > 128 ||
    typeof binding.invocationId !== "string" || !binding.invocationId.length ||
    binding.invocationId.length > 128 ||
    !Number.isSafeInteger(binding.generation) || binding.generation <= 0
  ) throw new TypeError("Invalid executor transport binding");
  if (typeof host !== "string" || !isIP(host)) {
    throw new TypeError("Executor transport requires an IP literal");
  }
  if (!Number.isInteger(port) || port < (listen ? 0 : 1) || port > 65535) {
    throw new TypeError("Invalid executor transport port");
  }
  if (!(options.key instanceof Uint8Array) || options.key.byteLength !== 32) {
    throw new TypeError("Executor transport requires a 32-byte allocation key");
  }
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 24 * 60 * 60 * 1000) {
    throw new TypeError("Invalid executor transport lifetime");
  }
  if (options.signal?.aborted) throw new Error("Executor transport aborted");
  // Fixed tuple ordering and a versioned domain prevent ambiguous identity encodings.
  const identity = createHash("sha256").update(JSON.stringify([
    "veryfront-executor-tls",
    1,
    binding.allocationId,
    binding.generation,
    binding.invocationId,
  ])).digest("hex");
  return { identity, key: Buffer.from(options.key), timeoutMs };
}

/** Node-only TLS 1.3 PSK. No certificate fallback, session reuse, or reconnect. */
export async function connectExecutorTransport(
  options: ConnectExecutorTransportOptions,
): Promise<ExecutorNodeTransport> {
  const { key, identity, timeoutMs } = validateOptions(options, options.podIp, options.port);
  return await new Promise<ExecutorNodeTransport>((resolve, reject) => {
    let socket: TLSSocket | undefined;
    let streams: ReturnType<typeof socketTransport> | undefined;
    let stopped = false;
    let offeredPsk = false;
    const stop = (error: Error) => {
      if (stopped) return;
      stopped = true;
      clearTimeout(lifetime);
      clearTimeout(handshake);
      options.signal?.removeEventListener("abort", abort);
      key.fill(0);
      if (streams) streams.fail(error);
      else socket?.destroy();
      reject(error);
    };
    const abort = () => stop(new Error("Executor transport aborted"));
    const lifetime = setTimeout(
      () => stop(new Error("Executor transport deadline exceeded")),
      timeoutMs,
    );
    const handshake = setTimeout(
      () => stop(new Error("Executor transport handshake deadline exceeded")),
      Math.min(timeoutMs, HANDSHAKE_TIMEOUT_MS),
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    const failed = () => stop(new Error("Executor transport authentication failed"));
    try {
      socket = connect({
        ...TLS_OPTIONS,
        host: options.podIp,
        port: options.port,
        rejectUnauthorized: true,
        pskCallback: () => {
          offeredPsk = true;
          return { identity, psk: key };
        },
        // Node requires a custom check for certificate-free PSK. A certificate
        // must never authorize an endpoint that does not possess the allocation key.
        checkServerIdentity: (_host, certificate) =>
          offeredPsk && Object.keys(certificate).length === 0
            ? undefined
            : new Error("Executor transport authentication failed"),
      });
      socket.once("error", failed);
      socket.once("close", failed);
      socket.once("secureConnect", () => {
        if (stopped) return;
        if (
          !offeredPsk || !socket!.authorized || socket!.getProtocol() !== "TLSv1.3" ||
          socket!.getCipher().standardName !== TLS_OPTIONS.ciphers ||
          Object.keys(socket!.getPeerCertificate()).length !== 0
        ) {
          failed();
          return;
        }
        clearTimeout(handshake);
        key.fill(0);
        socket!.removeListener("error", failed);
        socket!.removeListener("close", failed);
        streams = socketTransport(socket!, stop);
        resolve(streams.transport);
      });
    } catch {
      failed();
    }
  });
}

/**
 * Listen for exactly one authenticated attachment. The address is ready when
 * this resolves; connection resolves only after TLS authentication. Successful
 * attachment closes the listener while the established transport stays usable.
 */
export async function listenExecutorTransport(
  options: ListenExecutorTransportOptions,
): Promise<ExecutorTransportListener> {
  const { key, identity, timeoutMs } = validateOptions(options, options.host, options.port, true);
  const attachment = Promise.withResolvers<ExecutorNodeTransport>();
  const ready = Promise.withResolvers<ExecutorTransportListener>();
  void attachment.promise.catch(() => {});
  const pending = new Map<Socket, ReturnType<typeof setTimeout>>();
  const identified = new WeakSet<TLSSocket>();
  let streams: ReturnType<typeof socketTransport> | undefined;
  let stopped = false;
  let attached = false;
  let server: ReturnType<typeof createServer>;
  try {
    server = createServer({
      ...TLS_OPTIONS,
      handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
      pskCallback(socket, presentedIdentity) {
        if (stopped || attached || presentedIdentity !== identity) return null;
        identified.add(socket);
        return key;
      },
    });
  } catch {
    key.fill(0);
    throw new Error("Executor transport listener failed");
  }
  server.maxConnections = MAX_PENDING_SOCKETS;
  const stop = (error: Error) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(lifetime);
    options.signal?.removeEventListener("abort", abort);
    key.fill(0);
    server.close();
    for (const [socket, timer] of pending) {
      clearTimeout(timer);
      socket.destroy();
    }
    pending.clear();
    streams?.fail(error);
    attachment.reject(error);
    ready.reject(error);
  };
  const abort = () => stop(new Error("Executor transport aborted"));
  const lifetime = setTimeout(
    () => stop(new Error("Executor transport deadline exceeded")),
    timeoutMs,
  );
  options.signal?.addEventListener("abort", abort, { once: true });
  server.on("error", () => stop(new Error("Executor transport listener failed")));
  server.on("tlsClientError", (_error, socket) => socket.destroy());
  server.on("connection", (socket) => {
    if (stopped || attached || pending.size >= MAX_PENDING_SOCKETS) {
      socket.destroy();
      return;
    }
    const timer = setTimeout(() => socket.destroy(), Math.min(timeoutMs, HANDSHAKE_TIMEOUT_MS));
    pending.set(socket, timer);
    socket.once("close", () => {
      clearTimeout(timer);
      pending.delete(socket);
    });
  });
  server.on("secureConnection", (socket) => {
    if (
      stopped || attached || !identified.has(socket) || socket.getProtocol() !== "TLSv1.3" ||
      socket.getCipher().standardName !== TLS_OPTIONS.ciphers
    ) {
      socket.destroy();
      return;
    }
    attached = true;
    key.fill(0);
    // TLS wraps the raw connection. The remote endpoint uniquely identifies the
    // accepted TCP connection without accessing Node's private socket fields.
    for (const [raw, timer] of pending) {
      clearTimeout(timer);
      if (raw.remoteAddress !== socket.remoteAddress || raw.remotePort !== socket.remotePort) {
        raw.destroy();
      }
    }
    pending.clear();
    server.close();
    streams = socketTransport(socket, stop);
    attachment.resolve(streams.transport);
  });
  try {
    server.listen({ host: options.host, port: options.port, backlog: MAX_PENDING_SOCKETS }, () => {
      if (stopped) {
        server.close();
        return;
      }
      const address = server.address();
      if (!address || typeof address === "string") {
        stop(new Error("Executor transport listener failed"));
        return;
      }
      ready.resolve({
        address: Object.freeze(address),
        connection: attachment.promise,
        close: () => stop(new Error("Executor transport closed")),
      });
    });
  } catch {
    stop(new Error("Executor transport listener failed"));
  }
  return await ready.promise;
}

function socketTransport(socket: TLSSocket, onClose: (error: Error) => void) {
  let failure: Error | undefined;
  let readController: ReadableStreamDefaultController<Uint8Array>;
  let writeController: WritableStreamDefaultController;
  let rejectWrite: ((error: Error) => void) | undefined;
  const fail = (error: Error) => {
    if (failure) return;
    failure = error;
    socket.pause();
    socket.removeListener("data", data);
    socket.removeListener("end", disconnected);
    writeController.signal.removeEventListener("abort", abortWrite);
    readController.error(error);
    writeController.error(error);
    rejectWrite?.(error);
    rejectWrite = undefined;
    socket.destroy();
    onClose(error);
  };
  const disconnected = () => fail(new Error("Executor transport disconnected"));
  const aborted = () => fail(new Error("Executor transport aborted"));
  // Avoid reentering Node's WritableStream abort state transition from its signal.
  const abortWrite = () => queueMicrotask(aborted);
  const data = (chunk: Buffer) => {
    if (chunk.byteLength > MAX_CHUNK_BYTES) {
      fail(new Error("Executor transport chunk exceeds byte limit"));
      return;
    }
    readController.enqueue(chunk);
    if ((readController.desiredSize ?? 0) <= 0) socket.pause();
  };
  socket.pause();
  socket.setNoDelay(true);
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      readController = controller;
    },
    pull() {
      if (!failure) socket.resume();
    },
    cancel() {
      fail(new Error("Executor transport closed"));
    },
  }, { highWaterMark: HIGH_WATER_MARK, size: (chunk) => chunk.byteLength });
  const writable = new WritableStream<Uint8Array>({
    start(controller) {
      writeController = controller;
      // The signal fires immediately, even while a socket write is blocked.
      controller.signal.addEventListener("abort", abortWrite, { once: true });
    },
    write(chunk) {
      if (failure) return Promise.reject(failure);
      if (!(chunk instanceof Uint8Array) || chunk.byteLength > MAX_CHUNK_BYTES) {
        const error = new Error("Executor transport chunk exceeds byte limit");
        fail(error);
        return Promise.reject(error);
      }
      return new Promise<void>((resolve, reject) => {
        rejectWrite = reject;
        socket.write(new Uint8Array(chunk), (error) => {
          rejectWrite = undefined;
          if (failure) reject(failure);
          else if (error) {
            fail(new Error("Executor transport write failed"));
            reject(failure);
          } else resolve();
        });
      });
    },
    close() {
      fail(new Error("Executor transport closed"));
    },
    abort: aborted,
  }, {
    highWaterMark: HIGH_WATER_MARK,
    size: (chunk) => chunk instanceof Uint8Array ? chunk.byteLength : 1,
  });
  socket.on("data", data);
  socket.once("end", disconnected);
  socket.on("error", disconnected);
  socket.once("close", () => {
    disconnected();
    socket.removeListener("error", disconnected);
  });
  return {
    transport: { readable, writable, close: () => fail(new Error("Executor transport closed")) },
    fail,
  };
}
