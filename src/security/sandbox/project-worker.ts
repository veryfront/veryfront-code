/**
 * Project Worker
 *
 * Wraps a single Deno Worker for one project. Manages the Worker lifecycle,
 * sends/receives structured messages, enforces per-request timeouts,
 * and serializes errors across the Worker boundary.
 *
 * @module security/sandbox/project-worker
 */

import { serverLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { validateIsolatedSsrRendererModuleUrl } from "#veryfront/extensions/rendering/index.ts";
import {
  INVALID_ARGUMENT,
  SSR_OUTPUT_LIMIT_EXCEEDED,
  TIMEOUT_ERROR,
  UNKNOWN_ERROR,
} from "#veryfront/errors";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import {
  type ResolveWorkerHost,
  startWorkerEgressBroker,
  type WorkerEgressBroker,
} from "./worker-egress-guard.ts";
import type { WorkerPermissions } from "./worker-permissions.ts";
import { deserializeWorkerError } from "./worker-error-boundary.ts";
import type {
  SerializedError,
  WorkerRequest,
  WorkerResponse,
  WorkerSSRExecutionOpen,
  WorkerSSROutputLimit,
  WorkerSSRWireError,
  WorkerSSRWireResult,
  WorkerStreamCredit,
  WorkerStreamEnd,
  WorkerStreamFrame,
} from "./worker-types.ts";
import {
  MAX_WORKER_REQUEST_ID_CHARS,
  MAX_WORKER_SSR_CHUNK_BYTES,
  MAX_WORKER_SSR_OUTPUT_BYTES,
  MAX_WORKER_SSR_OUTPUT_CHUNKS,
} from "./worker-types.ts";

const logger = serverLogger.component("project-worker");
const textEncoder = new TextEncoder();
const NativeMessageChannel = MessageChannel;
const apply = Reflect.apply;
const eventTargetAddEventListener = EventTarget.prototype.addEventListener;
const eventPreventDefault = Event.prototype.preventDefault;
const messagePortClose = MessagePort.prototype.close;
const messagePortPostMessage = MessagePort.prototype.postMessage;
const messagePortStart = MessagePort.prototype.start;
const arrayIncludes = Array.prototype.includes;
const arrayPush = Array.prototype.push;
const arraySort = Array.prototype.sort;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const getPrototypeOf = Object.getPrototypeOf;
const ownKeys = Reflect.ownKeys;
const arrayIsArray = Array.isArray;
const freezeObject = Object.freeze;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringTrim = String.prototype.trim;
const textEncoderEncode = TextEncoder.prototype.encode;
const arrayBufferPrototype = ArrayBuffer.prototype;
const uint8ArrayPrototype = Uint8Array.prototype;
const typedArrayPrototype = getPrototypeOf(uint8ArrayPrototype);
const typedArrayBufferGetter = typedArrayPrototype
  ? getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get
  : undefined;
const typedArrayByteLengthGetter = typedArrayPrototype
  ? getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get
  : undefined;
const typedArrayByteOffsetGetter = typedArrayPrototype
  ? getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")?.get
  : undefined;
const arrayBufferByteLengthGetter = getOwnPropertyDescriptor(
  arrayBufferPrototype,
  "byteLength",
)?.get;
const arrayBufferResizableGetter = getOwnPropertyDescriptor(
  arrayBufferPrototype,
  "resizable",
)?.get;
const setBytes = Uint8Array.prototype.set;
let workerPostMessage: ((...args: never[]) => unknown) | undefined;

function postWorkerMessage(
  worker: Worker,
  message: unknown,
  transfer?: readonly Transferable[],
): void {
  const postMessage = workerPostMessage ??= worker.postMessage as (...args: never[]) => unknown;
  apply(
    postMessage,
    worker,
    transfer === undefined ? [message] : [message, transfer],
  );
}

function requireWorkerRequestId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_WORKER_REQUEST_ID_CHARS
  ) {
    throw INVALID_ARGUMENT.create({
      detail:
        `Worker request id must be a non-empty string no longer than ${MAX_WORKER_REQUEST_ID_CHARS} characters`,
    });
  }
  return value;
}

function requireRequestTimeoutMs(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_TIMER_DELAY_MS
  ) {
    throw INVALID_ARGUMENT.create({
      detail:
        `Project worker requestTimeoutMs must be a positive safe integer no greater than ${MAX_TIMER_DELAY_MS}`,
    });
  }
  return value;
}

const WORKER_PERMISSION_KEYS = Object.freeze(
  [
    "read",
    "write",
    "net",
    "env",
    "run",
    "ffi",
    "sys",
    "import",
  ] as const satisfies readonly (keyof WorkerPermissions)[],
);
const MAX_WORKER_PERMISSION_ENTRIES = 4_096;
const MAX_WORKER_PERMISSION_VALUE_CHARS = 16_384;
const MAX_WORKER_PERMISSION_UTF8_BYTES = 1024 * 1024;

function invalidWorkerPermissions(detail: string): never {
  throw new TypeError(`Project worker permissions ${detail}`);
}

function containsAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codePoint = apply(stringCharCodeAt, value, [index]);
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function snapshotPermissionScope(
  value: unknown,
  field: "read" | "env" | "import" | "net",
): boolean | readonly string[] {
  if (typeof value === "boolean") return value;

  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  let prototype: object | null;
  let isArray: boolean;
  try {
    isArray = arrayIsArray(value);
    prototype = typeof value === "object" && value !== null ? getPrototypeOf(value) : null;
    descriptors = typeof value === "object" && value !== null
      ? getOwnPropertyDescriptors(value)
      : {};
  } catch {
    return invalidWorkerPermissions(`${field} scope could not be inspected`);
  }
  if (!isArray || prototype !== Array.prototype) {
    return invalidWorkerPermissions(`${field} must be a boolean or plain string array`);
  }

  const lengthDescriptor = descriptors.length;
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (
    !Number.isSafeInteger(length) || length < 0 ||
    length > MAX_WORKER_PERMISSION_ENTRIES ||
    ownKeys(descriptors).length !== length + 1
  ) {
    return invalidWorkerPermissions(`${field} must be a bounded dense string array`);
  }

  const values: string[] = [];
  let utf8Bytes = 0;
  for (let index = 0; index < length; index++) {
    const descriptor = descriptors[String(index)];
    const entry = descriptor?.enumerable && "value" in descriptor ? descriptor.value : undefined;
    if (
      typeof entry !== "string" || entry.length === 0 ||
      entry.length > MAX_WORKER_PERMISSION_VALUE_CHARS ||
      apply(stringTrim, entry, []) !== entry || containsAsciiControl(entry)
    ) {
      return invalidWorkerPermissions(`${field} contains a noncanonical entry`);
    }
    utf8Bytes += apply(textEncoderEncode, textEncoder, [entry]).byteLength;
    if (utf8Bytes > MAX_WORKER_PERMISSION_UTF8_BYTES) {
      return invalidWorkerPermissions(`${field} exceeds its byte budget`);
    }
    if (!apply(arrayIncludes, values, [entry])) {
      apply(arrayPush, values, [entry]);
    }
  }

  apply(arraySort, values, []);
  return freezeObject(values);
}

function snapshotWorkerPermissions(value: unknown): Readonly<WorkerPermissions> {
  if (value === null || typeof value !== "object" || arrayIsArray(value)) {
    return invalidWorkerPermissions("must be a plain object");
  }

  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  let prototype: object | null;
  try {
    prototype = getPrototypeOf(value);
    descriptors = getOwnPropertyDescriptors(value);
  } catch {
    return invalidWorkerPermissions("could not be inspected");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidWorkerPermissions("must be a plain object");
  }

  const keys = ownKeys(descriptors);
  if (
    keys.length !== WORKER_PERMISSION_KEYS.length ||
    !WORKER_PERMISSION_KEYS.every((key) => keys.includes(key))
  ) {
    return invalidWorkerPermissions("must contain exactly the supported fields");
  }

  const readValue = (key: keyof WorkerPermissions): unknown => {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      return invalidWorkerPermissions(`${key} must be an enumerable data property`);
    }
    return descriptor.value;
  };
  const requireBoolean = (key: "write" | "net" | "run" | "ffi" | "sys"): boolean => {
    const candidate = readValue(key);
    if (typeof candidate !== "boolean") {
      return invalidWorkerPermissions(`${key} must be a boolean`);
    }
    return candidate;
  };

  return freezeObject({
    read: snapshotPermissionScope(readValue("read"), "read"),
    write: requireBoolean("write"),
    net: requireBoolean("net"),
    env: snapshotPermissionScope(readValue("env"), "env"),
    run: requireBoolean("run"),
    ffi: requireBoolean("ffi"),
    sys: requireBoolean("sys"),
    import: snapshotPermissionScope(readValue("import"), "import"),
  });
}

// Intersection with the DOM `WorkerOptions` so the value is assignable to the
// `Worker` constructor without suppression — Deno reads the extra `deno` field
// at runtime even though the DOM lib type doesn't declare it.
type ScopedWorkerPermissions = Omit<WorkerPermissions, "net"> & {
  net: readonly string[] | boolean;
};
type ExtendedWorkerOptions = WorkerOptions & {
  deno?: { permissions: Readonly<ScopedWorkerPermissions> };
};

export interface ProjectWorkerOptions {
  projectId: string;
  permissions: WorkerPermissions;
  requestTimeoutMs: number;
  workerScriptUrl?: string;
  /** Extension-owned renderer module imported only for isolated SSR requests. */
  isolatedSsrRendererModuleUrl?: string;
  /** Override for deterministic egress resolution tests. */
  egressResolveHost?: ResolveWorkerHost;
  /** Host-owned policy snapshot. Project code must never be able to change it. */
  allowInternalEgress: boolean;
}

