/**
 * Dependency-free contract for Node.js WebSocket server implementations.
 *
 * Core owns HTTP upgrade authorization and lifecycle. An extension owns the
 * protocol implementation used to complete an authorized upgrade on an
 * existing Node socket.
 */

import { types as nodeUtilTypes } from "node:util";

export const NodeWebSocketServerProviderName = "NodeWebSocketServerProvider";
export const NODE_WEBSOCKET_SERVER_PROVIDER_PACKAGE = "@veryfront/ext-node-websocket-ws";
export const NODE_WEBSOCKET_SERVER_PROVIDER_MISSING_MESSAGE =
  `Node.js WebSocket upgrades require ${NODE_WEBSOCKET_SERVER_PROVIDER_PACKAGE}; install it or remove the extension disable directive.`;

const isProxy = nodeUtilTypes.isProxy;

export type NodeWebSocketMessageData =
  | ArrayBuffer
  | ArrayBufferView
  | readonly ArrayBufferView[];

/** Minimal connection surface consumed by core's runtime-neutral adapter. */
export interface NodeWebSocketConnection extends EventTarget {
  on(event: "open", listener: () => void): this;
  on(
    event: "message",
    listener: (data: NodeWebSocketMessageData, isBinary: boolean) => void,
  ): this;
  on(
    event: "close",
    listener: (code?: number, reason?: ArrayBufferView | string) => void,
  ): this;
  on(event: "error", listener: (error: Error) => void): this;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  terminate?(): void;
  ping?(): void;
}

/** Exact no-server options supplied by core for an existing HTTP listener. */
export interface NodeWebSocketServerOptions {
  readonly noServer: true;
  readonly handleProtocols: (
    protocols: ReadonlySet<string>,
    request: object,
  ) => string | false;
}

/** Minimal server surface used by upgrade and shutdown ownership. */
export interface NodeWebSocketServer {
  readonly clients?: Iterable<NodeWebSocketConnection>;
  on(
    event: "headers",
    listener: (headers: string[], request: unknown) => void,
  ): this;
  close(callback?: (error?: Error) => void): void;
  handleUpgrade(
    request: unknown,
    socket: unknown,
    head: unknown,
    callback: (socket: NodeWebSocketConnection) => void,
  ): void;
  emit(event: string, socket: NodeWebSocketConnection, request: unknown): void;
}

export interface NodeWebSocketServerProvider {
  readonly supportsIdleTimeout?: true;
  /** Actual transport send-buffer size, required by the Deno DOM facade. */
  readonly getBufferedAmount?: (connection: NodeWebSocketConnection) => number;
  readonly createServer: (
    options: NodeWebSocketServerOptions,
  ) => NodeWebSocketServer;
}

function serverInspectionError(cause?: unknown): TypeError {
  return new TypeError(
    "Node WebSocket server must expose data-function on, close, handleUpgrade, and emit methods",
    cause === undefined ? undefined : { cause },
  );
}

function captureServerMethod(
  server: object,
  name: "on" | "close" | "handleUpgrade" | "emit",
): (...args: unknown[]) => unknown {
  try {
    let owner: object | null = server;
    while (owner !== null) {
      if (isProxy(owner)) throw serverInspectionError();
      const descriptor = Object.getOwnPropertyDescriptor(owner, name);
      if (descriptor !== undefined) {
        if (!("value" in descriptor) || typeof descriptor.value !== "function") {
          throw serverInspectionError();
        }
        return descriptor.value as (...args: unknown[]) => unknown;
      }
      owner = Object.getPrototypeOf(owner);
    }
  } catch (cause) {
    if (cause instanceof TypeError && cause.message.startsWith("Node WebSocket")) {
      throw cause;
    }
    throw serverInspectionError(cause);
  }
  throw serverInspectionError();
}

function captureServerClients(
  server: object,
): Iterable<NodeWebSocketConnection> | undefined {
  try {
    let owner: object | null = server;
    while (owner !== null) {
      if (isProxy(owner)) throw serverInspectionError();
      const descriptor = Object.getOwnPropertyDescriptor(owner, "clients");
      if (descriptor !== undefined) {
        if (!("value" in descriptor)) throw serverInspectionError();
        const clients = descriptor.value;
        if (clients === undefined) return undefined;
        if (
          (typeof clients !== "object" && typeof clients !== "function") ||
          clients === null || isProxy(clients) ||
          typeof (clients as Iterable<unknown>)[Symbol.iterator] !== "function"
        ) {
          throw serverInspectionError();
        }
        return clients as Iterable<NodeWebSocketConnection>;
      }
      owner = Object.getPrototypeOf(owner);
    }
    return undefined;
  } catch (cause) {
    if (cause instanceof TypeError && cause.message.startsWith("Node WebSocket")) {
      throw cause;
    }
    throw serverInspectionError(cause);
  }
}

/**
 * Capture one server instance without retaining mutable method lookups. The
 * underlying implementation remains the receiver because protocol engines
 * legitimately keep mutable transport state on their instance.
 */
