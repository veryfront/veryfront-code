import type { ServeOptions, Server } from "../../base.ts";
import { DEFAULT_PORT } from "../../../compat/constants.ts";
import {
  getNativeDeno,
  getNativeResponse,
  toNativeResponse,
} from "../../../compat/http/native-response.ts";
import { getEnvOverlayStorage } from "../../../compat/process.ts";
import { isErrorAcrossRealms } from "../../../compat/error-introspection.ts";
import { INITIALIZATION_ERROR, NOT_SUPPORTED } from "#veryfront/errors/error-registry/general.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";
import { recordDenoServeRequestPeer } from "../shared/request-peer.ts";

type DenoRequestHandler = (
  request: Request,
) => Promise<Response> | Response;

/**
 * Whether `error` is a failure to bind the requested address.
 *
 * Matched on `name` and `code` rather than `instanceof Deno.errors.AddrInUse`.
 * The error is constructed in the host realm, so a cross-realm `instanceof`
 * is unreliable -- the same reason `isErrorAcrossRealms` exists in this file.
 * `AddrNotAvailable` is included because a stale bind address fails the same
 * way from the caller's point of view: the listener never came up at that
 * host and port.
 */
function isAddressBindFailure(error: unknown): boolean {
  if (!isErrorAcrossRealms(error)) return false;
  const { name } = error;
  if (name === "AddrInUse" || name === "AddrNotAvailable") return true;
  const code = (error as { code?: unknown }).code;
  return code === "EADDRINUSE" || code === "EADDRNOTAVAIL";
}

/**
 * The bind host rendered for an error message, or `undefined` to omit it.
 *
 * A deployment can bind through an internal DNS name, and AGENTS.md:124 lists
 * private hostnames among the values that must never reach an error message --
 * this one is logged and reaches Sentry. Only loopback and wildcard literals are
 * named; anything else could be infrastructure, so the caller reports the port
 * alone, which is the actionable half either way.
 *
 * An IPv6 literal is bracketed, because `::1` and `4321` joined by a colon reads
 * as another segment of the address rather than as a port.
 */
function describeBindHost(hostname: string): string | undefined {
  const host = hostname.toLowerCase();
  const isLoopbackOrWildcard = host === "localhost" || host === "::1" ||
    host === "::" || host === "0.0.0.0" || host.startsWith("127.");
  if (!isLoopbackOrWildcard) return undefined;
  return host.includes(":") ? `[${hostname}]` : hostname;
}

export interface DenoNativeHttpServer {
  readonly addr: unknown;
  readonly finished: Promise<void>;
  shutdown(): Promise<void>;
}

export interface DenoServeHandlerInfo {
  readonly remoteAddr?: {
    readonly transport?: unknown;
    readonly hostname?: unknown;
    readonly port?: unknown;
  };
}

export interface DenoServeRuntime {
  serve(options: {
    readonly port: number;
    readonly hostname: string;
    readonly signal: AbortSignal;
    readonly handler: (
      request: Request,
      info?: DenoServeHandlerInfo,
    ) => Promise<Response>;
    readonly onListen: (address: { hostname: string; port: number }) => void;
  }): DenoNativeHttpServer;
}

function abortError(signal: AbortSignal): Error {
  return isErrorAcrossRealms(signal.reason)
    ? signal.reason
    : new DOMException("Deno server startup was aborted", "AbortError");
}

function readBoundAddress(
  value: unknown,
): { hostname: string; port: number } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { hostname, port } = value as { hostname?: unknown; port?: unknown };
  if (
    typeof hostname !== "string" ||
    hostname.length === 0 ||
    !Number.isSafeInteger(port) ||
    (port as number) <= 0 ||
    (port as number) > 65_535
  ) {
    return undefined;
  }
  return { hostname, port: port as number };
}

async function rejectAbortedStartup(
  server: Server,
  signal: AbortSignal,
): Promise<never> {
  const error = abortError(signal);
  try {
    await server.stop();
  } catch (cleanupError) {
    throw new AggregateError(
      [error, cleanupError],
      "Deno server startup was aborted and cleanup failed",
    );
  }
  throw error;
}

export class DenoServer implements Server {
  private stopped = false;
  private stopPromise: Promise<void> | undefined;
  private abortListener: (() => void) | undefined;

  constructor(
    private readonly nativeServer: DenoNativeHttpServer,
    private readonly boundAddress: { hostname: string; port: number },
    private readonly controller: AbortController,
    private readonly servingSignal?: AbortSignal,
  ) {
    if (servingSignal) {
      this.abortListener = () => {
        void this.stop().catch((error) => {
          serverLogger.error("Deno server abort cleanup failed", { error });
        });
      };
      servingSignal.addEventListener("abort", this.abortListener, { once: true });
      if (servingSignal.aborted) this.abortListener();
    }
  }

  stop(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.stopPromise) return this.stopPromise;

    this.removeAbortListener();
    if (!this.controller.signal.aborted) {
      this.controller.abort(
        new DOMException("Deno server stopped", "AbortError"),
      );
    }

