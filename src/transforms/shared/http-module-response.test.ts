import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_HTTP_MODULE_RESPONSE_BYTES, readHttpModuleResponse } from "./http-module-response.ts";

describe("transforms/shared/http-module-response", () => {
  it("reads a bounded module body", async () => {
    assertEquals(
      await readHttpModuleResponse(new Response("export const value = 1;")),
      "export const value = 1;",
    );
  });

  it("rejects an oversized declared content length", async () => {
    const response = new Response("small body", {
      headers: {
        "content-length": String(MAX_HTTP_MODULE_RESPONSE_BYTES + 1),
      },
    });

    assertEquals(await readHttpModuleResponse(response), null);
  });

  it("rejects an oversized streamed body when content length is absent", async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(MAX_HTTP_MODULE_RESPONSE_BYTES + 1));
          controller.close();
        },
      }),
    );

    assertEquals(await readHttpModuleResponse(response), null);
  });
});
