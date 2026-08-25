import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { VeryfrontError } from "#veryfront/errors";
import { getRuntimeUploadUrl } from "./upload-url-client.ts";

Deno.test("getRuntimeUploadUrl fetches project-scoped signed upload URLs", async () => {
  const requestedUrls: string[] = [];
  const inits: RequestInit[] = [];
  const fetchUploadUrl = (url: string, init: RequestInit): Promise<Response> => {
    requestedUrls.push(url);
    inits.push(init);
    return Promise.resolve(
      new Response(JSON.stringify({ signed_url: "https://signed.example.com/file.txt" }), {
        status: 200,
      }),
    );
  };

  const signedUrl = await getRuntimeUploadUrl({
    apiUrl: "https://api.example.com/base",
    authToken: "token-1",
    projectId: "project-1",
    uploadId: "uploads/notes.txt",
    fetch: fetchUploadUrl,
  });

  assertEquals(signedUrl, "https://signed.example.com/file.txt");
  assertEquals(requestedUrls, [
    "https://api.example.com/projects/project-1/uploads/uploads%2Fnotes.txt/url",
  ]);
  assertEquals(
    new Headers(inits[0]?.headers).get("Authorization"),
    "Bearer token-1",
    "the signed upload URL request must carry the caller's bearer credential",
  );
  assertEquals(
    inits[0]?.signal instanceof AbortSignal,
    true,
    "the signed upload URL request must carry an abort signal so the default timeout applies",
  );
});

Deno.test("getRuntimeUploadUrl fetches global signed upload URLs", async () => {
  const requestedUrls: string[] = [];
  const inits: RequestInit[] = [];
  const fetchUploadUrl = (url: string, init: RequestInit): Promise<Response> => {
    requestedUrls.push(url);
    inits.push(init);
    return Promise.resolve(
      new Response(JSON.stringify({ signed_url: "https://signed.example.com/global.txt" }), {
        status: 200,
      }),
    );
  };

  const signedUrl = await getRuntimeUploadUrl({
    apiUrl: "https://api.example.com",
    authToken: "token-1",
    uploadId: "upload-1",
    fetch: fetchUploadUrl,
  });

  assertEquals(signedUrl, "https://signed.example.com/global.txt");
  assertEquals(requestedUrls, ["https://api.example.com/uploads/upload-1/url"]);
  assertEquals(
    new Headers(inits[0]?.headers).get("Authorization"),
    "Bearer token-1",
    "the global signed upload URL request must carry the caller's bearer credential",
  );
});

Deno.test("getRuntimeUploadUrl reports API errors", async () => {
  const fetchUploadUrl = (_url: string, _init: RequestInit): Promise<Response> =>
    Promise.resolve(
      new Response(JSON.stringify({ detail: "not allowed" }), {
        status: 403,
      }),
    );

  const err = await assertRejects(
    () =>
      getRuntimeUploadUrl({
        apiUrl: "https://api.example.com",
        authToken: "token-1",
        uploadId: "upload-1",
        fetch: fetchUploadUrl,
      }),
    VeryfrontError,
    "not allowed",
  );
  assertInstanceOf(err, VeryfrontError, "upload-URL failures must be a VeryfrontError");
  assertEquals(err.slug, "network-error", err.message);
  assertEquals(err.status, 502, "upload-URL failures must map to 502 at the HTTP boundary");
});

Deno.test("getRuntimeUploadUrl rejects invalid responses", async () => {
  const fetchUploadUrl = (_url: string, _init: RequestInit): Promise<Response> =>
    Promise.resolve(
      new Response(JSON.stringify({ url: "https://signed.example.com/file.txt" }), {
        status: 200,
      }),
    );

  const err = await assertRejects(
    () =>
      getRuntimeUploadUrl({
        apiUrl: "https://api.example.com",
        authToken: "token-1",
        uploadId: "upload-1",
        fetch: fetchUploadUrl,
      }),
    VeryfrontError,
    "invalid API response",
  );
  assertInstanceOf(err, VeryfrontError, "invalid upload-URL responses must be a VeryfrontError");
  assertEquals(err.slug, "network-error", err.message);
  assertEquals(
    err.status,
    502,
    "invalid upload-URL responses must map to 502 at the HTTP boundary",
  );
});
