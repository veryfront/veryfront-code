import type { Server } from "../../adapters/base.ts";
import { createNodeServer } from "../../adapters/runtime/node/http-server.ts";
import type { Handler, HttpServer, ServeOptions } from "./types.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry/general.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";

interface PendingNodeServer {
  readonly controller: AbortController;
  readonly closeReason: DOMException;
  readonly startPromise: Promise<Server>;
  readonly externalSignal?: AbortSignal;
  readonly externalAbortListener?: () => void;
  closeRequested: boolean;
  closePromise?: Promise<void>;
}

interface ActiveNodeServer {
  readonly controller: AbortController;
  readonly server: Server;
  readonly externalSignal?: AbortSignal;
  readonly externalAbortListener?: () => void;
  stopPromise?: Promise<void>;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Node HTTP server startup was aborted", "AbortError");
}

function detachExternalSignal(
  state: Pick<
    PendingNodeServer,
    "externalSignal" | "externalAbortListener"
  >,
): void {
  if (!state.externalSignal || !state.externalAbortListener) return;
  state.externalSignal.removeEventListener(
    "abort",
    state.externalAbortListener,
  );
}

/**
 * Public compatibility facade over the canonical Node runtime server.
 *
 * The runtime transport owns request/response streaming, connection abort,
 * native address reporting, and retryable shutdown. This facade adds the
 * legacy `HttpServer` single-listener lifecycle without duplicating that
 * transport implementation.
 */
export class NodeHttpServer implements HttpServer {
  private pending?: PendingNodeServer;
  private active?: ActiveNodeServer;

  async serve(handler: Handler, options: ServeOptions = {}): Promise<void> {
    if (this.pending || this.active) {
      throw INVALID_ARGUMENT.create({
        detail: "NodeHttpServer.serve() cannot run more than once concurrently",
        context: { platform: "node", operation: "serve" },
      });
    }
    if (options.signal?.aborted) throw abortError(options.signal);

    const controller = new AbortController();
    const externalAbortListener = options.signal
      ? () => controller.abort(options.signal?.reason)
      : undefined;
    options.signal?.addEventListener("abort", externalAbortListener!, {
      once: true,
    });

    const pending: PendingNodeServer = {
      controller,
      closeReason: new DOMException(
        "Node HTTP server was closed during startup",
        "AbortError",
      ),
      startPromise: createNodeServer(handler, {
        ...options,
        signal: controller.signal,
      }),
      externalSignal: options.signal,
      externalAbortListener,
      closeRequested: false,
    };
    this.pending = pending;

    try {
      const server = await pending.startPromise;
      if (
        this.pending !== pending ||
        pending.closeRequested ||
        controller.signal.aborted
      ) {
        await server.stop();
        return;
      }

      this.pending = undefined;
      const active: ActiveNodeServer = {
        controller,
        server,
        externalSignal: options.signal,
        externalAbortListener,
      };
      this.active = active;
      controller.signal.addEventListener(
        "abort",
        () => {
          void this.stop(active).catch((error) => {
            serverLogger.error("Node HTTP server abort cleanup failed", {
              error,
            });
          });
        },
        { once: true },
      );
      if (controller.signal.aborted) {
        void this.stop(active).catch((error) => {
          serverLogger.error("Node HTTP server abort cleanup failed", {
            error,
          });
        });
      }
    } finally {
      if (this.pending === pending) {
        this.pending = undefined;
        detachExternalSignal(pending);
      }
    }
  }

  close(): Promise<void> {
    const active = this.active;
    if (active) return this.stop(active);

    const pending = this.pending;
    if (!pending) return Promise.resolve();
    if (pending.closePromise) return pending.closePromise;

    pending.closeRequested = true;
    pending.controller.abort(pending.closeReason);
    const attempt = pending.startPromise.then(
      (server) => server.stop(),
      (error) => {
        if (error !== pending.closeReason) throw error;
      },
    ).finally(() => {
      detachExternalSignal(pending);
      if (this.pending === pending) this.pending = undefined;
      if (pending.closePromise === attempt) {
        pending.closePromise = undefined;
      }
    });
    pending.closePromise = attempt;
    return attempt;
  }

  private stop(state: ActiveNodeServer): Promise<void> {
    if (state.stopPromise) return state.stopPromise;

    const attempt = Promise.resolve()
      .then(() => state.server.stop())
      .then(() => {
        detachExternalSignal(state);
        if (this.active === state) this.active = undefined;
      });
    state.stopPromise = attempt;
    if (!state.controller.signal.aborted) {
      state.controller.abort(
        new DOMException("Node HTTP server stopped", "AbortError"),
      );
    }
    void attempt.then(
      () => {
        if (state.stopPromise === attempt) state.stopPromise = undefined;
      },
      () => {
        if (state.stopPromise === attempt) state.stopPromise = undefined;
      },
    );
    return attempt;
  }
}
