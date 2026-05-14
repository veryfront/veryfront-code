import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { getRuntimeUploadUrl } from "./upload-url-client.ts";

Deno.test("getRuntimeUploadUrl fetches project-scoped signed upload URLs", async () => {
  const requestedUrls: string[] = [];
  const fetchUploadUrl = (url: string, _init: RequestInit): Promise<Response> => {
    requestedUrls.push(url);
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
});

Deno.test("getRuntimeUploadUrl fetches global signed upload URLs", async () => {
  const requestedUrls: string[] = [];
  const fetchUploadUrl = (url: string, _init: RequestInit): Promise<Response> => {
    requestedUrls.push(url);
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
});

Deno.test("getRuntimeUploadUrl reports API errors", async () => {
  const fetchUploadUrl = (_url: string, _init: RequestInit): Promise<Response> =>
    Promise.resolve(
      new Response(JSON.stringify({ detail: "not allowed" }), {
        status: 403,
      }),
    );

  await assertRejects(
    () =>
      getRuntimeUploadUrl({
        apiUrl: "https://api.example.com",
        authToken: "token-1",
        uploadId: "upload-1",
        fetch: fetchUploadUrl,
      }),
    Error,
    "not allowed",
  );
});

Deno.test("getRuntimeUploadUrl rejects invalid responses", async () => {
  const fetchUploadUrl = (_url: string, _init: RequestInit): Promise<Response> =>
    Promise.resolve(
      new Response(JSON.stringify({ url: "https://signed.example.com/file.txt" }), {
        status: 200,
      }),
    );

  await assertRejects(
    () =>
      getRuntimeUploadUrl({
        apiUrl: "https://api.example.com",
        authToken: "token-1",
        uploadId: "upload-1",
        fetch: fetchUploadUrl,
      }),
    Error,
    "invalid API response",
  );
});
