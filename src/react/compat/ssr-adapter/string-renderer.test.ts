import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import * as React from "react";
import type { ReactDOMServer } from "./server-loader.ts";
import {
  __injectReactDOMServerForTests,
  getProjectReact,
  resetReactCache,
} from "./server-loader.ts";
import { renderToStaticMarkupAdapter, renderToStringAdapter } from "./string-renderer.ts";
import {
  resetSSRAdapterTimeoutForTests,
  setSSRAdapterDeadlineRuntimeForTests,
  setSSRAdapterTimeoutForTests,
} from "./timeout.ts";
import { getServerRenderContext } from "../../server-render-context.ts";

type ReadableOptions = NonNullable<
  Parameters<NonNullable<ReactDOMServer["renderToReadableStream"]>>[1]
>;
type StringOptions = NonNullable<Parameters<ReactDOMServer["renderToString"]>[1]>;

function createReadableSSRStream(html: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(html));
      controller.close();
    },
  });
}

function createManualDeadlineRuntime() {
  let now = 0;
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  return {
    runtime: {
      now: () => now,
      setTimer: (callback: () => void, _delayMs: number) => {
        const handle = nextHandle++;
        pending.set(handle, callback);
        return handle as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: (handle: ReturnType<typeof setTimeout>) => {
        pending.delete(handle as unknown as number);
      },
    },
    advance(milliseconds: number) {
      now += milliseconds;
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
    pendingCount: () => pending.size,
  };
}

async function waitForDeadline(
  runtime: ReturnType<typeof createManualDeadlineRuntime>,
): Promise<void> {
  for (let turn = 0; turn < 200; turn++) {
    if (runtime.pendingCount() > 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("SSR render did not arm its deadline within 200 event-loop turns");
}

describe("react/compat/ssr-adapter/string-renderer", () => {
  it("uses the supplied runtime for static markup without replacing the version cache", async () => {
    __injectReactDOMServerForTests({
      renderToString: () => "legacy",
      renderToStaticMarkup: () => "legacy",
    });
    const html = await renderToStaticMarkupAdapter(React.createElement("div"), {
      reactRuntime: {
        react: React,
        server: {
          renderToString: () => "prepared",
          renderToStaticMarkup: () => "prepared",
        },
      },
    });
    assertEquals(html, "prepared");
    assertEquals(await renderToStaticMarkupAdapter(React.createElement("div")), "legacy");
  });
  afterEach(() => {
    __injectReactDOMServerForTests(null);
    resetReactCache();
    resetSSRAdapterTimeoutForTests();
  });

  it("forwards readable-stream rendering options while buffering", async () => {
    let captured: ReadableOptions | undefined;
    __injectReactDOMServerForTests({
      renderToString: () => "<div>unused</div>",
      renderToStaticMarkup: () => "<div>unused</div>",
      renderToReadableStream: async (_element, options) => {
        captured = options;
        return createReadableSSRStream("<div>streamed</div>") as Awaited<
          ReturnType<NonNullable<ReactDOMServer["renderToReadableStream"]>>
        >;
      },
    });

    const html = await renderToStringAdapter(React.createElement("div"), {
      bootstrapModules: ["/bootstrap.mjs"],
      bootstrapScripts: ["/bootstrap.js"],
      identifierPrefix: "vf",
      namespaceURI: "http://www.w3.org/1999/xhtml",
      nonce: "nonce-1",
      progressiveChunkSize: 4096,
    });

    assertEquals(html, "<div>streamed</div>");
    assertEquals(captured?.bootstrapModules, ["/bootstrap.mjs"]);
    assertEquals(captured?.bootstrapScripts, ["/bootstrap.js"]);
    assertEquals(captured?.identifierPrefix, "vf");
    assertEquals(captured?.namespaceURI, "http://www.w3.org/1999/xhtml");
    assertEquals(captured?.nonce, "nonce-1");
    assertEquals(captured?.progressiveChunkSize, 4096);
    assertEquals(captured?.signal instanceof AbortSignal, true);
  });

  it("forwards identifierPrefix to string and static renderers", async () => {
    let stringOptions: StringOptions | undefined;
    let staticOptions: StringOptions | undefined;
    __injectReactDOMServerForTests({
      renderToString: (_element, options) => {
        stringOptions = options;
        return "<div>string</div>";
      },
      renderToStaticMarkup: (_element, options) => {
        staticOptions = options;
        return "<div>static</div>";
      },
      renderToReadableStream: undefined,
    });

    assertEquals(
      await renderToStringAdapter(React.createElement("div"), {
        identifierPrefix: "vf",
      }),
      "<div>string</div>",
    );
    assertEquals(
      await renderToStaticMarkupAdapter(React.createElement("div"), {
        identifierPrefix: "static-vf",
      }),
      "<div>static</div>",
    );
    assertEquals(stringOptions?.identifierPrefix, "vf");
    assertEquals(staticOptions?.identifierPrefix, "static-vf");
  });

  it("uses the selected React 18 context across bundles and suspended retries", async () => {
    const React18 = await getProjectReact("18.3.1");
    const copiedContextModule = await import(
      "../../server-render-context.ts?react18-context-copy"
    );
    const context = getServerRenderContext(React18);
    assertStrictEquals(
      copiedContextModule.getServerRenderContext(React18),
      context,
    );

    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let released = false;
    function SuspendedContextProbe() {
      started.resolve();
      if (!released) throw release.promise;
      const value = React18.useContext(
        context as React.Context<
          {
            nonce?: string;
          } | null
        >,
      );
      return React18.createElement("span", null, value?.nonce ?? "missing");
    }

    const rendering = renderToStringAdapter(
      React18.createElement(
        React18.Suspense,
        { fallback: React18.createElement("p", null, "loading") },
        React18.createElement(SuspendedContextProbe),
      ),
      {
        reactVersion: "18.3.1",
        renderContext: {
          nonce: "react-18-nonce",
          registerHeadPayload: () => "unused",
        },
      },
    );
    await started.promise;
    released = true;
    release.resolve();

    assertEquals(await rendering, "<!--$--><span>react-18-nonce</span><!--/$-->");
  });

  it("does not let a throwing error observer replace the render failure", async () => {
    __injectReactDOMServerForTests({
      renderToString: () => {
        throw new Error("render failed");
      },
      renderToStaticMarkup: () => "<div>unused</div>",
      renderToReadableStream: undefined,
    });

    await assertRejects(
      () =>
        renderToStringAdapter(React.createElement("div"), {
          onError: () => {
            throw new Error("observer failed");
          },
        }),
      Error,
      "render failed",
    );
  });

  it("does not invoke the string renderer after readable setup fails", async () => {
    const observed: string[] = [];
    let stringRenderCalls = 0;
    __injectReactDOMServerForTests({
      renderToString: () => {
        stringRenderCalls += 1;
        return "<div>must not render</div>";
      },
      renderToStaticMarkup: () => "<div>unused</div>",
      renderToReadableStream: async () => {
        throw new Error("readable setup failed");
      },
    });

    await assertRejects(
      () =>
        renderToStringAdapter(React.createElement("div"), {
          onError: (error) => observed.push(error.message),
        }),
      Error,
      "readable setup failed",
    );
    assertEquals(stringRenderCalls, 0);
    assertEquals(observed, ["readable setup failed"]);
  });

  it("cancels a buffered stream that stops making progress", async () => {
    let cancelled = false;
    let stringRenderCalls = 0;
    const deadline = createManualDeadlineRuntime();
    setSSRAdapterTimeoutForTests(5);
    setSSRAdapterDeadlineRuntimeForTests(deadline.runtime);
    __injectReactDOMServerForTests({
      renderToString: () => {
        stringRenderCalls += 1;
        return "<div>must not render</div>";
      },
      renderToStaticMarkup: () => "<div>unused</div>",
      renderToReadableStream: async () =>
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
        }) as Awaited<
          ReturnType<NonNullable<ReactDOMServer["renderToReadableStream"]>>
        >,
    });

    const assertion = assertRejects(
      () => renderToStringAdapter(React.createElement("div")),
      Error,
      "SSR timeout",
    );
    await waitForDeadline(deadline);
    deadline.advance(5);
    await assertion;
    assertEquals(stringRenderCalls, 0);
    assertEquals(cancelled, true);
  });

  it("bounds stream setup even when the renderer ignores its abort signal", async () => {
    let signal: AbortSignal | undefined;
    let stringRenderCalls = 0;
    const deadline = createManualDeadlineRuntime();
    setSSRAdapterTimeoutForTests(5);
    setSSRAdapterDeadlineRuntimeForTests(deadline.runtime);
    __injectReactDOMServerForTests({
      renderToString: () => {
        stringRenderCalls += 1;
        return "<div>must not render</div>";
      },
      renderToStaticMarkup: () => "<div>unused</div>",
      renderToReadableStream: (_element, options) => {
        signal = options?.signal as AbortSignal | undefined;
        return new Promise(() => {});
      },
    });

    const assertion = assertRejects(
      () => renderToStringAdapter(React.createElement("div")),
      Error,
      "SSR timeout",
    );
    await waitForDeadline(deadline);
    deadline.advance(5);
    await assertion;
    assertEquals(stringRenderCalls, 0);
    assertEquals(signal?.aborted, true);
  });

  it("enforces the absolute deadline while an always-ready stream starves timers", async () => {
    const cancelled = Promise.withResolvers<unknown>();
    let observed: Error | undefined;
    let thrown: unknown;
    setSSRAdapterTimeoutForTests(1);
    let clockReads = 0;
    setSSRAdapterDeadlineRuntimeForTests({
      now: () => clockReads++ < 3 ? 0 : 1,
      setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimer: () => {},
    });
    __injectReactDOMServerForTests({
      renderToString: () => "<div>must not render</div>",
      renderToStaticMarkup: () => "<div>unused</div>",
      renderToReadableStream: async () =>
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new Uint8Array(1024));
          },
          cancel(reason) {
            cancelled.resolve(reason);
          },
        }) as Awaited<
          ReturnType<NonNullable<ReactDOMServer["renderToReadableStream"]>>
        >,
    });

    await assertRejects(
      async () => {
        try {
          await renderToStringAdapter(React.createElement("div"), {
            maxBufferedBytes: 16 * 1024 * 1024,
            onError: (error) => {
              observed = error;
            },
          });
        } catch (error) {
          thrown = error;
          throw error;
        }
      },
      Error,
      "SSR timeout",
    );
    assertStrictEquals(observed, thrown as Error);
    assertStrictEquals(await cancelled.promise, thrown);
  });

  it("cancels and reports the owned failure when buffered output exceeds its limit", async () => {
    let cancelReason: unknown;
    let observed: Error | undefined;
    let thrown: unknown;
    __injectReactDOMServerForTests({
      renderToString: () => "<div>must not render</div>",
      renderToStaticMarkup: () => "<div>unused</div>",
      renderToReadableStream: async () =>
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3, 4, 5]));
          },
          cancel(reason) {
            cancelReason = reason;
          },
        }) as Awaited<
          ReturnType<NonNullable<ReactDOMServer["renderToReadableStream"]>>
        >,
    });

    await assertRejects(
      async () => {
        try {
          await renderToStringAdapter(React.createElement("div"), {
            maxBufferedBytes: 4,
            onError: (error) => {
              observed = error;
            },
          });
        } catch (error) {
          thrown = error;
          throw error;
        }
      },
      RangeError,
      "exceeded 4 bytes",
    );
    assertStrictEquals(observed, thrown as Error);
    assertStrictEquals(cancelReason, thrown);
  });

  it("enforces buffered output limits for direct string and static rendering", async () => {
    __injectReactDOMServerForTests({
      renderToString: () => "12345",
      renderToStaticMarkup: () => "🌍",
      renderToReadableStream: undefined,
    });

    await assertRejects(
      () =>
        renderToStringAdapter(React.createElement("div"), {
          maxBufferedBytes: 4,
        }),
      RangeError,
      "exceeded 4 bytes",
    );
    await assertRejects(
      () =>
        renderToStaticMarkupAdapter(React.createElement("div"), {
          maxBufferedBytes: 3,
        }),
      RangeError,
      "exceeded 3 bytes",
    );
  });

  it("rejects invalid buffered output limits before rendering", async () => {
    let renderCalls = 0;
    __injectReactDOMServerForTests({
      renderToString: () => {
        renderCalls += 1;
        return "unused";
      },
      renderToStaticMarkup: () => "unused",
      renderToReadableStream: undefined,
    });

    await assertRejects(
      () =>
        renderToStringAdapter(React.createElement("div"), {
          maxBufferedBytes: Number.MAX_VALUE,
        }),
      RangeError,
      "positive safe integer",
    );
    assertEquals(renderCalls, 0);
  });
});
