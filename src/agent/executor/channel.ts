import { encodePrivateText } from "#veryfront/security/private-text.ts";
import { privateByteLength } from "#veryfront/security/private-bytes.ts";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import {
  encodeExecutorFrame,
  EXECUTOR_MAX_CONCURRENT_CALLS,
  EXECUTOR_MAX_FRAME_BYTES,
  EXECUTOR_MAX_RETAINED_BYTES,
  EXECUTOR_MAX_TIMEOUT_MS,
  EXECUTOR_PROTOCOL_VERSION,
  EXECUTOR_STREAM_WINDOW,
  type ExecutorBinding,
  type ExecutorFrame,
  type ExecutorMessage,
  ExecutorProtocolError,
  getExecutorBindingSchema,
  readExecutorFrames,
} from "./protocol.ts";

/** A connection authenticated by its owner before channel construction. No reconnect or replay. */
export interface ExecutorByteTransport {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

/** Operation handlers validate their own payload schema before performing any privileged action. */
export interface ExecutorOperationContext {
  readonly binding: Readonly<ExecutorBinding>;
  readonly signal: AbortSignal;
  readonly deadline: number;
}

/** Explicit local allowlist. Handler errors are replaced with a fixed wire error. */
export type ExecutorOperation =
  | {
    mode: "unary";
    handle: (input: JsonValue, context: ExecutorOperationContext) => JsonValue | Promise<JsonValue>;
  }
  | {
    mode: "stream";
    handle: (input: JsonValue, context: ExecutorOperationContext) => AsyncIterable<JsonValue>;
  };

export interface ExecutorCallOptions {
  signal?: AbortSignal;
  /** Covers readiness, execution, and consumption. Defaults to the channel timeout. */
  timeoutMs?: number;
}

export interface ExecutorChannelOptions {
  binding: ExecutorBinding;
  transport: ExecutorByteTransport;
  operations?: ReadonlyMap<string, ExecutorOperation>;
  /** Per direction, including completed streams with unread data. Maximum 32. */
  maxConcurrentCalls?: number;
  /** Maximum lifetime also enforced on incoming calls. Default 30 seconds, maximum 24 hours. */
  defaultTimeoutMs?: number;
  /** Default five seconds, maximum one minute. */
  handshakeTimeoutMs?: number;
  /** Close if cancellation is unacknowledged or a handler does not settle. Default five seconds. */
  cancellationTimeoutMs?: number;
  /** Aggregate JSON payload bytes retained by requests and unread results. Default and maximum 8 MiB. */
  maxRetainedPayloadBytes?: number;
}

export interface ExecutorChannel {
  readonly ready: Promise<void>;
  /** Resolves on closure; the fixed diagnostic never includes transport or handler error text. */
  readonly closed: Promise<Error>;
  /** Resolves after closure and actual handler/owned transport cleanup. Keep admission until this settles. */
  readonly settled: Promise<void>;
  readonly signal: AbortSignal;
  request(operation: string, input: JsonValue, options?: ExecutorCallOptions): Promise<JsonValue>;
  /** Single consumer. Concurrent next() calls reject without adding a waiter. */
  stream(
    operation: string,
    input: JsonValue,
    options?: ExecutorCallOptions,
  ): AsyncIterableIterator<JsonValue>;
  close(): void;
}

type EndError = Extract<ExecutorMessage, { type: "end" }>["error"];
type Deferred<T> = ReturnType<typeof Promise.withResolvers<T>>;

interface OutgoingCall {
  id: number;
  deadline: number;
  pendingRequest?: Extract<ExecutorMessage, { type: "request" }>;
  inputBytes: number;
  mode: "unary" | "stream";
  queue: { value: JsonValue; bytes: number }[];
  completion: Deferred<void>;
  releaseAck?: Deferred<void>;
  received: number;
  consumed: number;
  unaryBytes: number;
  ended: boolean;
  released: boolean;
  release?: Promise<void>;
  cancelled: boolean;
  reading: boolean;
  error?: Error;
  wake?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  cancellationTimer?: ReturnType<typeof setTimeout>;
  removeAbortListener?: () => void;
}

interface IncomingCall {
  id: number;
  deadline: number;
  payloadBytes: number;
  controller: AbortController;
  mode: "unary" | "stream";
  sent: number;
  consumed: number;
  ended: boolean;
  released: boolean;
  cancelled: boolean;
  settled: boolean;
  wake?: () => void;
  timer?: ReturnType<typeof setTimeout>;
  cancellationTimer?: ReturnType<typeof setTimeout>;
}

function positiveBound(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError("Executor channel option exceeds its positive integer limit");
  }
  return value;
}

