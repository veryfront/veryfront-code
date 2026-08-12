import type { Handler, HttpServer, ServeOptions } from "./types.ts";
import { LOCALHOST } from "../constants.ts";
import { getNativeDeno, getNativeResponse, toNativeResponse } from "./native-response.ts";
import { isErrorAcrossRealms } from "../error-introspection.ts";
import {
  INITIALIZATION_ERROR,
  INVALID_ARGUMENT,
  NOT_SUPPORTED,
} from "#veryfront/errors/error-registry/general.ts";

const DEFAULT_COMPAT_HTTP_PORT = 8000;

interface ActiveDenoServer {
  readonly controller: AbortController;
  readonly server: Deno.HttpServer<Deno.NetAddr>;
  readonly servingSignal?: AbortSignal;
  abortListener?: () => void;
  stopPromise?: Promise<void>;
  stopFailed: boolean;
  stopError?: unknown;
  stopped: boolean;
}

function abortError(signal: AbortSignal): Error {
  return isErrorAcrossRealms(signal.reason)
    ? signal.reason
    : new DOMException("Deno HTTP server startup was aborted", "AbortError");
}

function readBoundAddress(
  value: Deno.Addr,
): { hostname: string; port: number } | undefined {
  if (value.transport !== "tcp") return undefined;
  if (
    typeof value.hostname !== "string" ||
    value.hostname.length === 0 ||
    !Number.isSafeInteger(value.port) ||
    value.port <= 0 ||
    value.port > 65_535
  ) {
    return undefined;
  }
  return { hostname: value.hostname, port: value.port };
}

export class DenoHttpServer implements HttpServer {
  private active?: ActiveDenoServer;

  async serve(handler: Handler, options: ServeOptions = {}): Promise<void> {
    if (this.active) {
      throw INVALID_ARGUMENT.create({
        detail: "DenoHttpServer.serve() cannot run more than once concurrently",
        context: { platform: "deno", operation: "serve" },
      });
    }

    const {
      port = DEFAULT_COMPAT_HTTP_PORT,
      hostname = LOCALHOST.IPV4,
      signal,
      onListen,
    } = options;
    if (signal?.aborted) throw abortError(signal);

    const nativeDeno = getNativeDeno();
    if (!nativeDeno) {
      throw NOT_SUPPORTED.create({
        detail: "DenoHttpServer.serve() can only be used in the Deno runtime",
        context: { platform: "deno", operation: "serve" },
      });
    }
    const NativeResponse = getNativeResponse();
    const controller = new AbortController();
    const wrappedHandler: Handler = async (request) => {
      const response = await handler(request);
      return toNativeResponse(response, NativeResponse);
    };

    const nativeServer = nativeDeno.serve({
      port,
      hostname,
      signal: controller.signal,
      handler: wrappedHandler,
      onListen: () => {},
    });
    const state: ActiveDenoServer = {
      controller,
      server: nativeServer,
      servingSignal: signal,
      stopFailed: false,
      stopped: false,
    };
    this.active = state;

    if (signal) {
      state.abortListener = () => {
        void this.stop(state).catch(() => undefined);
      };
      signal.addEventListener("abort", state.abortListener, { once: true });
    }

    const address = readBoundAddress(nativeServer.addr);
    if (!address) {
      const error = INITIALIZATION_ERROR.create({
        detail: "Deno.serve() did not return a valid bound TCP address",
        context: {
          platform: "deno",
          operation: "serve",
          address: nativeServer.addr,
        },
      });
      return await this.rejectAfterCleanup(state, error);
    }

    try {
      onListen?.(address);
    } catch (error) {
      await this.rejectAfterCleanup(state, error);
    }
    if (signal?.aborted) {
      await this.rejectAfterCleanup(state, abortError(signal));
    }

    try {
      await nativeServer.finished;
      const stopPromise = state.stopPromise;
      if (stopPromise) await stopPromise;
      if (state.stopFailed) throw state.stopError;
    } finally {
      this.detachAbortListener(state);
      if (this.active === state && !state.stopFailed) this.active = undefined;
    }
  }

  close(): Promise<void> {
    const state = this.active;
    if (!state) return Promise.resolve();
    return this.stop(state).then(() => {
      if (this.active === state) this.active = undefined;
    });
  }

  private stop(state: ActiveDenoServer): Promise<void> {
    if (state.stopped) return Promise.resolve();
    if (state.stopPromise) return state.stopPromise;

    this.detachAbortListener(state);
    if (!state.controller.signal.aborted) {
      state.controller.abort(
        new DOMException("Deno HTTP server stopped", "AbortError"),
      );
    }
    const attempt = Promise.resolve()
      .then(() => state.server.shutdown())
      .then(() => state.server.finished)
      .then(() => {
        state.stopped = true;
        state.stopFailed = false;
        state.stopError = undefined;
      });
    state.stopPromise = attempt;
    void attempt.then(
      () => {
        if (state.stopPromise === attempt) state.stopPromise = undefined;
      },
      (error) => {
        state.stopFailed = true;
        state.stopError = error;
        if (state.stopPromise === attempt) state.stopPromise = undefined;
      },
    );
    return attempt;
  }

  private async rejectAfterCleanup(
    state: ActiveDenoServer,
    error: unknown,
  ): Promise<never> {
    try {
      await this.stop(state);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Deno HTTP server startup and cleanup both failed",
      );
    }
    if (this.active === state) this.active = undefined;
    throw error;
  }

  private detachAbortListener(state: ActiveDenoServer): void {
    if (!state.servingSignal || !state.abortListener) return;
    state.servingSignal.removeEventListener("abort", state.abortListener);
    state.abortListener = undefined;
  }
}