interface PendingRequest {
  resolve: (value: WorkerResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  expectedTypes: readonly string[];
  ssr?: SSRWireState;
}

interface StreamHandler {
  state: SSRWireState;
  onFrame: (chunk: Uint8Array) => void;
  onEnd: () => void;
  onError: (error: Error) => void;
}

interface SSRWireState {
  readonly generation: string;
  readonly token: string;
  readonly delivery: "string" | "stream";
  expectedSequence: number;
  creditAvailable: boolean;
  frameBuffered: boolean;
  terminal: boolean;
  outputBytes: number;
  outputFrames: number;
}

type SSRWireMessage =
  | WorkerStreamFrame
  | WorkerStreamEnd
  | WorkerSSROutputLimit
  | WorkerSSRWireResult
  | WorkerSSRWireError;

function createSSROutputByteLimitError(): Error {
  return SSR_OUTPUT_LIMIT_EXCEEDED.create({
    detail: `Isolated SSR output exceeded ${MAX_WORKER_SSR_OUTPUT_BYTES} bytes`,
  });
}

function createSSROutputChunkLimitError(): Error {
  return SSR_OUTPUT_LIMIT_EXCEEDED.create({
    detail: `Isolated SSR output exceeded ${MAX_WORKER_SSR_OUTPUT_CHUNKS} chunks`,
  });
}

function isOversizedSSRHtml(value: string): boolean {
  return value.length > MAX_WORKER_SSR_OUTPUT_BYTES ||
    textEncoder.encode(value).byteLength > MAX_WORKER_SSR_OUTPUT_BYTES;
}

function readOwnDataProperty(value: object, key: string): unknown {
  const descriptor = getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function isSSRWireMessage(value: unknown): value is SSRWireMessage {
  if (value === null || typeof value !== "object") return false;
  const prototype = getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const type = readOwnDataProperty(value, "type");
  return type === "stream-frame" ||
    type === "stream-end" ||
    type === "ssr-output-limit" ||
    type === "ssr-wire-result" ||
    type === "ssr-wire-error";
}

function hasValidSSRWireEnvelope(
  message: SSRWireMessage,
  id: string,
  state: SSRWireState,
): boolean {
  const messageId = readOwnDataProperty(message, "id");
  const generation = readOwnDataProperty(message, "generation");
  const token = readOwnDataProperty(message, "token");
  const sequence = readOwnDataProperty(message, "sequence");
  return messageId === id &&
    generation === state.generation &&
    token === state.token &&
    typeof sequence === "number" &&
    Number.isSafeInteger(sequence) &&
    sequence >= 0 &&
    sequence <= MAX_WORKER_SSR_OUTPUT_CHUNKS &&
    sequence === state.expectedSequence;
}

/**
 * Copy an untrusted worker view into a fixed, offset-zero ArrayBuffer.
 *
 * A view backed by SharedArrayBuffer or a resizable ArrayBuffer is rejected:
 * either could change after accounting. Offset views over large fixed buffers
 * are accepted, but only their visible bytes are retained.
 */
function copyTightFixedWorkerFrame(value: unknown): Uint8Array {
  if (
    value === null ||
    typeof value !== "object" ||
    getPrototypeOf(value) !== uint8ArrayPrototype ||
    !typedArrayBufferGetter ||
    !typedArrayByteLengthGetter ||
    !typedArrayByteOffsetGetter ||
    !arrayBufferByteLengthGetter
  ) {
    throw new TypeError("Worker returned a non-native isolated SSR frame");
  }

  const buffer = apply(typedArrayBufferGetter, value, []) as unknown;
  if (
    buffer === null ||
    typeof buffer !== "object" ||
    getPrototypeOf(buffer) !== arrayBufferPrototype
  ) {
    throw new TypeError("Worker returned a shared isolated SSR frame");
  }
  if (
    arrayBufferResizableGetter &&
    apply(arrayBufferResizableGetter, buffer, []) === true
  ) {
    throw new TypeError("Worker returned a resizable isolated SSR frame");
  }

  const byteLength = apply(typedArrayByteLengthGetter, value, []) as number;
  const byteOffset = apply(typedArrayByteOffsetGetter, value, []) as number;
  const bufferByteLength = apply(arrayBufferByteLengthGetter, buffer, []) as number;
  if (
    !Number.isSafeInteger(byteLength) ||
    !Number.isSafeInteger(byteOffset) ||
    byteLength < 0 ||
    byteOffset < 0 ||
    byteOffset > bufferByteLength ||
    byteLength > bufferByteLength - byteOffset
  ) {
    throw new TypeError("Worker returned an invalid isolated SSR frame view");
  }

  const source = value as Uint8Array;
  const copy = new Uint8Array(byteLength);
  apply(setBytes, copy, [source]);
  return copy;
}

function isSerializedWorkerError(value: unknown): value is SerializedError {
  return value !== null &&
    typeof value === "object" &&
    typeof readOwnDataProperty(value, "name") === "string" &&
    typeof readOwnDataProperty(value, "message") === "string";
}

/**
 * Status of a project worker.
 */
export type WorkerStatus = "idle" | "busy" | "crashed" | "terminated";

function expectedResponseTypes(request: WorkerRequest): readonly string[] {
  switch (request.type) {
    case "execute-app-route":
    case "execute-pages-route":
      return ["result", "prepared-module-capacity", "error"];
    case "inspect-api-route-methods":
      return ["api-route-methods", "prepared-module-capacity", "error"];
    case "fetch-data":
      return ["data-result", "error"];
    case "render-ssr":
      return ["ssr-wire-result", "ssr-wire-error", "ssr-output-limit"];
    default:
      // Runtime callers can still cross the TypeScript boundary. The worker
      // owns validation and reports unknown request kinds as a typed error.
      return ["error"];
  }
}

export class ProjectWorker {
  readonly projectId: string;

  private worker: Worker | null = null;
  private controlPort: MessagePort | null = null;
  private workerGeneration: string | null = null;
  private pending = new Map<string, PendingRequest>();
  private streamHandlers = new Map<string, StreamHandler>();
  private idleListeners = new Set<() => void>();
  private suppressIdleNotifications = false;
  private requestTimeoutMs: number;
  private readonly permissions: Readonly<WorkerPermissions>;
  private workerScriptUrl?: string;
  private readonly isolatedSsrRendererModuleUrl?: string;
  private egressResolveHost?: ResolveWorkerHost;
  private readonly allowInternalEgress: boolean;
  private egressBroker: WorkerEgressBroker | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private _requestCount = 0;
  private _lastActivityAt = Date.now();
  private _status: WorkerStatus = "idle";

  constructor(options: ProjectWorkerOptions) {
    this.projectId = options.projectId;
    this.permissions = snapshotWorkerPermissions(options.permissions);
    this.requestTimeoutMs = requireRequestTimeoutMs(options.requestTimeoutMs);
    this.workerScriptUrl = options.workerScriptUrl;
    this.isolatedSsrRendererModuleUrl = options.isolatedSsrRendererModuleUrl === undefined
      ? undefined
      : validateIsolatedSsrRendererModuleUrl(options.isolatedSsrRendererModuleUrl);
    this.egressResolveHost = options.egressResolveHost;
    if (typeof options.allowInternalEgress !== "boolean") {
      throw new TypeError("Project worker allowInternalEgress must be a boolean");
    }
    this.allowInternalEgress = options.allowInternalEgress;
  }

  get status(): WorkerStatus {
    return this._status;
  }

  get requestCount(): number {
    return this._requestCount;
  }

  get lastActivityAt(): number {
    return this._lastActivityAt;
  }

  get hasPendingRequests(): boolean {
    return this.pending.size > 0 || this.streamHandlers.size > 0;
  }

  /** Subscribe to the transition where all worker protocol work has settled. */
  onIdle(listener: () => void): () => void {
    this.idleListeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.idleListeners.delete(listener);
    };
  }

  /**
   * Start the worker. Idempotent — safe to call if already running.
   */
  start(): void {
    if (this.worker) return;
    if (this.shutdownPromise) {
      throw INVALID_ARGUMENT.create({
        message: "A terminated project worker cannot be restarted",
      });
    }
    if (this.workerScriptUrl && this.permissions.net) {
      throw INVALID_ARGUMENT.create({
        message: "Custom project worker scripts cannot use unrestricted network permissions",
      });
    }

    const allowInternalEgress = this.allowInternalEgress;
    let workerPermissions: Readonly<ScopedWorkerPermissions> = this.permissions;
    if (this.permissions.net === true) {
      this.egressBroker = startWorkerEgressBroker({
        allowInternalEgress,
        resolveHost: this.egressResolveHost,
      });
      workerPermissions = freezeObject({
        ...this.permissions,
        net: snapshotPermissionScope(this.egressBroker.config.netAllowlist, "net"),
      });
    }

    try {
      const workerUrl = this.getWorkerScriptUrl();
      const workerOptions: ExtendedWorkerOptions = {
        type: "module",
        name: "project-worker",
        deno: { permissions: workerPermissions },
      };

      this.worker = new Worker(workerUrl, workerOptions);
      this.workerGeneration = crypto.randomUUID();
      const startedWorker = this.worker;
      this._status = "idle";

      if (this.workerScriptUrl) {
        startedWorker.onmessage = (event: MessageEvent) => {
          if (this.worker !== startedWorker) return;
          this.handleMessage(event.data);
        };
        apply(eventTargetAddEventListener, startedWorker, [
          "messageerror",
          () => {
            if (this.worker !== startedWorker) return;
            this.failWorker("crashed", "Worker message could not be deserialized");
          },
        ]);
      } else {
        const channel = new NativeMessageChannel();
        this.controlPort = channel.port1;
        const controlPort = this.controlPort;
        apply(eventTargetAddEventListener, controlPort, [
          "message",
          (event: MessageEvent) => {
            if (this.controlPort !== controlPort || this.worker !== startedWorker) return;
            this.handleMessage(event.data);
          },
        ]);
        apply(eventTargetAddEventListener, controlPort, [
          "messageerror",
          () => {
            if (this.controlPort !== controlPort || this.worker !== startedWorker) return;
            this.failWorker("crashed", "Worker control message could not be deserialized");
          },
        ]);
        apply(messagePortStart, controlPort, []);

        postWorkerMessage(
          startedWorker,
          {
            type: "initialize-egress",
            ...(this.isolatedSsrRendererModuleUrl === undefined
              ? {}
              : { rendererModuleUrl: this.isolatedSsrRendererModuleUrl }),
            options: {
              allowInternalEgress,
              socksProxy: this.egressBroker?.config.socksProxy,
              httpBroker: this.egressBroker?.config.httpBroker,
            },
            controlPort: channel.port2,
          },
          [channel.port2],
        );
      }

      startedWorker.onerror = (event) => {
        apply(eventPreventDefault, event, []);
        if (this.worker !== startedWorker) return;
        logger.error("Worker error");
        this.failWorker("crashed", "Worker crashed");
      };
    } catch (error) {
      this.beginShutdown("terminated", "Worker startup failed");
      throw error;
    }

    logger.debug("Worker started");
  }

  /**
   * Execute a request in this worker. Returns a typed response.
   */
  execute(request: WorkerRequest): Promise<WorkerResponse> {
    let requestId: string;
    try {
      requestId = requireWorkerRequestId(request.id);
    } catch (error) {
      return Promise.reject(error);
    }
    return withSpan(
      "worker.execute",
      () => {
        if (!this.worker || this._status === "crashed" || this._status === "terminated") {
          return Promise.reject(
            UNKNOWN_ERROR.create({ detail: `Worker not available (status: ${this._status})` }),
          );
        }
        if (this.pending.has(requestId)) {
          return Promise.reject(UNKNOWN_ERROR.create({ detail: "Duplicate worker request id" }));
        }
        if (request.type === "render-ssr" && request.delivery !== "string") {
          return Promise.reject(
            INVALID_ARGUMENT.create({
              detail: "ProjectWorker.execute requires string SSR delivery",
            }),
          );
        }

        this._requestCount++;
        this._lastActivityAt = Date.now();
        this._status = "busy";

        return new Promise<WorkerResponse>((resolve, reject) => {
          const ssr = request.type === "render-ssr" ? this.createSSRWireState("string") : undefined;
          const timer = setTimeout(() => {
            this.pending.delete(requestId);
            const timeoutError = TIMEOUT_ERROR.create({
              detail: `Worker request timed out after ${this.requestTimeoutMs}ms`,
            });
            this.terminate();
            reject(timeoutError);
          }, this.requestTimeoutMs);

          this.pending.set(requestId, {
            resolve,
            reject,
            timer,
            expectedTypes: expectedResponseTypes(request),
            ssr,
          });
          try {
            if (ssr) this.postSSRExecutionOpen(requestId, ssr);
            this.postToWorker(request);
          } catch {
            clearTimeout(timer);
            this.pending.delete(requestId);
            const sendError = UNKNOWN_ERROR.create({
              detail: "Worker request could not be sent",
            });
            this.failWorker("crashed", "Worker control channel failed");
            reject(sendError);
          }
        });
      },
      {
        "worker.requestType": request.type,
      },
    );
  }

  /**
   * Execute a streaming request. Returns a ReadableStream that yields
   * chunks as they arrive from the Worker via postMessage.
   *
   * Each execution uses an authenticated, sequenced one-credit protocol. A
   * string result is never accepted after streaming delivery begins.
   */
  executeStream(request: WorkerRequest): ReadableStream<Uint8Array> {
    const requestId = requireWorkerRequestId(request.id);
    if (request.type !== "render-ssr" || request.delivery !== "stream") {
      throw INVALID_ARGUMENT.create({
        detail: "ProjectWorker.executeStream requires streaming SSR delivery",
      });
    }
    if (!this.worker || this._status === "crashed" || this._status === "terminated") {
      throw UNKNOWN_ERROR.create({ detail: `Worker not available (status: ${this._status})` });
    }

    if (this.pending.has(requestId) || this.streamHandlers.has(requestId)) {
      throw UNKNOWN_ERROR.create({ detail: "Duplicate worker request id" });
    }

    this._requestCount++;
    this._lastActivityAt = Date.now();
    this._status = "busy";

    const state = this.createSSRWireState("stream");
    let cancelRequest: (() => void) | undefined;
    let grantCreditForDemand: (() => void) | undefined;

    return new ReadableStream<Uint8Array>(
      {
        start: (controller) => {
          let settled = false;
          const clearRegistration = () => {
            clearTimeout(timer);
            this.streamHandlers.delete(requestId);
            this.pending.delete(requestId);
          };

          const settle = (
            outcome: "close" | "error" | "cancel",
            error?: Error,
            retireWorker = false,
          ) => {
            if (settled) return;
            settled = true;
            state.terminal = true;
            clearRegistration();
            if (outcome === "close") {
              controller.close();
            } else if (outcome === "error") {
              controller.error(
                error ??
                  UNKNOWN_ERROR.create({ detail: "Isolated SSR stream failed" }),
              );
            }
            if (retireWorker) {
              this.failWorker(
                "terminated",
                error?.message ?? "Isolated SSR stream was cancelled",
              );
            } else {
              this.updateIdleStatus();
            }
          };

          const timer = setTimeout(() => {
            const timeoutError = TIMEOUT_ERROR.create({
              detail: `Worker stream timed out after ${this.requestTimeoutMs}ms`,
            });
            settle("error", timeoutError, true);
          }, this.requestTimeoutMs);

          const grantCredit = () => {
            if (
              settled ||
              state.terminal ||
              !state.frameBuffered ||
              state.creditAvailable
            ) {
              return;
            }
            if ((controller.desiredSize ?? 0) <= 0) return;

            // State changes before posting so repeated pull() calls cannot
            // manufacture more than one credit for this sequence.
            state.frameBuffered = false;
            state.creditAvailable = true;
            try {
              this.postToWorker(
                {
                  type: "stream-credit",
                  id: requestId,
                  generation: state.generation,
                  token: state.token,
                  sequence: state.expectedSequence,
                } satisfies WorkerStreamCredit,
              );
            } catch {
              settle(
                "error",
                UNKNOWN_ERROR.create({
                  detail: "Worker stream credit could not be sent",
                }),
                true,
              );
            }
          };
          grantCreditForDemand = grantCredit;

          cancelRequest = () => {
            // No worker-side cancel RPC exists. Retiring the worker is the only
            // boundary that guarantees project rendering stops when the
            // downstream consumer disconnects.
            settle("cancel", undefined, true);
          };

          this.streamHandlers.set(requestId, {
            state,
            onFrame: (chunk) => {
              if (settled) return;

              const chunkBytes = chunk.byteLength;
              state.outputFrames += 1;
              if (state.outputFrames > MAX_WORKER_SSR_OUTPUT_CHUNKS) {
                settle("error", createSSROutputChunkLimitError(), true);
                return;
              }
              if (
                chunkBytes === 0 ||
                chunkBytes > MAX_WORKER_SSR_CHUNK_BYTES
              ) {
                settle(
                  "error",
                  UNKNOWN_ERROR.create({
                    detail: "Worker returned an invalid isolated SSR frame size",
                  }),
                  true,
                );
                return;
              }
              if (
                chunkBytes > MAX_WORKER_SSR_OUTPUT_BYTES - state.outputBytes
              ) {
                settle("error", createSSROutputByteLimitError(), true);
                return;
              }
              state.outputBytes += chunkBytes;

              // copyTightFixedWorkerFrame() guarantees this queue never retains
              // an offset, oversized, shared, or resizable backing allocation.
              controller.enqueue(chunk);
              state.frameBuffered = true;
              grantCredit();
            },
            onEnd: () => {
              settle("close");
            },
            onError: (error: Error) => {
              settle("error", error);
            },
          });

          this.pending.set(requestId, {
            resolve: () => {
              settle(
                "error",
                UNKNOWN_ERROR.create({
                  detail: "Worker returned a non-stream response for streaming SSR",
                }),
                true,
              );
            },
            reject: (error) => {
              settle("error", error);
            },
            timer,
            expectedTypes: expectedResponseTypes(request),
            ssr: state,
          });

          try {
            this.postSSRExecutionOpen(requestId, state);
            this.postToWorker(request);
          } catch {
            const sendError = UNKNOWN_ERROR.create({
              detail: "Worker stream request could not be sent",
            });
            settle("error", sendError, true);
          }
        },
        pull: () => {
          grantCreditForDemand?.();
        },
        cancel: () => {
          cancelRequest?.();
        },
      },
      {
        highWaterMark: 1,
        size: () => 1,
      },
    );
  }

  /**
   * Health check — send a ping and wait for pong.
   */
  async isHealthy(timeoutMs = 5_000): Promise<boolean> {
    if (!this.worker || this._status === "crashed" || this._status === "terminated") {
      return false;
    }

    const id = crypto.randomUUID();

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(false);
      }, timeoutMs);