/**
 * Create an internal invocation channel. This module makes no authentication,
 * network, credential, or project-loading decisions. Register SchemaValidator
 * before construction. Transport closure revokes this channel permanently.
 */
export function createExecutorChannel(options: ExecutorChannelOptions): ExecutorChannel {
  return new Channel(options);
}

class Channel implements ExecutorChannel {
  readonly #binding: Readonly<ExecutorBinding>;
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly #writer: WritableStreamDefaultWriter<Uint8Array>;
  readonly #operations: ReadonlyMap<string, ExecutorOperation>;
  readonly #maxCalls: number;
  readonly #timeout: number;
  readonly #cancellationTimeout: number;
  readonly #maxRetainedBytes: number;
  #retainedBytes = 0;
  readonly #controller = new AbortController();
  readonly #ready = Promise.withResolvers<void>();
  readonly #closed = Promise.withResolvers<Error>();
  readonly #settled = Promise.withResolvers<void>();
  readonly #outgoing = new Set<OutgoingCall>();
  readonly #outgoingById = new Map<number, OutgoingCall>();
  readonly #incoming = new Map<number, IncomingCall>();
  readonly #writes: { bytes: Uint8Array; done: Deferred<void> }[] = [];
  #queuedBytes = 0;
  #writing = false;
  #activeHandlers = 0;
  #readLoopDone = false;
  #readRetired = false;
  #writeRetired = false;
  #sendSequence = 0;
  #receiveSequence = 0;
  #nextId = 0;
  #lastReceivedId = 0;
  #receivedHello = false;
  #error?: Error;
  #handshakeTimer: ReturnType<typeof setTimeout>;

