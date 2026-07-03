import { assert, assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { withTempDir } from "#veryfront/testing";
import { LocalBlobStorage } from "#veryfront/workflow/blob/local-storage.ts";
import { createChatUploadHandler } from "veryfront/chat/uploads";

/**
 * Exercises the handler over a real HTTP server: multipart parsing, the
 * absolute same-origin URL it hands back, and streaming the bytes out of GET —
 * the parts the in-process unit tests can't fully cover. Every response body
 * is consumed and the server is shut down (abort + `server.finished`) before
 * each test returns, so the sanitizers stay on.
 */
describe("chat/upload-handler over HTTP", () => {
  it("round-trips a real multipart upload and serves it back from the returned url", () =>
    withTempDir(async (dir) => {
      const { POST, GET } = createChatUploadHandler({
        storage: new LocalBlobStorage(dir),
        authorize: () => true,
      });

      const controller = new AbortController();
      const server = Deno.serve(
        { port: 0, signal: controller.signal, onListen: () => {} },
        (req) => {
          const { pathname } = new URL(req.url);
          if (pathname !== "/api/uploads") return new Response("not found", { status: 404 });
          return req.method === "POST" ? POST(req) : GET(req);
        },
      );
      const { port } = server.addr as Deno.NetAddr;

      try {
        const form = new FormData();
        form.append("file", new File(["integration bytes"], "hello.txt", { type: "text/plain" }));

        const res = await fetch(`http://127.0.0.1:${port}/api/uploads`, {
          method: "POST",
          body: form,
        });
        assertEquals(res.status, 200, "the multipart upload should succeed over HTTP");
        const body = await res.json() as { id: string; url: string; mediaType: string };

        assertEquals(body.mediaType, "text/plain", "media type should survive the wire");
        assert(
          body.url.startsWith(`http://127.0.0.1:${port}/api/uploads?id=`),
          `url should be absolute + same-origin, got ${body.url}`,
        );

        // The runtime fetches exactly this url — prove it resolves and streams.
        const served = await fetch(body.url);
        assertEquals(served.status, 200, "the returned url should serve the file back");
        assertEquals(served.headers.get("content-type"), "text/plain", "content type streamed");
        assertEquals(await served.text(), "integration bytes", "exact bytes should round-trip");
      } finally {
        controller.abort();
        await server.finished;
      }
    }));

  it("blocks an unauthorized upload with 401 over HTTP", () =>
    withTempDir(async (dir) => {
      const { POST } = createChatUploadHandler({
        storage: new LocalBlobStorage(dir),
        authorize: (req) => req.headers.get("authorization") === "Bearer secret",
      });

      const controller = new AbortController();
      const server = Deno.serve(
        { port: 0, signal: controller.signal, onListen: () => {} },
        (req) => POST(req),
      );
      const { port } = server.addr as Deno.NetAddr;

      try {
        const form = new FormData();
        form.append("file", new File(["x"], "x.txt", { type: "text/plain" }));
        const res = await fetch(`http://127.0.0.1:${port}/api/uploads`, {
          method: "POST",
          body: form,
        });
        await res.body?.cancel();
        assertEquals(res.status, 401, "an unauthenticated upload should be rejected");
      } finally {
        controller.abort();
        await server.finished;
      }
    }));
});
