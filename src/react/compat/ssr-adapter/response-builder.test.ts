import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createSSRResponseFromResult } from "./response-builder.ts";

const encoder = new TextEncoder();

describe("createSSRResponse", () => {
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
