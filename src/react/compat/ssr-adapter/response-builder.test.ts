import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import * as React from "react";
import { createSSRResponse, createSSRResponseFromResult } from "./response-builder.ts";
import type { ReactDOMServer } from "./server-loader.ts";
import { __injectReactDOMServerForTests, resetReactCache } from "./server-loader.ts";

const encoder = new TextEncoder();

describe("createSSRResponse", () => {
  afterEach(() => resetReactCache());

  it("reports the supplied runtime version without using the legacy renderer", async () => {
    __injectReactDOMServerForTests({
      renderToString: () => "legacy",
      renderToStaticMarkup: () => "legacy",
    });
    const response = await createSSRResponse(React.createElement("div"), {
      reactRuntime: {
        react: { ...React, version: "18.3.1" },
        server: { renderToString: () => "prepared", renderToStaticMarkup: () => "prepared" },
      },
    });
    assertStringIncludes(await response.text(), "prepared");
    assertEquals(response.headers.get("x-react-version"), "18.3.1");
  });

  it("wraps readable renderer output in a complete HTML document", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("<main>streamed</main>"));
        controller.close();
      },
    });
    const response = await createSSRResponseFromResult(
      { stream },
      {
        title: "Stream & shell",
        meta: { description: "stream response" },
        headers: new Headers({ "Content-Length": "7" }),
      },
      "19.2.4",
    );
    const html = await response.text();

    assertStringIncludes(html, "<!DOCTYPE html>");
    assertStringIncludes(html, "<title>Stream &amp; shell</title>");
    assertStringIncludes(html, '<meta name="description" content="stream response">');
    assertStringIncludes(html, '<div id="root"><main>streamed</main></div>');
    assertEquals(response.headers.get("content-type"), "text/html; charset=utf-8");
    assertEquals(response.headers.get("x-content-type-options"), "nosniff");
    assertEquals(response.headers.get("x-react-version"), "19.2.4");
    assertEquals(response.headers.get("content-length"), null);
  });

  it("bridges a Node pipeable result into the same document stream", async () => {
    const response = await createSSRResponseFromResult(
      {
        pipe(destination) {
          destination.write(encoder.encode("<section>pipeable</section>"));
          destination.end();
        },
      },
      { title: "Pipeable" },
      "18.3.1",
    );

    assertStringIncludes(
      await response.text(),
      '<div id="root"><section>pipeable</section></div>',
    );
  });

  it("keeps document bootstrap tags outside the hydration root", async () => {
    let rendererOptions:
      | Parameters<NonNullable<ReactDOMServer["renderToReadableStream"]>>[1]
      | undefined;
    const componentStream = Object.assign(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("<main>rendered</main>"));
          controller.close();
        },
      }),
      { allReady: Promise.resolve() },
    );
    const server: ReactDOMServer = {
      renderToString: () => "<main>rendered</main>",
      renderToStaticMarkup: () => "<main>rendered</main>",
      renderToReadableStream(_element, options) {
        rendererOptions = options;
        return Promise.resolve(componentStream);
      },
    };
    __injectReactDOMServerForTests(server, "19.2.4");

    const response = await createSSRResponse(
      React.createElement("main", null, "rendered"),
      {
        reactVersion: "19.2.4",
        bootstrapScripts: ["/app.js"],
        bootstrapModules: ["/app.mjs"],
        nonce: "response-nonce",
      },
    );
    const html = await response.text();
    const rootEnd = html.indexOf("</div>");
    const scriptTag = '<script src="/app.js" nonce="response-nonce" async></script>';
    const moduleTag = '<script src="/app.mjs" type="module" nonce="response-nonce" async></script>';

    assertEquals(html.split(scriptTag).length - 1, 1);
    assertEquals(html.split(moduleTag).length - 1, 1);
    assertEquals(html.indexOf(scriptTag) > rootEnd, true);
    assertEquals(html.indexOf(moduleTag) > rootEnd, true);
    assertEquals(rendererOptions?.bootstrapScripts, []);
    assertEquals(rendererOptions?.bootstrapModules, []);
  });

  it("fails closed when a renderer violates the result contract", async () => {
    await assertRejects(
      () => createSSRResponseFromResult({}, {}, "19.2.4"),
      TypeError,
      "returned no HTML",
    );
  });

  it("aborts pipeable rendering when the response consumer cancels", async () => {
    let abortCalls = 0;
    const response = await createSSRResponseFromResult(
      {
        abort() {
          abortCalls += 1;
        },
        pipe(destination) {
          destination.write(encoder.encode("<main>partial"));
        },
      },
      {},
      "18.3.1",
    );
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Expected a streaming response body");
    await reader.read();
    await reader.cancel("consumer stopped");
    assertEquals(abortCalls, 1);
  });
});
