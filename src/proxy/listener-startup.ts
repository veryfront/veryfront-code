import type { Handler, HttpServer } from "#veryfront/platform/compat/http/index.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors";

export interface ProxyListenerStartupOptions {
  readonly server: HttpServer;
  readonly handler: Handler;
  readonly hostname: string;
  readonly port: number;
  /** One-shot transaction commit. Must return true for this listener. */
  readonly commitStartup: () => boolean;
  /** Route the first failure after readiness through the shutdown coordinator. */
  readonly onRuntimeFailure: (error: unknown) => void | Promise<void>;
}

export interface ProxyListenerStartup {
  /** Resolves only from the portable `onListen` readiness boundary. */
  readonly ready: Promise<Readonly<{ hostname: string; port: number }>>;
  /** Observes the runtime-specific `serve()` settlement without starting again. */
  readonly finished: Promise<void>;
}

function snapshotAddress(
  address: { hostname: string; port: number },
): Readonly<{ hostname: string; port: number }> {
  if (
    !address ||
    typeof address !== "object" ||
    typeof address.hostname !== "string" ||
    address.hostname.length === 0 ||
    !Number.isSafeInteger(address.port) ||
    address.port <= 0 ||
    address.port > 65_535
  ) {
    throw INITIALIZATION_ERROR.create({
      detail: "Proxy HTTP listener reported an invalid bound address",
    });
  }
  return Object.freeze({
    hostname: address.hostname,
    port: address.port,
  });
}

/**
 * Start the proxy listener exactly once while separating portable readiness
 * (`onListen`) from runtime-specific `serve()` settlement.
 */
export function startProxyListener(
  options: ProxyListenerStartupOptions,
): ProxyListenerStartup {
  if (
    !options ||
    typeof options !== "object" ||
    typeof options.server?.serve !== "function" ||
    typeof options.handler !== "function" ||
    typeof options.hostname !== "string" ||
    options.hostname.length === 0 ||
    !Number.isSafeInteger(options.port) ||
    options.port < 0 ||
    options.port > 65_535 ||
    typeof options.commitStartup !== "function" ||
    typeof options.onRuntimeFailure !== "function"
  ) {
    throw new TypeError("Proxy listener startup options are invalid");
  }

  let resolveReady!: (
    address: Readonly<{ hostname: string; port: number }>,
  ) => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<Readonly<{ hostname: string; port: number }>>(
    (resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    },
  );
  let state: "starting" | "ready" | "failed" = "starting";
  const reportRuntimeFailure = (error: unknown): void | Promise<void> => {
    if (state !== "ready") return;
    state = "failed";
    return options.onRuntimeFailure(error);
  };

  const serving = Promise.resolve().then(() =>
    options.server.serve(options.handler, {
      hostname: options.hostname,
      port: options.port,
      onListen: (address) => {
        if (state !== "starting") {
          throw INITIALIZATION_ERROR.create({
            detail: "Proxy HTTP listener reported readiness more than once",
          });
        }
        const snapshot = snapshotAddress(address);
        if (options.commitStartup() !== true) {
          throw INITIALIZATION_ERROR.create({
            detail: "Proxy startup transaction finalized before listener readiness",
          });
        }
        state = "ready";
        resolveReady(snapshot);
      },
      onRuntimeError: reportRuntimeFailure,
    })
  );

  const finished = serving.then(
    () => {
      if (state !== "starting") return;
      state = "failed";
      rejectReady(INITIALIZATION_ERROR.create({
        detail: "Proxy HTTP server settled before reporting listener readiness",
      }));
    },
    async (error) => {
      if (state === "starting") {
        state = "failed";
        rejectReady(error);
        return;
      }
      if (state === "ready") {
        await reportRuntimeFailure(error);
      }
    },
  );

  return Object.freeze({ ready, finished });
}
