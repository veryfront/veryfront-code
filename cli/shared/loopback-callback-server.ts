/**
 * Shared loopback callback transport. Callers own protocol correlation and result meaning.
 * @module cli/shared/loopback-callback-server
 */
import { isDeno } from "veryfront/platform";
import { defineError } from "veryfront/errors";
import { DEFAULT_CALLBACK_PORT, DEFAULT_LOGIN_TIMEOUT_MS, MAX_PORT_ATTEMPTS } from "./constants.ts";

const CALLBACK_TIMEOUT = defineError({
  slug: "loopback-callback-timeout",
  category: "RUNTIME",
  status: 408,
  title: "Callback wait timed out",
});
const CALLBACK_STOPPED = defineError({
  slug: "loopback-callback-stopped",
  category: "RUNTIME",
  status: 499,
  title: "Callback receiver stopped",
});
export interface LoopbackCallbackResponse<T> {
  response: Response;
  result?: T;
}
export interface LoopbackCallbackServer<T> {
  port: number;
  waitForCallback(timeoutMs?: number, signal?: AbortSignal): Promise<T>;
  stop(): Promise<void>;
}
export interface LoopbackCallbackOptions<T> {
  handle: (url: URL, headers: Headers) => LoopbackCallbackResponse<T>;
  timeoutMessage?: string;
}

function createReceiver<T>(options: LoopbackCallbackOptions<T>) {
  let finish: (value: { result: T } | { stopped: true }) => void = () => {};
  let completed = false;
  let settled = false;
  const settle = (value: { result: T } | { stopped: true }) => {
    if (settled) return;
    settled = true;
    finish(value);
  };
  const completion = new Promise<{ result: T } | { stopped: true }>((resolve) => {
    finish = resolve;
  });
  return {
    respond(
      url: URL,
      headers: Headers,
      method: string,
      afterResponse?: (complete: () => void) => void,
    ): Response {
      if (url.pathname !== "/callback") return new Response("Not Found", { status: 404 });
      if (method !== "GET") return new Response("Method Not Allowed", { status: 405 });
      if (completed) return new Response("Callback already received", { status: 410 });
      const outcome = options.handle(url, headers);
      if (Object.hasOwn(outcome, "result")) {
        completed = true;
        const complete = () => settle({ result: outcome.result as T });
        if (afterResponse) afterResponse(complete);
        else complete();
      }
      return outcome.response;
    },
    stop() {
      completed = true;
      settle({ stopped: true });
    },
    waitForCallback(timeoutMs = DEFAULT_LOGIN_TIMEOUT_MS, signal?: AbortSignal): Promise<T> {
      signal?.throwIfAborted();
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return Promise.reject(CALLBACK_TIMEOUT.create({ message: options.timeoutMessage }));
      }
      return new Promise<T>((resolve, reject) => {
        let settled = false;
        const settle = (value?: T, error?: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          if (error !== undefined) reject(error);
          else resolve(value as T);
        };
        const abort = () => settle(undefined, signal?.reason ?? CALLBACK_STOPPED.create());
        const timer = setTimeout(
          () => settle(undefined, CALLBACK_TIMEOUT.create({ message: options.timeoutMessage })),
          timeoutMs,
        );
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        void completion.then((value) =>
          "result" in value ? settle(value.result) : settle(undefined, CALLBACK_STOPPED.create())
        );
      });
    },
  };
}
function addressInUse(error: unknown): boolean {
  return error instanceof Error &&
    (error.name === "AddrInUse" || ("code" in error && error.code === "EADDRINUSE"));
}
function nodeHeaders(headers: Record<string, string | string[] | undefined>): Headers {
  const result = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) { for (const item of value) result.append(key, item); }
    else if (value !== undefined) result.set(key, value);
  }
  return result;
}
async function startAtPort<T>(
  port: number,
  options: LoopbackCallbackOptions<T>,
): Promise<LoopbackCallbackServer<T>> {
  const receiver = createReceiver(options);
  let stopped = false;
  if (isDeno) {
    const nativeDeno = (self as typeof self & { Deno?: typeof Deno })["Deno"]!;
    const server = nativeDeno.serve(
      { port, hostname: "127.0.0.1", onListen: () => {} },
      (request) => {
        const response = receiver.respond(new URL(request.url), request.headers, request.method);
        response.headers.set("Connection", "close");
        return response;
      },
    );
    return {
      port: server.addr.port,
      waitForCallback: receiver.waitForCallback,
      async stop() {
        if (stopped) return;
        stopped = true;
        receiver.stop();
        await server.shutdown();
      },
    };
  }
  const http = await import("node:http");
  const server = http.createServer(async (request, response) => {
    try {
      const result = receiver.respond(
        new URL(
          request.url ?? "/",
          `http://127.0.0.1:${
            typeof server.address() === "object"
              ? (server.address() as { port: number }).port
              : port
          }`,
        ),
        nodeHeaders(request.headers),
        request.method ?? "GET",
        (complete) => {
          response.once("finish", complete);
          response.once("close", () => receiver.stop());
        },
      );
      response.statusCode = result.status;
      result.headers.forEach((value, key) => response.setHeader(key, value));
      response.setHeader("Connection", "close");
      response.end(await result.text());
    } catch {
      receiver.stop();
      response.destroy();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw CALLBACK_STOPPED.create();
  return {
    port: address.port,
    waitForCallback: receiver.waitForCallback,
    stop() {
      if (stopped) return Promise.resolve();
      stopped = true;
      receiver.stop();
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

export async function startLoopbackCallbackServer<T>(
  options: LoopbackCallbackOptions<T>,
  preferredPort = DEFAULT_CALLBACK_PORT,
): Promise<LoopbackCallbackServer<T>> {
  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    try {
      return await startAtPort(preferredPort === 0 ? 0 : preferredPort + attempt, options);
    } catch (error) {
      if (!addressInUse(error) || attempt === MAX_PORT_ATTEMPTS - 1) throw error;
    }
  }
  throw CALLBACK_STOPPED.create();
}
