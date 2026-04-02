import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
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

describe("react/compat/ssr-adapter/stream-renderer", () => {
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

  it("falls back to string rendering when readable stream setup fails", async () => {
    const errors: string[] = [];
    __injectReactDOMServerForTests(
      createMockServer({
        renderToReadableStream: async () => {
          throw new Error("readable failed");
        },
        renderToString: () => "<div>fallback</div>",
      }),
    );

    const result = await renderToStreamAdapter(React.createElement("div"), {
      onError: (error) => errors.push(error.message),
    });

    assertEquals(result.html, "<div>fallback</div>");
    assertEquals(errors, ["readable failed"]);
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

  it("falls back to string rendering when pipeable stream setup fails", async () => {
    const errors: string[] = [];
    __injectReactDOMServerForTests(
      createMockServer({
        renderToReadableStream: undefined,
        renderToPipeableStream: () => {
          throw new Error("pipe failed");
        },
        renderToString: () => "<div>pipe-fallback</div>",
      }),
    );

    const result = await renderToStreamAdapter(React.createElement("div"), {
      onError: (error) => errors.push(error.message),
    });

    assertEquals(result.html, "<div>pipe-fallback</div>");
    assertEquals(errors, ["pipe failed"]);
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
});
