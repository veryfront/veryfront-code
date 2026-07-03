import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withTempDir } from "#veryfront/testing";
import { LocalBlobStorage } from "#veryfront/workflow/blob/local-storage.ts";
import type { BlobRef, BlobStorage, StoreBlobOptions } from "#veryfront/workflow/blob/types.ts";
import { createChatUploadHandler } from "./upload-handler.ts";

function postFile(file: File): Request {
  const form = new FormData();
  form.append("file", file, file.name);
  return new Request("http://localhost:3000/api/uploads", { method: "POST", body: form });
}

const txt = (body: string, name = "note.txt", type = "text/plain") =>
  new File([body], name, { type });

describe("chat/upload-handler", () => {
  describe("POST", () => {
    it("stores a file and returns id, url, name, mediaType, and size", () =>
      withTempDir(async (dir) => {
        const { POST } = createChatUploadHandler({
          storage: new LocalBlobStorage(dir),
          authorize: () => true,
        });

        const res = await POST(postFile(txt("hello world")));
        assertEquals(res.status, 200, "a valid upload should succeed");
        const body = await res.json() as Record<string, unknown>;

        assert(typeof body.id === "string" && body.id.length > 0, "id should be present");
        assertEquals(body.name, "note.txt", "sanitized filename should round-trip");
        assertEquals(body.mediaType, "text/plain", "the file's media type should be echoed");
        assertEquals(body.size, 11, "byte size should be reported");
      }));

    it("falls back to a same-origin GET url when the store has no url of its own", () =>
      withTempDir(async (dir) => {
        const { POST } = createChatUploadHandler({
          storage: new LocalBlobStorage(dir),
          authorize: () => true,
        });
        const body = await (await POST(postFile(txt("x")))).json() as { url: string; id: string };
        assertEquals(
          body.url,
          `http://localhost:3000/api/uploads?id=${body.id}`,
          "local storage should serve back via our own GET, absolute + same-origin",
        );
      }));

    it("uses the mounted route path for fallback GET urls", () =>
      withTempDir(async (dir) => {
        const { POST } = createChatUploadHandler({
          storage: new LocalBlobStorage(dir),
          authorize: () => true,
        });
        const form = new FormData();
        form.append("file", txt("x"), "note.txt");
        const body = await (await POST(
          new Request("http://localhost:3000/api/chat/uploads?source=composer", {
            method: "POST",
            body: form,
          }),
        )).json() as { url: string; id: string };
        assertEquals(
          body.url,
          `http://localhost:3000/api/chat/uploads?id=${body.id}`,
          "fallback URLs should follow the route where the handler is mounted",
        );
      }));

    it("prefers the backend's own url when the store provides one (cloud/S3)", () =>
      withTempDir(async (dir) => {
        // A store that returns an external URL from stat() — like a signed CDN url.
        const inner = new LocalBlobStorage(dir);
        const store: BlobStorage = {
          put: (data: string | Uint8Array | Blob | ReadableStream, opts?: StoreBlobOptions) =>
            inner.put(data, opts),
          getStream: (id: string) => inner.getStream(id),
          getText: (id: string) => inner.getText(id),
          getBytes: (id: string) => inner.getBytes(id),
          delete: (id: string) => inner.delete(id),
          exists: (id: string) => inner.exists(id),
          stat: async (id: string): Promise<BlobRef | null> => {
            const ref = await inner.stat(id);
            return ref ? { ...ref, url: `https://cdn.example.com/${id}` } : null;
          },
        };
        const { POST } = createChatUploadHandler({ storage: store, authorize: () => true });
        const body = await (await POST(postFile(txt("x")))).json() as { url: string; id: string };
        assertEquals(
          body.url,
          `https://cdn.example.com/${body.id}`,
          "an external store url should be used verbatim, not our GET fallback",
        );
      }));

    it("sanitizes path separators and control characters out of the filename", () =>
      withTempDir(async (dir) => {
        const { POST } = createChatUploadHandler({
          storage: new LocalBlobStorage(dir),
          authorize: () => true,
        });
        const body = await (await POST(postFile(txt("x", "../../etc/passwd"))))
          .json() as { name: string };
        assert(!body.name.includes("/"), "forward slashes must be stripped from the name");
        assert(!body.name.includes("\\"), "back slashes must be stripped from the name");
        assert(body.name.length > 0, "a sanitized name should never be empty");
      }));

    it("rejects files over the size limit with 413", () =>
      withTempDir(async (dir) => {
        const { POST } = createChatUploadHandler({
          storage: new LocalBlobStorage(dir),
          maxFileSize: 8,
          authorize: () => true,
        });
        const res = await POST(postFile(txt("way too many bytes")));
        assertEquals(res.status, 413, "oversized files should be rejected before storage");
      }));

    it("returns 400 when no file field is present", () =>
      withTempDir(async (dir) => {
        const { POST } = createChatUploadHandler({
          storage: new LocalBlobStorage(dir),
          authorize: () => true,
        });
        const res = await POST(
          new Request("http://localhost:3000/api/uploads", {
            method: "POST",
            body: new FormData(),
          }),
        );
        assertEquals(res.status, 400, "a missing file should be a client error");
      }));

    it("rejects unauthorized requests with 401 before reading the body", () =>
      withTempDir(async (dir) => {
        const { POST } = createChatUploadHandler({
          storage: new LocalBlobStorage(dir),
          authorize: () => false,
        });
        const res = await POST(postFile(txt("secret")));
        assertEquals(res.status, 401, "authorize:false should block the upload");
      }));

    it("lets authorize short-circuit with its own Response", () =>
      withTempDir(async (dir) => {
        const { POST } = createChatUploadHandler({
          storage: new LocalBlobStorage(dir),
          authorize: () => new Response("nope", { status: 403 }),
        });
        const res = await POST(postFile(txt("x")));
        assertEquals(res.status, 403, "a Response from authorize should be returned as-is");
      }));
  });

  describe("GET", () => {
    it("streams a stored file back with its media type and length", () =>
      withTempDir(async (dir) => {
        const { POST, GET } = createChatUploadHandler({
          storage: new LocalBlobStorage(dir),
          authorize: () => true,
        });
        const { url } = await (await POST(postFile(txt("hello world")))).json() as { url: string };

        const served = await GET(new Request(url));
        assertEquals(served.status, 200, "the just-uploaded file should be retrievable");
        assertEquals(served.headers.get("content-type"), "text/plain", "media type preserved");
        assertEquals(served.headers.get("content-length"), "11", "byte length reported");
        assertEquals(await served.text(), "hello world", "the exact bytes should round-trip");
      }));

    it("rejects an id that is not a safe token (path traversal) with 400", () =>
      withTempDir(async (dir) => {
        const { GET } = createChatUploadHandler({
          storage: new LocalBlobStorage(dir),
          authorize: () => true,
        });
        const res = await GET(
          new Request("http://localhost:3000/api/uploads?id=..%2F..%2Fetc%2Fpasswd"),
        );
        assertEquals(res.status, 400, "unsafe ids must be rejected before touching storage");
      }));

    it("returns 404 for an unknown id", () =>
      withTempDir(async (dir) => {
        const { GET } = createChatUploadHandler({
          storage: new LocalBlobStorage(dir),
          authorize: () => true,
        });
        const res = await GET(new Request("http://localhost:3000/api/uploads?id=does-not-exist"));
        assertEquals(res.status, 404, "a missing blob should be a 404");
      }));

    it("lists the adapter's stored files (newest first) when no id is given", () =>
      withTempDir(async (dir) => {
        const { POST, GET } = createChatUploadHandler({
          storage: new LocalBlobStorage(dir),
          authorize: () => true,
        });
        await (await POST(postFile(txt("one")))).json();
        await (await POST(postFile(txt("two")))).json();

        const res = await GET(new Request("http://localhost:3000/api/uploads"));
        assertEquals(res.status, 200, "GET without an id lists stored files");
        const body = await res.json() as {
          items: { id: string; url: string; name: string; size: number; mediaType: string }[];
        };
        assertEquals(body.items.length, 2, "both stored files are listed");
        for (const item of body.items) {
          assertEquals(typeof item.id, "string");
          assertStringIncludes(item.url, "/api/uploads?id=", "serves via same-origin GET url");
          assertEquals(item.mediaType, "text/plain", "media type is reported");
          assertEquals(item.size, 3, "byte size is reported");
        }
      }));

    it("lists fallback urls on the mounted route path", () =>
      withTempDir(async (dir) => {
        const { POST, GET } = createChatUploadHandler({
          storage: new LocalBlobStorage(dir),
          authorize: () => true,
        });
        await POST(postFile(txt("one")));

        const res = await GET(new Request("http://localhost:3000/api/chat/uploads"));
        assertEquals(res.status, 200, "GET without an id lists stored files");
        const body = await res.json() as { items: { url: string }[] };
        assertStringIncludes(
          body.items[0]?.url ?? "",
          "/api/chat/uploads?id=",
          "listed fallback urls should follow the route where the handler is mounted",
        );
      }));

    it("returns 501 with an empty list when the backend cannot list", () =>
      withTempDir(async () => {
        // A minimal store without `list` — feature detection must not throw.
        const store: BlobStorage = {
          put: () =>
            Promise.resolve({
              __kind: "blob",
              id: "x",
              size: 0,
              mimeType: "text/plain",
              createdAt: new Date(0),
            }),
          getStream: () => Promise.resolve(null),
          getText: () => Promise.resolve(null),
          getBytes: () => Promise.resolve(null),
          delete: () => Promise.resolve(),
          exists: () => Promise.resolve(false),
          stat: () => Promise.resolve(null),
        };
        const { GET } = createChatUploadHandler({ storage: store, authorize: () => true });
        const res = await GET(new Request("http://localhost:3000/api/uploads"));
        assertEquals(res.status, 501, "no-list backend reports unsupported");
        assertEquals((await res.json()).items.length, 0, "and an empty list");
      }));
  });

  describe("DELETE", () => {
    it("removes a stored file so a later GET 404s", () =>
      withTempDir(async (dir) => {
        const { POST, GET, DELETE } = createChatUploadHandler({
          storage: new LocalBlobStorage(dir),
          authorize: () => true,
        });
        const { id, url } = await (await POST(postFile(txt("bye"))))
          .json() as { id: string; url: string };

        const del = await DELETE(
          new Request(`http://localhost:3000/api/uploads?id=${id}`, {
            method: "DELETE",
          }),
        );
        assertEquals(del.status, 200, "delete of an existing file should succeed");
        assertEquals(await del.json(), { id, deleted: true });

        const served = await GET(new Request(url));
        assertEquals(served.status, 404, "the file should be gone after delete");
      }));

    it("is idempotent — deleting an unknown id still succeeds", () =>
      withTempDir(async (dir) => {
        const { DELETE } = createChatUploadHandler({
          storage: new LocalBlobStorage(dir),
          authorize: () => true,
        });
        const res = await DELETE(
          new Request("http://localhost:3000/api/uploads?id=never-existed", { method: "DELETE" }),
        );
        assertEquals(res.status, 200, "deleting a missing file is a no-op success");
      }));

    it("rejects an unsafe id with 400 before touching storage", () =>
      withTempDir(async (dir) => {
        const { DELETE } = createChatUploadHandler({
          storage: new LocalBlobStorage(dir),
          authorize: () => true,
        });
        const res = await DELETE(
          new Request("http://localhost:3000/api/uploads?id=..%2F..%2Fetc%2Fpasswd", {
            method: "DELETE",
          }),
        );
        assertEquals(res.status, 400, "unsafe ids must be rejected");
      }));

    it("rejects unauthorized deletes with 401", () =>
      withTempDir(async (dir) => {
        const { DELETE } = createChatUploadHandler({
          storage: new LocalBlobStorage(dir),
          authorize: () => false,
        });
        const res = await DELETE(
          new Request("http://localhost:3000/api/uploads?id=whatever", { method: "DELETE" }),
        );
        assertEquals(res.status, 401, "authorize:false should block the delete");
      }));
  });
});
