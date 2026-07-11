import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
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

describe("rendering/ssr-renderer", () => {
  afterEach(() => {
    __injectReactDOMServerForTests(null);
    resetReactCache();
  });

  it("propagates stream cancellation to the pipeable render abort function", async () => {
    let abortCalled = false;

    __injectReactDOMServerForTests({
      renderToString: () => "<div>unused</div>",
      renderToStaticMarkup: () => "<div>static</div>",
      renderToReadableStream: undefined,
      renderToPipeableStream: (_element, options) => {
        queueMicrotask(() => options?.onShellReady?.());
        return createPipeableSSRStream(
          () => {},
          () => {
            abortCalled = true;
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
