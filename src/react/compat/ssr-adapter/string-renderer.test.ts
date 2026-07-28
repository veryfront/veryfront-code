import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import * as React from "react";
import type { ReactDOMServer } from "./server-loader.ts";
import { __injectReactDOMServerForTests, resetReactCache } from "./server-loader.ts";
import { renderToStaticMarkupAdapter, renderToStringAdapter } from "./string-renderer.ts";

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

describe("react/compat/ssr-adapter/string-renderer", () => {
  afterEach(() => {
    __injectReactDOMServerForTests(null);
    resetReactCache();
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
});