export function captureNodeWebSocketServer(
  value: unknown,
): Readonly<NodeWebSocketServer> {
  if (typeof value !== "object" || value === null || isProxy(value)) {
    throw serverInspectionError();
  }

  const on = captureServerMethod(value, "on");
  const close = captureServerMethod(value, "close");
  const handleUpgrade = captureServerMethod(value, "handleUpgrade");
  const emit = captureServerMethod(value, "emit");
  const clients = captureServerClients(value);
  const captured: Readonly<NodeWebSocketServer> = Object.freeze({
    ...(clients === undefined ? {} : { clients }),
    on(event: "headers", listener: (headers: string[], request: unknown) => void) {
      Reflect.apply(on, value, [event, listener]);
      return captured;
    },
    close(callback?: (error?: Error) => void): void {
      Reflect.apply(close, value, callback === undefined ? [] : [callback]);
    },
    handleUpgrade(
      request: unknown,
      socket: unknown,
      head: unknown,
      callback: (socket: NodeWebSocketConnection) => void,
    ): void {
      Reflect.apply(handleUpgrade, value, [request, socket, head, callback]);
    },
    emit(event: string, socket: NodeWebSocketConnection, request: unknown): void {
      Reflect.apply(emit, value, [event, socket, request]);
    },
  });
  return captured;
}

function providerInspectionError(cause?: unknown): TypeError {
  return new TypeError(
    "Node WebSocket server provider must contain an enumerable createServer data function and optional supportsIdleTimeout: true",
    cause === undefined ? undefined : { cause },
  );
}

/**
 * Capture a provider generation without retaining its mutable registration
 * object or invoking extension-owned accessors.
 */
export function snapshotNodeWebSocketServerProvider(
  value: unknown,
): Readonly<NodeWebSocketServerProvider> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw providerInspectionError();
  }

  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  try {
    if (isProxy(value)) throw providerInspectionError();
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch (cause) {
    if (cause instanceof TypeError && cause.message.startsWith("Node WebSocket")) {
      throw cause;
    }
    throw providerInspectionError(cause);
  }

  const keys = Reflect.ownKeys(descriptors);
  const descriptor = descriptors.createServer;
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.some((key) =>
      key !== "createServer" && key !== "supportsIdleTimeout" && key !== "getBufferedAmount"
    ) ||
    (descriptors.supportsIdleTimeout !== undefined &&
      (!("value" in descriptors.supportsIdleTimeout) ||
        !descriptors.supportsIdleTimeout.enumerable ||
        descriptors.supportsIdleTimeout.value !== true)) ||
    (descriptors.getBufferedAmount !== undefined &&
      (!("value" in descriptors.getBufferedAmount) || !descriptors.getBufferedAmount.enumerable ||
        typeof descriptors.getBufferedAmount.value !== "function")) ||
    !descriptor?.enumerable || !("value" in descriptor) ||
    typeof descriptor.value !== "function"
  ) {
    throw providerInspectionError();
  }

  const createServer = descriptor.value as (
    options: NodeWebSocketServerOptions,
  ) => NodeWebSocketServer;
  const getBufferedAmount = descriptors.getBufferedAmount?.value;
  return Object.freeze({
    ...(descriptors.supportsIdleTimeout === undefined
      ? {}
      : { supportsIdleTimeout: true as const }),
    ...(getBufferedAmount === undefined ? {} : {
      getBufferedAmount(connection: NodeWebSocketConnection): number {
        const amount = Reflect.apply(getBufferedAmount, undefined, [connection]);
        if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
          throw new TypeError("WebSocket buffered amount must be a finite nonnegative number");
        }
        return amount;
      },
    }),
    createServer(options: NodeWebSocketServerOptions): NodeWebSocketServer {
      return Reflect.apply(createServer, undefined, [options]);
    },
  });
}

/** Create immutable registration metadata from a standalone factory. */
export function createNodeWebSocketServerProvider(
  createServer: (
    options: NodeWebSocketServerOptions,
  ) => NodeWebSocketServer,
  capabilities?: {
    readonly supportsIdleTimeout: true;
    readonly getBufferedAmount?: (connection: NodeWebSocketConnection) => number;
  },
): Readonly<NodeWebSocketServerProvider> {
  if (capabilities === undefined) return snapshotNodeWebSocketServerProvider({ createServer });
  if (typeof capabilities !== "object" || capabilities === null || isProxy(capabilities)) {
    throw providerInspectionError();
  }
  const descriptors = Object.getOwnPropertyDescriptors(capabilities);
  if (
    Reflect.ownKeys(descriptors).some((key) =>
      key !== "supportsIdleTimeout" && key !== "getBufferedAmount"
    )
  ) {
    throw providerInspectionError();
  }
  return snapshotNodeWebSocketServerProvider(
    Object.defineProperties({ createServer }, descriptors),
  );
}