      this.pending.set(id, {
        resolve: () => {
          clearTimeout(timer);
          this.pending.delete(id);
          resolve(true);
        },
        reject: () => {
          clearTimeout(timer);
          this.pending.delete(id);
          resolve(false);
        },
        timer,
        expectedTypes: ["pong"],
      });

      try {
        this.postToWorker({ type: "ping", id });
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        this.failWorker("crashed", "Worker health message could not be sent");
        resolve(false);
      }
    });
  }

  /**
   * Clear the worker's module cache. Used for dev mode hot reload.
   */
  clearModuleCache(): void {
    if (!this.worker || this._status === "crashed" || this._status === "terminated") return;
    // ESM imports cannot be evicted from an existing worker isolate. Retiring
    // the worker is the only honest invalidation boundary for file-based data
    // and SSR modules.
    this.terminate();
  }

  /**
   * Terminate the worker. Rejects all pending requests.
   */
  terminate(): void {
    void this.shutdown();
    logger.debug("Worker terminated");
  }

  /**
   * Terminate the worker and wait until all worker-owned resources are closed.
   *
   * The returned promise is single-flight and never rejects: teardown failures
   * are logged after every close attempt, while callers still receive a
   * deterministic quiescence boundary.
   */
  shutdown(): Promise<void> {
    return this.beginShutdown("terminated", "Worker terminated");
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private createSSRWireState(delivery: "string" | "stream"): SSRWireState {
    if (!this.workerGeneration) {
      throw UNKNOWN_ERROR.create({ detail: "Worker generation is not available" });
    }
    return {
      generation: this.workerGeneration,
      token: crypto.randomUUID(),
      delivery,
      expectedSequence: 0,
      creditAvailable: true,
      frameBuffered: false,
      terminal: false,
      outputBytes: 0,
      outputFrames: 0,
    };
  }

  private postSSRExecutionOpen(id: string, state: SSRWireState): void {
    this.postToWorker(
      {
        type: "ssr-execution-open",
        id,
        generation: state.generation,
        token: state.token,
        delivery: state.delivery,
      } satisfies WorkerSSRExecutionOpen,
    );
  }

  private postToWorker(message: unknown): void {
    if (this.controlPort) {
      apply(messagePortPostMessage, this.controlPort, [message]);
      return;
    }
    if (!this.worker) {
      throw UNKNOWN_ERROR.create({ detail: "Worker not available" });
    }
    postWorkerMessage(this.worker, message);
  }

  private failWorker(status: "crashed" | "terminated", reason: string): void {
    void this.beginShutdown(status, reason);
  }

  private beginShutdown(
    status: "crashed" | "terminated",
    reason: string,
  ): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;

    const completion = Promise.withResolvers<void>();
    this.shutdownPromise = completion.promise;

    const worker = this.worker;
    const egressBroker = this.egressBroker;
    const hadActiveWork = this._status === "busy" ||
      this.pending.size !== 0 ||
      this.streamHandlers.size !== 0;
    this.worker = null;
    this.workerGeneration = null;
    this.egressBroker = null;
    this._status = status;

    this.suppressIdleNotifications = true;
    try {
      this.rejectAllPending(reason);
    } finally {
      this.suppressIdleNotifications = false;
    }

    if (worker) {
      try {
        worker.terminate();
      } catch (error) {
        logger.debug("Worker terminate failed", { error });
      }
    }

    this.closeControlPort();
    if (egressBroker) {
      try {
        egressBroker.close();
      } catch (error) {
        logger.debug("Worker egress broker close failed", { error });
      }
    }
    if (hadActiveWork) this.notifyIdleListeners();

    if (!egressBroker) {
      completion.resolve();
      return completion.promise;
    }

    void egressBroker.closed.then(
      () => completion.resolve(),
      (error) => {
        logger.debug("Worker egress broker shutdown failed", { error });
        completion.resolve();
      },
    );
    return completion.promise;
  }

  private closeControlPort(): void {
    if (!this.controlPort) return;
    try {
      apply(messagePortClose, this.controlPort, []);
    } catch {
      // Worker termination still closes the underlying transport.
    }
    this.controlPort = null;
  }

  private getWorkerScriptUrl(): string {
    if (this.workerScriptUrl) return this.workerScriptUrl;
    // The binary build explicitly includes this module in its VFS.
    return import.meta.resolve("./worker-script.ts");
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "object" || data === null) {
      this.failWorker("crashed", "Worker returned an invalid control message");
      return;
    }
    const type = readOwnDataProperty(data, "type");
    if (typeof type !== "string") {
      this.failWorker("crashed", "Worker returned an invalid control message");
      return;
    }

    if (type === "worker-exit") {
      this.terminate();
      return;
    }

    if (type === "pong") {
      const id = readOwnDataProperty(data, "id");
      if (typeof id !== "string") {
        this.failWorker("crashed", "Worker returned an invalid health response");
        return;
      }
      const pending = this.pending.get(id);
      if (pending) {
        if (!apply(arrayIncludes, pending.expectedTypes, ["pong"])) {
          this.failWorker("crashed", "Worker returned a response for the wrong request type");
          return;
        }
        clearTimeout(pending.timer);
        pending.resolve(data as WorkerResponse);
        this.pending.delete(id);
      }
      return;
    }

    if (isSSRWireMessage(data)) {
      this.handleSSRWireMessage(data);
      return;
    }

    const id = readOwnDataProperty(data, "id");
    if (typeof id !== "string") {
      this.failWorker("crashed", "Worker returned an invalid control response");
      return;
    }
    const pending = this.pending.get(id);
    if (!pending) {
      logger.warn("Received response for unknown request", {
        responseType: type,
      });
      return;
    }
    if (pending.ssr) {
      this.failWorker("crashed", "Worker mixed the generic and isolated SSR protocols");
      return;
    }
    if (!apply(arrayIncludes, pending.expectedTypes, [type])) {
      this.failWorker("crashed", "Worker returned a response for the wrong request type");
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(id);
    this.updateIdleStatus();

    pending.resolve(data as WorkerResponse);
  }

  private handleSSRWireMessage(message: SSRWireMessage): void {
    const id = readOwnDataProperty(message, "id");
    if (typeof id !== "string") {
      this.failWorker("crashed", "Worker returned an invalid isolated SSR envelope");
      return;
    }
    const pending = this.pending.get(id);
    const state = pending?.ssr;
    if (!pending || !state || state.terminal) {
      this.failWorker("crashed", "Worker returned a stale isolated SSR message");
      return;
    }
    if (!hasValidSSRWireEnvelope(message, id, state)) {
      this.failWorker("crashed", "Worker returned a mismatched isolated SSR message");
      return;
    }

    if (message.type === "stream-frame") {
      const handler = this.streamHandlers.get(id);
      if (
        state.delivery !== "stream" ||
        !handler ||
        handler.state !== state ||
        !state.creditAvailable ||
        state.frameBuffered
      ) {
        this.failWorker("crashed", "Worker emitted an uncredited isolated SSR frame");
        return;
      }

      let chunk: Uint8Array;
      try {
        chunk = copyTightFixedWorkerFrame(
          readOwnDataProperty(message, "chunk"),
        );
      } catch {
        this.failWorker("crashed", "Worker returned an unsafe isolated SSR frame");
        return;
      }
      state.creditAvailable = false;
      state.expectedSequence += 1;
      handler.onFrame(chunk);
      return;
    }

    if (!state.creditAvailable || state.frameBuffered) {
      this.failWorker("crashed", "Worker emitted an uncredited isolated SSR terminal");
      return;
    }

    if (message.type === "stream-end") {
      const handler = this.streamHandlers.get(id);
      if (
        state.delivery !== "stream" ||
        !handler ||
        handler.state !== state
      ) {
        this.failWorker("crashed", "Worker returned an invalid isolated SSR stream terminal");
        return;
      }
      state.terminal = true;
      handler.onEnd();
      return;
    }

    if (message.type === "ssr-wire-result") {
      if (
        state.delivery !== "string" ||
        state.expectedSequence !== 0 ||
        typeof readOwnDataProperty(message, "html") !== "string"
      ) {
        this.failWorker("crashed", "Worker returned an invalid isolated SSR string terminal");
        return;
      }
      const html = readOwnDataProperty(message, "html") as string;
      state.terminal = true;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      if (isOversizedSSRHtml(html)) {
        pending.reject(createSSROutputByteLimitError());
        this.failWorker("terminated", "Worker exceeded the isolated SSR output boundary");
        return;
      }
      this.updateIdleStatus();
      pending.resolve({ type: "ssr-result", id, html });
      return;
    }

    if (message.type === "ssr-output-limit") {
      const limit = readOwnDataProperty(message, "limit");
      if (limit !== "bytes" && limit !== "chunks") {
        this.failWorker("crashed", "Worker returned an invalid isolated SSR output limit");
        return;
      }
      state.terminal = true;
      const error = limit === "bytes"
        ? createSSROutputByteLimitError()
        : createSSROutputChunkLimitError();
      if (state.delivery === "stream") {
        const handler = this.streamHandlers.get(id);
        if (!handler || handler.state !== state) {
          this.failWorker("crashed", "Worker returned an unexpected isolated SSR output limit");
          return;
        }
        handler.onError(error);
      } else {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(error);
        this.updateIdleStatus();
      }
      return;
    }

    if (message.type === "ssr-wire-error") {
      const serialized = readOwnDataProperty(message, "error");
      if (!isSerializedWorkerError(serialized)) {
        this.failWorker("crashed", "Worker returned an invalid isolated SSR error");
        return;
      }
      const error = deserializeWorkerError(serialized);
      state.terminal = true;
      if (state.delivery === "stream") {
        const handler = this.streamHandlers.get(id);
        if (!handler || handler.state !== state) {
          this.failWorker("crashed", "Worker returned an unexpected isolated SSR error");
          return;
        }
        handler.onError(error);
      } else {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        this.updateIdleStatus();
        pending.resolve({
          type: "error",
          id,
          error: serialized,
        });
      }
    }
  }

  private updateIdleStatus(): void {
    if (this.pending.size !== 0 || this.streamHandlers.size !== 0) return;
    if (this._status !== "busy") return;
    this._status = "idle";
    this.notifyIdleListeners();
  }

  private notifyIdleListeners(): void {
    if (
      this.suppressIdleNotifications ||
      this.pending.size !== 0 ||
      this.streamHandlers.size !== 0
    ) {
      return;
    }
    for (const listener of [...this.idleListeners]) {
      try {
        listener();
      } catch {
        // Lifecycle observers cannot interfere with worker cleanup.
      }
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(UNKNOWN_ERROR.create({ detail: reason }));
      this.pending.delete(id);
    }

    // Clean up stream handlers
    for (const [id, handler] of this.streamHandlers) {
      handler.onError(UNKNOWN_ERROR.create({ detail: reason }));
      this.streamHandlers.delete(id);
    }
  }
}