  constructor(options: ExecutorChannelOptions) {
    this.#binding = Object.freeze(getExecutorBindingSchema().parse(options.binding));
    this.#maxCalls = positiveBound(options.maxConcurrentCalls ?? 32, EXECUTOR_MAX_CONCURRENT_CALLS);
    this.#timeout = positiveBound(options.defaultTimeoutMs ?? 30_000, EXECUTOR_MAX_TIMEOUT_MS);
    this.#cancellationTimeout = positiveBound(options.cancellationTimeoutMs ?? 5_000, 60_000);
    this.#maxRetainedBytes = positiveBound(
      options.maxRetainedPayloadBytes ?? EXECUTOR_MAX_RETAINED_BYTES,
      EXECUTOR_MAX_RETAINED_BYTES,
    );
    const handshakeTimeout = positiveBound(options.handshakeTimeoutMs ?? 5_000, 60_000);
    this.#operations = new Map(options.operations);
    this.#reader = options.transport.readable.getReader();
    this.#writer = options.transport.writable.getWriter();
    this.#handshakeTimer = setTimeout(
      () => this.#fail("Executor handshake deadline exceeded"),
      handshakeTimeout,
    );
    // Readiness remains rejectable for callers that await it, even when nobody observes it yet.
    void this.ready.catch(() => {});
    this.#control({ type: "hello" });
    void this.#receive().finally(() => {
      this.#readLoopDone = true;
      this.#settle();
    });
  }

  get ready(): Promise<void> {
    return this.#ready.promise;
  }
  get closed(): Promise<Error> {
    return this.#closed.promise;
  }
  get settled(): Promise<void> {
    return this.#settled.promise;
  }
  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  close(): void {
    this.#fail("Executor channel closed");
  }

  async request(
    operation: string,
    input: JsonValue,
    options: ExecutorCallOptions = {},
  ): Promise<JsonValue> {
    const call = this.#start(operation, "unary", input, options);
    try {
      const first = await this.#next(call);
      if (first.done) throw new Error("Executor unary result is missing");
      await this.#next(call);
      return first.value;
    } finally {
      try {
        await call.completion.promise;
      } finally {
        this.#retainedBytes -= call.unaryBytes;
        call.unaryBytes = 0;
      }
    }
  }

  stream(
    operation: string,
    input: JsonValue,
    options: ExecutorCallOptions = {},
  ): AsyncIterableIterator<JsonValue> {
    const call = this.#start(operation, "stream", input, options);
    return {
      next: () => this.#next(call),
      return: async () => {
        this.#cancelOutgoing(call, "cancelled");
        await call.completion.promise;
        return { done: true, value: undefined };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  #start(
    operation: string,
    mode: "unary" | "stream",
    input: JsonValue,
    options: ExecutorCallOptions,
  ): OutgoingCall {
    if (this.#error) throw new Error("Executor channel closed");
    if (options.signal?.aborted) throw new Error("Executor call cancelled");
    if (this.#outgoing.size >= this.#maxCalls) {
      throw new Error("Executor concurrent call limit exceeded");
    }
    const timeoutMs = positiveBound(options.timeoutMs ?? this.#timeout, this.#timeout);
    const snapshot = snapshotBoundedJsonValue(input);
    if (!snapshot.success) throw new TypeError("Executor call requires bounded JSON data");
    const message: Extract<ExecutorMessage, { type: "request" }> = {
      type: "request",
      id: 1,
      operation,
      mode,
      timeoutMs,
      value: snapshot.value,
    };
    // Reject invalid local input before reserving a call or emitting any bytes.
    encodeExecutorFrame({
      version: EXECUTOR_PROTOCOL_VERSION,
      binding: this.#binding,
      sequence: 0,
      message,
    });
    const call: OutgoingCall = {
      id: 0,
      deadline: Date.now() + timeoutMs,
      pendingRequest: message,
      inputBytes: this.#retainPayload(snapshot.value),
      mode,
      queue: [],
      completion: Promise.withResolvers<void>(),
      received: 0,
      consumed: 0,
      unaryBytes: 0,
      ended: false,
      released: false,
      cancelled: false,
      reading: false,
    };
    void call.completion.promise.catch(() => {});
    this.#outgoing.add(call);
    call.timer = setTimeout(() => this.#cancelOutgoing(call, "deadline"), timeoutMs);
    if (options.signal) {
      const signal = options.signal;
      const abort = () => this.#cancelOutgoing(call, "cancelled");
      signal.addEventListener("abort", abort, { once: true });
      call.removeAbortListener = () => signal.removeEventListener("abort", abort);
      if (signal.aborted) abort();
    }
    if (this.#receivedHello) void this.#beginOutgoing(call);
    return call;
  }

  async #beginOutgoing(call: OutgoingCall): Promise<void> {
    const message = call.pendingRequest;
    if (!message || call.released || call.cancelled || this.#error) return;
    const inputBytes = call.inputBytes;
    call.pendingRequest = undefined;
    call.inputBytes = 0;
    try {
      const remaining = call.deadline - Date.now();
      if (remaining <= 0) {
        this.#cancelOutgoing(call, "deadline");
        return;
      }
      call.id = ++this.#nextId;
      this.#outgoingById.set(call.id, call);
      await this.#send({ ...message, id: call.id, timeoutMs: remaining });
    } catch {
      if (!this.#error) this.#fail("Executor channel write failed");
    } finally {
      this.#retainedBytes -= inputBytes;
    }
  }

  async #next(call: OutgoingCall): Promise<IteratorResult<JsonValue>> {
    if (call.reading) throw new Error("Executor stream permits one pending consumer read");
    call.reading = true;
    try {
      while (!call.error && !call.queue.length && !call.ended) {
        await new Promise<void>((resolve) => {
          call.wake = resolve;
        });
      }
      if (call.error) throw call.error;
      if (!call.queue.length) {
        await this.#releaseOutgoing(call);
        return { done: true, value: undefined };
      }
      const { value, bytes } = call.queue.shift()!;
      if (call.mode === "unary") call.unaryBytes = bytes;
      try {
        call.consumed++;
        if (call.mode === "stream") {
          await this.#send({ type: "credit", id: call.id, consumed: call.consumed });
        }
        if (call.error) throw call.error;
        if (call.ended && !call.queue.length) await this.#releaseOutgoing(call);
        return { done: false, value };
      } finally {
        if (call.mode === "stream") this.#retainedBytes -= bytes;
      }
    } finally {
      call.reading = false;
      call.wake = undefined;
    }
  }

  #cancelOutgoing(call: OutgoingCall, reason: "cancelled" | "deadline"): void {
    if (this.#error || call.released || call.cancelled) return;
    call.cancelled = true;
    call.error = new Error(`Executor call ${reason}`);
    this.#clearResults(call);
    call.wake?.();
    this.#clearCallTimers(call);
    if (!call.id || call.ended) {
      void this.#releaseOutgoing(call).catch(() => {});
    } else {
      this.#control({ type: "cancel", id: call.id });
      call.cancellationTimer = setTimeout(
        () => this.#fail("Executor cancellation deadline exceeded"),
        this.#cancellationTimeout,
      );
    }
  }

  #releaseOutgoing(call: OutgoingCall): Promise<void> {
    if (call.release) return call.release;
    call.released = true;
    this.#clearCallTimers(call);
    this.#clearPendingInput(call);
    call.release = (async () => {
      try {
        // Keep the admission slot and a deadline until release is written.
        if (call.id && !this.#error) {
          call.releaseAck = Promise.withResolvers<void>();
          const acknowledgement = call.releaseAck;
          void acknowledgement.promise.catch(() => {});
          call.cancellationTimer = setTimeout(
            () => this.#fail("Executor release write deadline exceeded"),
            this.#cancellationTimeout,
          );
          await this.#send({ type: "release", id: call.id });
          await acknowledgement.promise;
        }
        call.completion.resolve();
      } catch (error) {
        call.completion.reject(error);
        throw error;
      } finally {
        this.#clearCallTimers(call);
        this.#outgoing.delete(call);
        this.#outgoingById.delete(call.id);
      }
    })();
    return call.release;
  }

  async #receive(): Promise<void> {
    try {
      for await (const frame of readExecutorFrames(this.#reader)) {
        if (this.#error) return;
        this.#accept(frame);
      }
      this.#fail("Executor channel disconnected");
    } catch (error) {
      // Protocol diagnostics are fixed; transport exceptions may contain private details.
      this.#fail(
        error instanceof ExecutorProtocolError ? error.message : "Executor channel read failed",
      );
    } finally {
      this.#reader.releaseLock();
    }
  }

  #accept(frame: ExecutorFrame): void {
    if (
      frame.binding.allocationId !== this.#binding.allocationId ||
      frame.binding.generation !== this.#binding.generation ||
      frame.binding.invocationId !== this.#binding.invocationId
    ) {
      throw new ExecutorProtocolError("Executor channel identity mismatch");
    }
    if (frame.sequence !== this.#receiveSequence++) {
      throw new ExecutorProtocolError("Executor frame sequence violation");
    }
    const message = frame.message;
    if (!this.#receivedHello) {
      if (message.type !== "hello") {
        throw new ExecutorProtocolError("Executor hello frame required");
      }
      this.#receivedHello = true;
      clearTimeout(this.#handshakeTimer);
      this.#ready.resolve();
      for (const call of this.#outgoing) void this.#beginOutgoing(call);
      return;
    }
    if (message.type === "hello") throw new ExecutorProtocolError("Executor duplicate hello frame");
    if (message.type === "request") {
      this.#acceptRequest(message);
      return;
    }
    if (message.type === "released") {
      const call = this.#outgoingById.get(message.id);
      if (!call?.releaseAck || !call.ended) {
        throw new ExecutorProtocolError("Executor unknown release acknowledgement");
      }
      call.releaseAck.resolve();
      call.releaseAck = undefined;
      return;
    }
    if (message.type === "data" || message.type === "end") {
      const call = this.#outgoingById.get(message.id);
      if (!call || call.ended || call.released) {
        throw new ExecutorProtocolError("Executor unknown or completed response");
      }
      if (message.type === "data") {
        if (
          message.index !== call.received ||
          call.received - call.consumed >= (call.mode === "stream" ? EXECUTOR_STREAM_WINDOW : 1) ||
          (call.mode === "unary" && call.received !== 0)
        ) throw new ExecutorProtocolError("Executor result sequence or credit violation");
        call.received++;
        if (!call.cancelled) {
          const bytes = this.#retainPayload(message.value);
          call.queue.push({ value: message.value, bytes });
        }
      } else {
        call.ended = true;
        if (!message.error && !call.cancelled && call.mode === "unary" && call.received !== 1) {
          throw new ExecutorProtocolError("Executor unary result is missing");
        }
        if (message.error) {
          call.error ??= new Error(`Executor call ${message.error}`);
          this.#clearResults(call);
        }
        if (!call.queue.length) void this.#releaseOutgoing(call).catch(() => {});
      }
      call.wake?.();
      return;
    }
    const call = this.#incoming.get(message.id);
    if (!call || call.released) throw new ExecutorProtocolError("Executor unknown call control");
    if (message.type === "credit") {
      if (
        call.mode !== "stream" || message.consumed !== call.consumed + 1 ||
        message.consumed > call.sent
      ) {
        throw new ExecutorProtocolError("Executor consumption credit violation");
      }
      call.consumed = message.consumed;
      call.wake?.();
    } else if (message.type === "cancel") {
      if (call.cancelled) throw new ExecutorProtocolError("Executor duplicate cancellation");
      call.cancelled = true;
      this.#abortIncoming(call, "cancelled");
    } else {
      if (!call.ended) throw new ExecutorProtocolError("Executor release before completion");
      call.released = true;
      this.#removeIncoming(call);
    }
  }

  #acceptRequest(message: Extract<ExecutorMessage, { type: "request" }>): void {
    if (message.id <= this.#lastReceivedId) {
      throw new ExecutorProtocolError("Executor request sequence violation");
    }
    if (this.#incoming.size >= this.#maxCalls) {
      throw new ExecutorProtocolError("Executor concurrent request limit exceeded");
    }
    this.#lastReceivedId = message.id;
    const timeout = Math.min(message.timeoutMs, this.#timeout);
    const call: IncomingCall = {
      id: message.id,
      deadline: Date.now() + timeout,
      payloadBytes: this.#retainPayload(message.value),
      mode: message.mode,
      controller: new AbortController(),
      sent: 0,
      consumed: 0,
      ended: false,
      released: false,
      cancelled: false,
      settled: false,
    };
    this.#incoming.set(call.id, call);
    call.timer = setTimeout(() => this.#abortIncoming(call, "deadline"), timeout);
    this.#activeHandlers++;
    void this.#run(call, message, call.deadline).catch(() => {
      this.#fail("Executor handler cleanup failed");
    }).finally(() => {
      this.#activeHandlers--;
      this.#settle();
    });
  }

  async #run(
    call: IncomingCall,
    message: Extract<ExecutorMessage, { type: "request" }>,
    deadline: number,
  ): Promise<void> {
    let iterator: AsyncIterator<JsonValue> | undefined;
    try {
      const operation = this.#operations.get(message.operation);
      if (!operation) {
        await this.#end(call, "operation-not-found");
        return;
      }
      if (operation.mode !== message.mode) {
        await this.#end(call, "mode-mismatch");
        return;
      }
      const context = { binding: this.#binding, signal: call.controller.signal, deadline };
      if (operation.mode === "unary") {
        const value = await operation.handle(message.value, context);
        if (call.ended || this.#error) return;
        await this.#send({ type: "data", id: call.id, index: call.sent++, value });
      } else {
        iterator = operation.handle(message.value, context)[Symbol.asyncIterator]();
        while (!call.ended && !this.#error) {
          while (
            call.sent - call.consumed >= EXECUTOR_STREAM_WINDOW && !call.ended && !this.#error
          ) {
            await new Promise<void>((resolve) => {
              call.wake = resolve;
            });
          }
          if (call.ended || this.#error) break;
          const next = await iterator.next();
          if (call.ended || this.#error || next.done) break;
          await this.#send({ type: "data", id: call.id, index: call.sent++, value: next.value });
        }
      }
      await this.#end(call);
    } catch {
      await this.#end(call, "operation-failed");
    } finally {
      try {
        if (iterator?.return) await iterator.return();
      } catch { /* Handler cleanup cannot expose its error. */ }
      call.settled = true;
      this.#retainedBytes -= call.payloadBytes;
      clearTimeout(call.cancellationTimer);
      this.#removeIncoming(call);
    }
  }

  #abortIncoming(call: IncomingCall, reason: "cancelled" | "deadline"): void {
    if (call.ended) return;
    call.controller.abort(new Error(`Executor call ${reason}`));
    call.wake?.();
    void this.#end(call, reason);
  }

  async #end(call: IncomingCall, error?: EndError): Promise<void> {
    if (call.ended || this.#error) return;
    call.ended = true;
    clearTimeout(call.timer);
    call.controller.abort(new Error("Executor call completed"));
    if (this.#error) return;
    call.timer = setTimeout(
      () => this.#fail("Executor completion release deadline exceeded"),
      Math.max(0, call.deadline - Date.now()) + this.#cancellationTimeout,
    );
    if (!call.settled) {
      call.cancellationTimer = setTimeout(
        () => this.#fail("Executor handler cancellation deadline exceeded"),
        this.#cancellationTimeout,
      );
    }
    const message: ExecutorMessage = { type: "end", id: call.id, ...(error ? { error } : {}) };
    try {
      await this.#send(message);
    } catch {
      this.#fail("Executor channel write failed");
    }
  }

  #removeIncoming(call: IncomingCall): void {
    if (call.released && call.settled) {
      clearTimeout(call.timer);
      clearTimeout(call.cancellationTimer);
      this.#incoming.delete(call.id);
      if (!this.#error) this.#control({ type: "released", id: call.id });
    }
  }

  #control(message: ExecutorMessage): void {
    void this.#send(message).catch(() => this.#fail("Executor channel write failed"));
  }

  #send(message: ExecutorMessage): Promise<void> {
    if (this.#error) return Promise.reject(this.#error);
    const bytes = encodeExecutorFrame({
      version: EXECUTOR_PROTOCOL_VERSION,
      binding: this.#binding,
      sequence: this.#sendSequence,
      message,
    });
    // Bound both queued bytes and control-frame bookkeeping, including the active write.
    if (
      this.#writes.length >= this.#maxCalls * 4 + EXECUTOR_STREAM_WINDOW ||
      this.#queuedBytes + privateByteLength(bytes) >
        EXECUTOR_STREAM_WINDOW * EXECUTOR_MAX_FRAME_BYTES
    ) {
      this.#fail("Executor write queue limit exceeded");
      return Promise.reject(this.#error);
    }
    this.#sendSequence++;
    const done = Promise.withResolvers<void>();
    this.#writes.push({ bytes, done });
    this.#queuedBytes += privateByteLength(bytes);
    if (!this.#writing) void this.#flush();
    return done.promise;
  }

  async #flush(): Promise<void> {
    this.#writing = true;
    try {
      while (this.#writes.length && !this.#error) {
        const entry = this.#writes[0]!;
        await this.#writer.write(entry.bytes);
        if (this.#error) return;
        this.#writes.shift();
        this.#queuedBytes -= privateByteLength(entry.bytes);
        entry.done.resolve();
      }
    } catch {
      this.#fail("Executor channel write failed");
    } finally {
      this.#writing = false;
      this.#settle();
    }
  }

  #clearCallTimers(call: OutgoingCall): void {
    clearTimeout(call.timer);
    clearTimeout(call.cancellationTimer);
    call.removeAbortListener?.();
  }

  #retainPayload(value: JsonValue): number {
    const bytes = privateByteLength(encodePrivateText(privateJsonStringify(value)));
    if (this.#retainedBytes + bytes > this.#maxRetainedBytes) {
      this.#fail("Executor retained payload budget exceeded");
      throw new ExecutorProtocolError("Executor retained payload budget exceeded");
    }
    this.#retainedBytes += bytes;
    return bytes;
  }

  #clearResults(call: OutgoingCall): void {
    for (const result of call.queue) this.#retainedBytes -= result.bytes;
    call.queue.length = 0;
  }

  #clearPendingInput(call: OutgoingCall): void {
    this.#retainedBytes -= call.inputBytes;
    call.inputBytes = 0;
    call.pendingRequest = undefined;
  }

  #fail(message: string): void {
    if (this.#error) return;
    const error = this.#error = new Error(message);
    clearTimeout(this.#handshakeTimer);
    this.#controller.abort(error);
    this.#ready.reject(error);
    for (const call of this.#outgoing) {
      this.#clearCallTimers(call);
      this.#clearPendingInput(call);
      call.error = error;
      this.#clearResults(call);
      call.releaseAck?.reject(error);
      call.completion.reject(error);
      call.wake?.();
    }
    for (const call of this.#incoming.values()) {
      clearTimeout(call.timer);
      clearTimeout(call.cancellationTimer);
      call.controller.abort(error);
      call.wake?.();
    }
    this.#outgoing.clear();
    this.#outgoingById.clear();
    this.#incoming.clear();
    for (const entry of this.#writes) entry.done.reject(error);
    this.#writes.length = 0;
    this.#queuedBytes = 0;
    void this.#reader.cancel(error).catch(() => {}).finally(() => {
      this.#readRetired = true;
      this.#settle();
    });
    void this.#writer.abort(error).catch(() => {}).finally(() => {
      this.#writer.releaseLock();
      this.#writeRetired = true;
      this.#settle();
    });
    this.#closed.resolve(error);
  }

  #settle(): void {
    if (
      this.#error && this.#activeHandlers === 0 && !this.#writing &&
      this.#readLoopDone && this.#readRetired && this.#writeRetired
    ) this.#settled.resolve();
  }
}