    const attempt = Promise.resolve()
      .then(() => this.nativeServer.shutdown())
      .then(() => this.nativeServer.finished)
      .then(() => {
        this.stopped = true;
      });
    this.stopPromise = attempt;
    void attempt.then(
      () => {
        if (this.stopPromise === attempt) this.stopPromise = undefined;
      },
      () => {
        if (this.stopPromise === attempt) this.stopPromise = undefined;
      },
    );
    return attempt;
  }

  get addr(): { hostname: string; port: number } {
    return { ...this.boundAddress };
  }

  private removeAbortListener(): void {
    if (!this.servingSignal || !this.abortListener) return;
    this.servingSignal.removeEventListener("abort", this.abortListener);
    this.abortListener = undefined;
  }
}

export async function createDenoServerWithRuntime(
  runtime: DenoServeRuntime,
  handler: DenoRequestHandler,
  options: ServeOptions = {},
): Promise<Server> {
  const {
    port = DEFAULT_PORT,
    hostname = "localhost",
    onListen,
    signal,
  } = options;
  if (signal?.aborted) throw abortError(signal);
  if (typeof runtime.serve !== "function") {
    throw NOT_SUPPORTED.create({
      detail: "The detected Deno runtime does not expose Deno.serve()",
      context: { platform: "deno", operation: "serve" },
    });
  }

  const controller = new AbortController();
  const envOverlay = getEnvOverlayStorage();
  const envStore = envOverlay?.getStore();
  const wrappedHandler = envOverlay && envStore
    ? (request: Request) => {
      if (envOverlay.run) return envOverlay.run(envStore, () => handler(request));
      envOverlay.enterWith?.(envStore);
      return handler(request);
    }
    : handler;
  const NativeResponse = getNativeResponse();

  let nativeServer: DenoNativeHttpServer;
  try {
    nativeServer = runtime.serve({
      port,
      hostname,
      signal: controller.signal,
      handler: async (request, info) => {
        try {
          recordDenoServeRequestPeer(request, info);
          const response = await wrappedHandler(request);
          return toNativeResponse(response, NativeResponse);
        } catch (error) {
          serverLogger.error("Deno request handler failed", { error });
          return new NativeResponse("Internal Server Error", { status: 500 });
        }
      },
      // Suppress Deno's default console output. The portable callback runs only
      // after the bound address has been validated and ownership is established.
      onListen: () => {},
    });
  } catch (error) {
    // `Deno.serve()` throws synchronously when the address cannot be bound, and
    // the raw `AddrInUse: Address already in use (os error 98)` carried no
    // hostname or port -- so an operator saw which process died but not which
    // address collided (veryfront-issue-inbox#806).
    //
    // Only a bind failure is relabelled. Catching everything here would report
    // an unrelated startup fault as an address collision, which is worse than
    // the raw error it replaces, so anything else is rethrown untouched.
    if (!isAddressBindFailure(error)) throw error;
    // The canonical phrase is kept at the front of the message on purpose. The
    // CLI classifies a taken port by matching it (`isPortInUseError`,
    // cli/commands/dev/port-fallback.ts), and dropping it silently disabled the
    // dev server's port fallback and broke
    // server-start-failure.integration.test.ts, which asserts the surfaced
    // message still says the port is in use. Naming the port is the point of
    // this change; keeping the phrase is what lets it be added without
    // rewriting a contract other code already depends on.
    const safeHost = describeBindHost(hostname);
    throw INITIALIZATION_ERROR.create({
      detail: safeHost === undefined
        ? `Address already in use: port ${port}`
        : `Address already in use: ${safeHost}:${port}`,
      context: {
        platform: "deno",
        operation: "serve",
        port,
        ...(safeHost === undefined ? {} : { hostname: safeHost }),
      },
      cause: error,
    });
  }

  // Nothing is leaked when the bind fails: the AbortController above is never
  // armed, no DenoServer exists yet, and ManagedServerRegistry.start awaits
  // createServer before track(), so a throwing start never enters its map.

  const address = readBoundAddress(nativeServer.addr);
  const server = new DenoServer(
    nativeServer,
    address ?? { hostname, port },
    controller,
    signal,
  );
  if (!address) {
    const error = INITIALIZATION_ERROR.create({
      detail: "Deno.serve() did not return a valid bound TCP address",
      context: {
        platform: "deno",
        operation: "serve",
        address: nativeServer.addr,
      },
    });
    try {
      await server.stop();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Deno server returned an invalid address and cleanup failed",
      );
    }
    throw error;
  }

  if (signal?.aborted) {
    return await rejectAbortedStartup(server, signal);
  }
  try {
    onListen?.(server.addr);
  } catch (error) {
    try {
      await server.stop();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Deno onListen callback and server cleanup both failed",
      );
    }
    throw error;
  }
  if (signal?.aborted) {
    return await rejectAbortedStartup(server, signal);
  }
  return server;
}

export function createDenoServer(
  handler: DenoRequestHandler,
  options: ServeOptions = {},
): Promise<Server> {
  const runtime = getNativeDeno();
  if (!runtime) {
    throw NOT_SUPPORTED.create({
      detail: "createDenoServer() can only be used in the Deno runtime",
      context: { platform: "deno", operation: "serve" },
    });
  }
  return createDenoServerWithRuntime(
    runtime as DenoServeRuntime,
    handler,
    options,
  );
}
