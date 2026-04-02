import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import * as React from "react";
import type { ReactDOMServer } from "../react/compat/ssr-adapter/server-loader.ts";
import {
  __injectReactDOMServerForTests,
  resetReactCache,
} from "../react/compat/ssr-adapter/server-loader.ts";
import { SSRRenderer } from "./ssr-renderer.ts";

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
});
