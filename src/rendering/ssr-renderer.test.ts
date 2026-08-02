import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import * as React from "react";
import type { ReactDOMServer } from "../react/compat/ssr-adapter/server-loader.ts";
import {
  __injectReactDOMServerForTests,
  resetReactCache,
} from "../react/compat/ssr-adapter/server-loader.ts";
import { SSRRenderer } from "./ssr-renderer.ts";
import type { VeryfrontConfig } from "#veryfront/config";

type PipeableSSRStream = ReturnType<NonNullable<ReactDOMServer["renderToPipeableStream"]>>;

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

async function waitUntil(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() >= deadline) {
      throw new Error(`condition was not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("rendering/ssr-renderer", () => {
  afterEach(() => {
    __injectReactDOMServerForTests(null);
    resetReactCache();
  });

  it("propagates stream cancellation to the pipeable render abort function", async () => {
    let abortCount = 0;

    __injectReactDOMServerForTests({
      renderToString: () => "<div>unused</div>",
      renderToStaticMarkup: () => "<div>static</div>",
      renderToReadableStream: undefined,
      renderToPipeableStream: (_element, options) => {
        queueMicrotask(() => options?.onShellReady?.());
        return createPipeableSSRStream(
          () => {},
          () => {
            abortCount += 1;
          },
        );
      },
    });

    const renderer = new SSRRenderer("production");
    const result = await renderer.renderToHTML(
      React.createElement("div"),
      { mode: "production", wantsStream: true },
    );

    assertEquals(result.stream instanceof ReadableStream, true);
    await result.stream?.cancel(new Error("stop"));
    await result.stream?.cancel(new Error("stop again"));
    assertEquals(abortCount, 1);
  });

  it("forwards the response nonce to React-owned streaming scripts", async () => {
    let observedNonce: string | undefined;
    __injectReactDOMServerForTests({
      renderToString: () => "<div>unused</div>",
      renderToStaticMarkup: () => "<div>static</div>",
      renderToReadableStream: async (_element, options) => {
        observedNonce = options?.nonce;
        return new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("<div>streamed</div>"));
            controller.close();
          },
        }) as Awaited<
          ReturnType<NonNullable<ReactDOMServer["renderToReadableStream"]>>
        >;
      },
    });

    const renderer = new SSRRenderer("production");
    const result = await renderer.renderToHTML(
      React.createElement("div"),
      { mode: "production", wantsStream: true, nonce: "response-nonce" },
    );

    assertEquals(observedNonce, "response-nonce");
    await result.stream?.cancel();
  });

  it("applies Web Stream backpressure to a pipeable producer", async () => {
    const chunkSize = 4_096;
    const totalChunks = 256;
    let writes = 0;
    let completed = false;

    __injectReactDOMServerForTests({
      renderToString: () => "<div>unused</div>",
      renderToStaticMarkup: () => "<div>static</div>",
      renderToReadableStream: undefined,
      renderToPipeableStream: (_element, options) => {
        queueMicrotask(() => options?.onShellReady?.());
        return createPipeableSSRStream((writable) => {
          const writeAvailable = () => {
            while (writes < totalChunks) {
              const chunk = new Uint8Array(chunkSize);
              chunk.fill(writes % 251);
              writes += 1;
              if (!writable.write(chunk)) {
                writable.once("drain", writeAvailable);
                return;
              }
            }
            completed = true;
            writable.end();
          };
          writeAvailable();
        });
      },
    });

    const renderer = new SSRRenderer("production");
    const result = await renderer.renderToHTML(
      React.createElement("div"),
      { mode: "production", wantsStream: true },
    );
    await waitUntil(() => writes > 0 || completed);

    assertEquals(completed, false);
    assertEquals(writes < totalChunks, true);

    const output = new Uint8Array(chunkSize * totalChunks);
    let offset = 0;
    const reader = result.stream!.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output.set(value, offset);
      offset += value.byteLength;
    }

    assertEquals(offset, output.byteLength);
    assertEquals(completed, true);
    for (let index = 0; index < totalChunks; index += 1) {
      const expected = index % 251;
      assertEquals(output[index * chunkSize], expected);
      assertEquals(output[(index + 1) * chunkSize - 1], expected);
    }
  });

  it("aborts and destroys a pipeable stream when piping throws synchronously", async () => {
    const failure = new Error("pipe invocation failed");
    let abortCount = 0;
    let writable: (NodeJS.WritableStream & { destroyed?: boolean }) | undefined;

    __injectReactDOMServerForTests({
      renderToString: () => "<div>unused</div>",
      renderToStaticMarkup: () => "<div>static</div>",
      renderToReadableStream: undefined,
      renderToPipeableStream: (_element, options) => {
        queueMicrotask(() => options?.onShellReady?.());
        return createPipeableSSRStream(
          (destination) => {
            writable = destination;
            throw failure;
          },
          () => {
            abortCount += 1;
          },
        );
      },
    });

    const renderer = new SSRRenderer("production");
    const result = await renderer.renderToHTML(
      React.createElement("div"),
      { mode: "production", wantsStream: true },
    );
    const reader = result.stream!.getReader();
    let rejection: unknown;
    try {
      await reader.read();
    } catch (error) {
      rejection = error;
    }

    assertStrictEquals(rejection, failure);
    assertEquals(abortCount, 1);
    assertEquals(writable?.destroyed, true);
  });

  it("bounds buffered readable-stream output and cancels the render", async () => {
    let cancelled = false;
    __injectReactDOMServerForTests({
      renderToString: () => "<div>unused</div>",
      renderToStaticMarkup: () => "<div>static</div>",
      renderToReadableStream: async () =>
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3, 4, 5]));
          },
          cancel() {
            cancelled = true;
          },
        }) as Awaited<
          ReturnType<NonNullable<ReactDOMServer["renderToReadableStream"]>>
        >,
    });

    const renderer = new SSRRenderer("production");
    await assertRejects(
      () =>
        renderer.renderToHTML(React.createElement("div"), {
          mode: "production",
          wantsStream: false,
          maxBufferedBytes: 4,
        }),
      Error,
      "limit of 4 bytes",
    );
    assertEquals(cancelled, true);
  });

  it("bounds buffered pipeable output and aborts the render", async () => {
    let abortCalled = false;
    __injectReactDOMServerForTests({
      renderToString: () => "<div>unused</div>",
      renderToStaticMarkup: () => "<div>static</div>",
      renderToReadableStream: undefined,
      renderToPipeableStream: (_element, options) => {
        queueMicrotask(() => options?.onShellReady?.());
        return createPipeableSSRStream(
          (writable) => {
            writable.write(new Uint8Array([1, 2, 3, 4, 5]));
          },
          () => {
            abortCalled = true;
          },
        );
      },
    });

    const renderer = new SSRRenderer("production");
    await assertRejects(
      () =>
        renderer.renderToHTML(React.createElement("div"), {
          mode: "production",
          wantsStream: false,
          maxBufferedBytes: 4,
        }),
      Error,
      "limit of 4 bytes",
    );
    assertEquals(abortCalled, true);
  });

  it("uses the React version resolved from each project config", async () => {
    __injectReactDOMServerForTests({
      renderToString: () => "<div>react-18</div>",
      renderToStaticMarkup: () => "<div>react-18</div>",
    }, "18.3.1");
    __injectReactDOMServerForTests({
      renderToString: () => "<div>react-19</div>",
      renderToStaticMarkup: () => "<div>react-19</div>",
    }, "19.1.0");

    const react18Renderer = new SSRRenderer(
      "development",
      undefined,
      "/project-18",
      "project-18",
      { react: { version: "18.3.1" } } as VeryfrontConfig,
    );
    const react19Renderer = new SSRRenderer(
      "development",
      undefined,
      "/project-19",
      "project-19",
      { react: { version: "19.1.0" } } as VeryfrontConfig,
    );

    const [react18Result, react19Result] = await Promise.all([
      react18Renderer.renderToHTML(React.createElement("div"), {
        mode: "development",
        wantsStream: false,
      }),
      react19Renderer.renderToHTML(React.createElement("div"), {
        mode: "development",
        wantsStream: false,
      }),
    ]);

    assertEquals(react18Result.html, "<div>react-18</div>");
    assertEquals(react19Result.html, "<div>react-19</div>");
  });

  it("keeps a historical render on React A after snapshot B", async () => {
    __injectReactDOMServerForTests({
      renderToString: () => "<div>react-18</div>",
      renderToStaticMarkup: () => "<div>react-18</div>",
    }, "18.3.1");
    __injectReactDOMServerForTests({
      renderToString: () => "<div>react-19</div>",
      renderToStaticMarkup: () => "<div>react-19</div>",
    }, "19.0.0");
    const projectDir = await Deno.makeTempDir({ prefix: "vf-ssr-react-snapshot-" });
    try {
      await Deno.writeTextFile(
        `${projectDir}/package.json`,
        JSON.stringify({ dependencies: { react: "^19.0.0" } }),
      );
      const renderer = new SSRRenderer(
        "development",
        undefined,
        projectDir,
        "project",
      );

      const snapshotB = await renderer.renderToHTML(React.createElement("div"), {
        mode: "development",
        wantsStream: false,
      });
      const snapshotA = await renderer.renderToHTML(React.createElement("div"), {
        mode: "development",
        wantsStream: false,
        dependencyPinningCacheKey: "on:snapshot-a",
        dependencyPinningDependencies: { react: "^18.3.1" },
      });

      assertEquals(snapshotB.html, "<div>react-19</div>");
      assertEquals(snapshotA.html, "<div>react-18</div>");
    } finally {
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("uses the client hydration identifier prefix for string rendering", async () => {
    let identifierPrefix: string | undefined;
    __injectReactDOMServerForTests({
      renderToString: (_element, options) => {
        identifierPrefix = options?.identifierPrefix;
        return "<div>string</div>";
      },
      renderToStaticMarkup: () => "<div>static</div>",
      renderToReadableStream: undefined,
      renderToPipeableStream: undefined,
    });

    const renderer = new SSRRenderer("development");
    const result = await renderer.renderToHTML(
      React.createElement("div"),
      { mode: "development", wantsStream: false },
    );

    assertEquals(result.html, "<div>string</div>");
    assertEquals(identifierPrefix, "vf");
  });

  it("reports an explicit project React version before the first render", () => {
    const renderer = new SSRRenderer(
      "production",
      undefined,
      "/project-17",
      "project-17",
      { react: { version: "17.0.2" } } as VeryfrontConfig,
    );

    assertEquals(renderer.getRenderingStrategy(), {
      method: "string",
      reactVersion: "17.0.2",
      features: {
        streaming: false,
        suspense: false,
        concurrent: false,
      },
    });
    assertEquals(renderer.supportsStreaming(), false);
  });
});
