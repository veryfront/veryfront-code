import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import * as React from "react";
import * as actualReactDOMServer from "react-dom/server";
import type { ReactDOMServer } from "../react/compat/ssr-adapter/server-loader.ts";
import {
  __injectProjectReactForTests,
  __injectReactDOMServerForTests,
  resetReactCache,
} from "../react/compat/ssr-adapter/server-loader.ts";
import { SSRRenderer } from "./ssr-renderer.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { ColorModeScript } from "#veryfront/react/components/ui/color-mode.tsx";
import { Head } from "#veryfront/react/runtime/core.ts";
import { runWithHeadCollector } from "#veryfront/react/head-collector.ts";
import { resolveCommittedHeadFromHTML } from "./orchestrator/html-head.ts";

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
        queueMicrotask(() => {
          options?.onShellReady?.();
          options?.onAllReady?.();
        });
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
    const allReady =
      (result.stream as ReadableStream<Uint8Array> & { allReady?: Promise<unknown> }).allReady;
    assertExists(
      allReady,
      "pipeable true-streaming must carry allReady onto the converted ReadableStream so ssr.service can observe late redirect/notFound errors",
    );
    await allReady;
    await result.stream?.cancel(new Error("stop"));
    await result.stream?.cancel(new Error("stop again"));
    assertEquals(abortCount, 1);
  });

  it("forwards the response nonce to React-owned streaming scripts", async () => {
    let observedNonce:
      | NonNullable<
        Parameters<NonNullable<ReactDOMServer["renderToReadableStream"]>>[1]
      >["nonce"]
      | undefined;
    const streamAllReady: Promise<void> = Promise.resolve();
    __injectReactDOMServerForTests({
      renderToString: () => "<div>unused</div>",
      renderToStaticMarkup: () => "<div>static</div>",
      renderToReadableStream: (_element, options) => {
        observedNonce = options?.nonce;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("<div>streamed</div>"));
            controller.close();
          },
        });
        return Promise.resolve(
          Object.assign(stream, { allReady: streamAllReady }) as Awaited<
            ReturnType<NonNullable<ReactDOMServer["renderToReadableStream"]>>
          >,
        );
      },
    });

    const renderer = new SSRRenderer("production");
    const result = await renderer.renderToHTML(
      React.createElement("div"),
      { mode: "production", wantsStream: true, nonce: "response-nonce" },
    );

    assertEquals(observedNonce, "response-nonce");
    assertStrictEquals(
      (result.stream as ReadableStream<Uint8Array> & { allReady?: Promise<unknown> }).allReady,
      streamAllReady,
      "readable-stream true-streaming must carry allReady onto the returned stream so ssr.service can observe late redirect/notFound errors",
    );
    await result.stream?.cancel();
  });

  it("keeps the CSP nonce through real SSR globals and a suspended retry", async () => {
    __injectReactDOMServerForTests(actualReactDOMServer, React.version);
    __injectProjectReactForTests(React, React.version);
    const renderer = new SSRRenderer(
      "production",
      undefined,
      undefined,
      undefined,
      { react: { version: React.version } } as VeryfrontConfig,
    );
    async function SuspendedColorModeScript() {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return React.createElement(ColorModeScript);
    }

    const rendered = await runWithHeadCollector(
      (renderContext) =>
        renderer.renderToHTML(
          React.createElement(
            React.Suspense,
            { fallback: React.createElement("p", null, "loading") },
            React.createElement(SuspendedColorModeScript),
          ),
          {
            mode: "production",
            wantsStream: false,
            nonce: "response-nonce",
            renderContext,
          },
        ),
      { nonce: "response-nonce" },
    );

    assertStringIncludes(
      rendered.result.html,
      '<script nonce="response-nonce">',
    );
  });

  it("retains request-bound Head authority after a true stream leaves async storage", async () => {
    __injectReactDOMServerForTests(actualReactDOMServer, React.version);
    __injectProjectReactForTests(React, React.version);
    const renderer = new SSRRenderer(
      "production",
      undefined,
      undefined,
      undefined,
      { react: { version: React.version } } as VeryfrontConfig,
    );
    const release = Promise.withResolvers<void>();
    async function SuspendedHead() {
      await release.promise;
      return React.createElement(
        Head,
        null,
        React.createElement("title", null, "Async title"),
      );
    }

    const rendered = await runWithHeadCollector(
      (renderContext) =>
        renderer.renderToHTML(
          React.createElement(
            React.Suspense,
            { fallback: React.createElement("p", null, "loading") },
            React.createElement(SuspendedHead),
          ),
          {
            mode: "production",
            wantsStream: true,
            nonce: "stream-nonce",
            renderContext,
          },
        ),
      { nonce: "stream-nonce" },
    );

    release.resolve();
    const html = await new Response(rendered.result.stream).text();
    const head = resolveCommittedHeadFromHTML(html, rendered.head);
    assertEquals(head?.title, "Async title");
  });

  it("isolates concurrent suspended streams and their nonces", async () => {
    __injectReactDOMServerForTests(actualReactDOMServer, React.version);
    __injectProjectReactForTests(React, React.version);
    const renderer = new SSRRenderer(
      "production",
      undefined,
      undefined,
      undefined,
      { react: { version: React.version } } as VeryfrontConfig,
    );
    const firstRelease = Promise.withResolvers<void>();
    const secondRelease = Promise.withResolvers<void>();

    const startRequest = (title: string, nonce: string, release: Promise<void>) => {
      async function SuspendedRequestContent() {
        await release;
        return React.createElement(
          React.Fragment,
          null,
          React.createElement(
            Head,
            null,
            React.createElement("title", null, title),
          ),
          React.createElement(ColorModeScript),
        );
      }
      return runWithHeadCollector(
        (renderContext) =>
          renderer.renderToHTML(
            React.createElement(
              React.Suspense,
              { fallback: React.createElement("p", null, "loading") },
              React.createElement(SuspendedRequestContent),
            ),
            {
              mode: "production",
              wantsStream: true,
              nonce,
              renderContext,
            },
          ),
        { nonce },
      );
    };

    const [first, second] = await Promise.all([
      startRequest("First title", "first-nonce", firstRelease.promise),
      startRequest("Second title", "second-nonce", secondRelease.promise),
    ]);
    secondRelease.resolve();
    firstRelease.resolve();
    const [firstHtml, secondHtml] = await Promise.all([
      new Response(first.result.stream).text(),
      new Response(second.result.stream).text(),
    ]);

    assertEquals(resolveCommittedHeadFromHTML(firstHtml, first.head)?.title, "First title");
    assertEquals(resolveCommittedHeadFromHTML(secondHtml, second.head)?.title, "Second title");
    assertStringIncludes(firstHtml, 'nonce="first-nonce"');
    assertStringIncludes(secondHtml, 'nonce="second-nonce"');
    assertEquals(firstHtml.includes('nonce="second-nonce"'), false);
    assertEquals(secondHtml.includes('nonce="first-nonce"'), false);
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
      renderToReadableStream: () =>
        Promise.resolve(
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
        ),
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

  it("rejects with a render error when the adapter produces no output", async () => {
    __injectReactDOMServerForTests({
      renderToString: () => "",
      renderToStaticMarkup: () => "",
      renderToReadableStream: undefined,
      renderToPipeableStream: undefined,
    });

    const renderer = new SSRRenderer("production");
    const error = await assertRejects(
      () =>
        renderer.renderToHTML(
          React.createElement("div"),
          { mode: "production", wantsStream: true },
        ),
      Error,
    );

    assertStringIncludes(
      String(error),
      "SSR failed - no output",
      "a render that produces no output must surface a RENDER_ERROR, never a blank success",
    );
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
