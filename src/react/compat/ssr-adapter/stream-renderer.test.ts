import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import * as React from "react";
import type { ReactDOMServer } from "./server-loader.ts";
import { __injectReactDOMServerForTests, resetReactCache } from "./server-loader.ts";
import {
  __resetSSRStreamRendererForTests,
  __setSSRStreamTimeoutForTests,
  renderToStreamAdapter,
} from "./stream-renderer.ts";

type ReadableSSRStream = Awaited<
  ReturnType<NonNullable<ReactDOMServer["renderToReadableStream"]>>
>;
type PipeableSSRStream = ReturnType<NonNullable<ReactDOMServer["renderToPipeableStream"]>>;

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }

  output += decoder.decode();
  return output;
}

async function readPipe(
  pipe: (writable: NodeJS.WritableStream) => void,
): Promise<string> {
  const { PassThrough } = await import("node:stream");
  const { Buffer } = await import("node:buffer");

  return await new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const passThrough = new PassThrough();

    passThrough.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    passThrough.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    passThrough.on("error", reject);

    pipe(passThrough);
  });
}

function createMockServer(overrides: Partial<ReactDOMServer> = {}): ReactDOMServer {
  return {
    renderToString: () => "<div>string</div>",
    renderToStaticMarkup: () => "<div>static</div>",
    ...overrides,
  };
}

function createReadableSSRStream(html: string): ReadableSSRStream {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(html));
      controller.close();
    },
  }) as ReadableStream<Uint8Array> & { allReady: Promise<void> };

  stream.allReady = Promise.resolve();
  return stream as ReadableSSRStream;
}

function createPipeableSSRStream(
  pipeImpl: (writable: NodeJS.WritableStream) => void,
  abortImpl: () => void = () => {},
): PipeableSSRStream {
  return {
    pipe<Writable extends NodeJS.WritableStream>(writable: Writable): Writable {
      pipeImpl(writable);
      return writable;
    },
    abort: abortImpl,
  };
}

function withDeadline<T>(promise: Promise<T>, timeoutMs = 100): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(
      () => reject(new Error(`test deadline exceeded after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function blockEventLoopFor(durationMs: number): void {
  const deadline = performance.now() + durationMs;
  while (performance.now() < deadline) {
    // Intentionally starve timers to prove setup deadlines are absolute rather
    // than dependent on the timeout callback winning the event-loop race.
  }
}

describe("react/compat/ssr-adapter/stream-renderer", () => {
  it("keeps the selected runtime when streaming falls back to string rendering", async () => {
    const options = {
      reactRuntime: { react: React, server: createMockServer({ renderToString: () => "first" }) },
    };
    const pending = renderToStreamAdapter(React.createElement("div"), options);
    options.reactRuntime = {
      react: React,
      server: createMockServer({ renderToString: () => "second" }),
    };
    assertEquals((await pending).html, "first", "one render must keep its selected runtime pair");
  });
  afterEach(() => {
    __injectReactDOMServerForTests(null);
    resetReactCache();
    __resetSSRStreamRendererForTests();
  });

  it("returns a readable stream when renderToReadableStream succeeds", async () => {
    __injectReactDOMServerForTests(
      createMockServer({
        renderToReadableStream: async () => createReadableSSRStream("<div>streamed</div>"),
      }),
    );

    const result = await renderToStreamAdapter(React.createElement("div"), {
      nonce: "nonce-1",
    });

    assertEquals(result.stream instanceof ReadableStream, true);
    assertEquals(await readStream(result.stream!), "<div>streamed</div>");
  });

  it("does not re-render when readable stream setup fails", async () => {
    const errors: string[] = [];
    let stringRenderCalls = 0;
    __injectReactDOMServerForTests(
      createMockServer({
        renderToReadableStream: async () => {
          throw new Error("readable failed");
        },
        renderToString: () => {
          stringRenderCalls += 1;
          return "<div>must not render</div>";
        },
      }),
    );

    await assertRejects(
      () =>
        renderToStreamAdapter(React.createElement("div"), {
          onError: (error) => errors.push(error.message),
        }),
      Error,
      "readable failed",
    );
    assertEquals(stringRenderCalls, 0);
    assertEquals(errors, ["readable failed"]);
  });

  it("reports one readable failure once when React also reports it", async () => {
    const failure = new Error("reported readable failure");
    const observed: Error[] = [];
    __injectReactDOMServerForTests(
      createMockServer({
        renderToReadableStream: async (_element, options) => {
          options?.onError?.(failure, { componentStack: "" });
          throw failure;
        },
      }),
    );

    await assertRejects(
      () =>
        renderToStreamAdapter(React.createElement("div"), {
          onError: (error) => observed.push(error),
        }),
      Error,
      failure.message,
    );
    assertEquals(observed, [failure]);
  });

  it("aborts readable stream setup when it exceeds the timeout", async () => {
    let aborted = false;
    __setSSRStreamTimeoutForTests(5);
    __injectReactDOMServerForTests(
      createMockServer({
        renderToReadableStream: (_element, options) =>
          new Promise((_resolve, reject) => {
            const signal = options?.signal;
            if (!signal) {
              reject(new Error("missing signal"));
              return;
            }

            signal.addEventListener("abort", () => {
              aborted = true;
              reject(signal.reason ?? new Error("aborted"));
            }, { once: true });
          }),
      }),
    );

    await assertRejects(
      () => renderToStreamAdapter(React.createElement("div")),
      Error,
      "SSR timeout",
    );
    assertEquals(aborted, true);
  });

  it("bounds setup and cancels a late stream when the renderer ignores abort", async () => {
    let resolveStream!: (stream: ReadableSSRStream) => void;
    let cancelled = false;
    __setSSRStreamTimeoutForTests(5);
    __injectReactDOMServerForTests(
      createMockServer({
        renderToReadableStream: () =>
          new Promise((resolve) => {
            resolveStream = resolve;
          }),
      }),
    );

    await assertRejects(
      () => withDeadline(renderToStreamAdapter(React.createElement("div"))),
      Error,
      "SSR timeout",
    );

    const lateStream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    }) as ReadableStream<Uint8Array> & { allReady: Promise<void> };
    lateStream.allReady = Promise.resolve();
    resolveStream(lateStream as ReadableSSRStream);
    await Promise.resolve();
    await Promise.resolve();

    assertEquals(cancelled, true);
  });

  it("enforces the readable setup deadline after timer starvation", async () => {
    let signal: AbortSignal | undefined;
    let cancelCount = 0;
    let cancelReason: unknown;
    const observed: Error[] = [];
    __setSSRStreamTimeoutForTests(1);
    __injectReactDOMServerForTests(
      createMockServer({
        renderToReadableStream: async (_element, options) => {
          signal = options?.signal;
          blockEventLoopFor(5);
          const stream = new ReadableStream<Uint8Array>({
            cancel(reason) {
              cancelCount += 1;
              cancelReason = reason;
            },
          }) as ReadableStream<Uint8Array> & { allReady: Promise<void> };
          stream.allReady = Promise.resolve();
          return stream as ReadableSSRStream;
        },
      }),
    );

    let rejection: unknown;
    try {
      await renderToStreamAdapter(React.createElement("div"), {
        onError: (error) => observed.push(error),
      });
    } catch (error) {
      rejection = error;
    }

    assertEquals(rejection instanceof Error, true);
    assertStrictEquals(rejection, signal?.reason);
    assertStrictEquals(cancelReason, rejection);
    assertEquals(cancelCount, 1);
    assertEquals(observed, []);
  });

  it("returns a pipeable stream result when renderToPipeableStream is ready", async () => {
    __injectReactDOMServerForTests(
      createMockServer({
        renderToReadableStream: undefined,
        renderToPipeableStream: (_element, options) => {
          queueMicrotask(() => options?.onShellReady?.());
          return createPipeableSSRStream((writable) => {
            writable.write("<div>pipeable</div>");
            writable.end();
          });
        },
      }),
    );

    const result = await renderToStreamAdapter(React.createElement("div"));

    assertEquals(typeof result.pipe, "function");
    assertEquals(await readPipe(result.pipe!), "<div>pipeable</div>");
  });

  it("does not re-render when pipeable stream setup fails", async () => {
    const errors: string[] = [];
    let stringRenderCalls = 0;
    __injectReactDOMServerForTests(
      createMockServer({
        renderToReadableStream: undefined,
        renderToPipeableStream: () => {
          throw new Error("pipe failed");
        },
        renderToString: () => {
          stringRenderCalls += 1;
          return "<div>must not render</div>";
        },
      }),
    );

    await assertRejects(
      () =>
        renderToStreamAdapter(React.createElement("div"), {
          onError: (error) => errors.push(error.message),
        }),
      Error,
      "pipe failed",
    );
    assertEquals(stringRenderCalls, 0);
    assertEquals(errors, ["pipe failed"]);
  });

  it("reports one pipeable failure once across error and shell callbacks", async () => {
    const failure = new Error("reported pipeable failure");
    const observed: Error[] = [];
    __injectReactDOMServerForTests(
      createMockServer({
        renderToReadableStream: undefined,
        renderToPipeableStream: (_element, options) => {
          queueMicrotask(() => {
            options?.onError?.(failure, { componentStack: "" });
            options?.onShellError?.(failure);
          });
          return createPipeableSSRStream(() => {});
        },
      }),
    );

    await assertRejects(
      () =>
        renderToStreamAdapter(React.createElement("div"), {
          onError: (error) => observed.push(error),
        }),
      Error,
      failure.message,
    );
    assertEquals(observed, [failure]);
  });

  it("aborts pipeable stream rendering when shell readiness never arrives", async () => {
    let abortCalled = false;
    __setSSRStreamTimeoutForTests(5);
    __injectReactDOMServerForTests(
      createMockServer({
        renderToReadableStream: undefined,
        renderToPipeableStream: () =>
          createPipeableSSRStream(
            () => {},
            () => {
              abortCalled = true;
            },
          ),
      }),
    );

    await assertRejects(
      () => renderToStreamAdapter(React.createElement("div")),
      Error,
      "SSR timeout",
    );
    assertEquals(abortCalled, true);
  });

  it("enforces the pipeable setup deadline after timer starvation", async () => {
    let abortCount = 0;
    const observed: Error[] = [];
    __setSSRStreamTimeoutForTests(1);
    __injectReactDOMServerForTests(
      createMockServer({
        renderToReadableStream: undefined,
        renderToPipeableStream: (_element, options) => {
          blockEventLoopFor(5);
          options?.onShellReady?.();
          return createPipeableSSRStream(
            () => {},
            () => {
              abortCount += 1;
            },
          );
        },
      }),
    );

    let rejection: unknown;
    try {
      await renderToStreamAdapter(React.createElement("div"), {
        onError: (error) => observed.push(error),
      });
    } catch (error) {
      rejection = error;
    }

    assertEquals(rejection instanceof Error, true);
    assertEquals((rejection as Error).message.includes("SSR timeout"), true);
    assertEquals(abortCount, 1);
    assertEquals(observed.length, 1);
    assertStrictEquals(observed[0], rejection);
  });

  it("handles a synchronous pipeable shell-ready callback", async () => {
    __injectReactDOMServerForTests(
      createMockServer({
        renderToReadableStream: undefined,
        renderToPipeableStream: (_element, options) => {
          options?.onShellReady?.();
          return createPipeableSSRStream((writable) => {
            writable.end("<div>synchronous</div>");
          });
        },
      }),
    );

    const result = await withDeadline(
      renderToStreamAdapter(React.createElement("div")),
    );

    assertEquals(typeof result.pipe, "function");
    assertEquals(await readPipe(result.pipe!), "<div>synchronous</div>");
  });

  it("settles readiness before invoking throwing observers", async () => {
    __injectReactDOMServerForTests(
      createMockServer({
        renderToReadableStream: undefined,
        renderToPipeableStream: (_element, options) => {
          queueMicrotask(() => {
            options?.onShellReady?.();
            options?.onAllReady?.();
          });
          return createPipeableSSRStream((writable) => {
            writable.end("<div>ready</div>");
          });
        },
      }),
    );

    const result = await withDeadline(
      renderToStreamAdapter(React.createElement("div"), {
        onAllReady: () => {
          throw new Error("all-ready observer failed");
        },
        onShellReady: () => {
          throw new Error("shell-ready observer failed");
        },
      }),
    );

    await withDeadline(Promise.resolve(result.allReady));
    assertEquals(await readPipe(result.pipe!), "<div>ready</div>");
  });

  it("preserves a shell failure when its observer throws without re-rendering", async () => {
    let stringRenderCalls = 0;
    __injectReactDOMServerForTests(
      createMockServer({
        renderToReadableStream: undefined,
        renderToPipeableStream: (_element, options) => {
          queueMicrotask(() => options?.onShellError?.(new Error("shell failed")));
          return createPipeableSSRStream(() => {});
        },
        renderToString: () => {
          stringRenderCalls += 1;
          return "<div>must not render</div>";
        },
      }),
    );

    await assertRejects(
      () =>
        withDeadline(
          renderToStreamAdapter(React.createElement("div"), {
            onShellError: () => {
              throw new Error("shell-error observer failed");
            },
          }),
        ),
      Error,
      "shell failed",
    );
    assertEquals(stringRenderCalls, 0);
  });
});
