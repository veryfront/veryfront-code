import { assert, assertEquals, assertRejects, assertStrictEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { type BlobStorage, BlobStorageContractName } from "veryfront/workflow/blob";
import { GCSBlobStorage, type GCSBlobStorageConfig, type GCSFetch } from "./gcs-storage.ts";
import extBlobGCS from "./index.ts";

interface TestCredentials {
  keyPair: CryptoKeyPair;
  serviceAccountKey: string;
}

let testCredentialsPromise: Promise<TestCredentials> | undefined;

function getTestCredentials(): Promise<TestCredentials> {
  testCredentialsPromise ??= createTestCredentials();
  return testCredentialsPromise;
}

async function createTestCredentials(): Promise<TestCredentials> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2_048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const privateKey = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
  let binary = "";
  for (const byte of privateKey) binary += String.fromCharCode(byte);
  const lines = btoa(binary).match(/.{1,64}/g);
  assert(lines);
  return {
    keyPair,
    serviceAccountKey: JSON.stringify({
      type: "service_account",
      private_key: `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----`,
      client_email: "blob-test@example-project.iam.gserviceaccount.com",
    }),
  };
}

async function config(
  overrides: Partial<GCSBlobStorageConfig> = {},
): Promise<GCSBlobStorageConfig> {
  return {
    bucket: "example-bucket",
    serviceAccountKey: (await getTestCredentials()).serviceAccountKey,
    ...overrides,
  };
}

function urlOf(input: string | URL | Request): URL {
  return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
}

function tokenResponse(): Response {
  return Response.json({ access_token: "access-token", expires_in: 3_600 });
}

function objectResponse(overrides: Record<string, unknown> = {}): Response {
  return Response.json({
    size: "5",
    contentType: "text/plain",
    timeCreated: "2026-01-02T03:04:05.000Z",
    mediaLink: "https://storage.googleapis.com/download/object",
    ...overrides,
  });
}

function authenticatedFetch(
  storageHandler: (url: URL, init: RequestInit | undefined) => Response | Promise<Response>,
  tokenHandler: (init: RequestInit | undefined) => Response | Promise<Response> = tokenResponse,
): GCSFetch {
  return (input, init) => {
    const url = urlOf(input);
    return url.href === "https://oauth2.googleapis.com/token"
      ? Promise.resolve(tokenHandler(init))
      : Promise.resolve(storageHandler(url, init));
  };
}

function missingObjectResponse(url: URL): Response {
  return new Response(null, {
    status: url.pathname === "/storage/v1/b/example-bucket" ? 200 : 404,
  });
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function withoutAbortSignalAny(run: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, "any");
  Object.defineProperty(AbortSignal, "any", {
    configurable: true,
    value: undefined,
    writable: true,
  });
  try {
    run();
  } finally {
    if (descriptor) Object.defineProperty(AbortSignal, "any", descriptor);
    else delete (AbortSignal as { any?: unknown }).any;
  }
}

describe("GCSBlobStorage", () => {
  it("validates service-account and endpoint configuration synchronously", async () => {
    assertThrows(
      () => new GCSBlobStorage({ bucket: "bucket", serviceAccountKey: "not-json" }),
      Error,
      "valid JSON string",
    );
    assertThrows(
      () =>
        new GCSBlobStorage({
          bucket: "bucket",
          serviceAccountKey: JSON.stringify({ client_email: "test@example.test" }),
        }),
      Error,
      "private_key",
    );
    const invalidBaseUrlConfig = await config({ baseUrl: "file:///tmp/blobs" });
    assertThrows(
      () => new GCSBlobStorage(invalidBaseUrlConfig),
      Error,
      "must use HTTP or HTTPS",
    );
    const insecureBaseUrlConfig = await config({ baseUrl: "http://cdn.example.test/blobs" });
    assertThrows(
      () => new GCSBlobStorage(insecureBaseUrlConfig),
      Error,
      "must use HTTPS unless its host is localhost or a loopback IP",
    );
    new GCSBlobStorage(await config({ baseUrl: "http://localhost:3000/blobs" })).close();
    const credentialedBaseUrlConfig = await config({
      baseUrl: "https://user:secret@cdn.example.test/blobs",
    });
    assertThrows(
      () => new GCSBlobStorage(credentialedBaseUrlConfig),
      Error,
      "must not contain credentials",
    );
    const invalidBucketConfig = await config({ bucket: "Invalid_Bucket" });
    assertThrows(
      () => new GCSBlobStorage(invalidBucketConfig),
      Error,
      "valid Cloud Storage bucket name",
    );
    const invalidChunkSizeConfig = await config({ resumableChunkSize: 300_000 });
    assertThrows(
      () => new GCSBlobStorage(invalidChunkSizeConfig),
      Error,
      "256 KiB multiple",
    );
    const validDependenciesConfig = await config();
    assertThrows(
      () =>
        new GCSBlobStorage(validDependenciesConfig, {
          fetch: 1 as unknown as GCSFetch,
        }),
      Error,
      "dependencies.fetch must be a function",
    );
  });

  it("signs a valid RS256 assertion and sends encoded object identity", async () => {
    let assertion = "";
    let initiationUrl: URL | undefined;
    let initiationInit: RequestInit | undefined;
    let uploadUrl: URL | undefined;
    let uploadInit: RequestInit | undefined;
    const fetch = authenticatedFetch(
      (url, init) => {
        if (
          url.searchParams.get("uploadType") === "resumable" &&
          !url.searchParams.has("upload_id")
        ) {
          initiationUrl = url;
          initiationInit = init;
          const sessionUrl = new URL(url);
          sessionUrl.searchParams.set("upload_id", "session-id");
          return new Response(null, {
            status: 200,
            headers: { location: sessionUrl.href },
          });
        }
        uploadUrl = url;
        uploadInit = init;
        return objectResponse();
      },
      (init) => {
        assertEquals(init?.redirect, "error");
        const body = init?.body;
        assert(body instanceof URLSearchParams);
        assertion = body.get("assertion") ?? "";
        return tokenResponse();
      },
    );
    const storage = new GCSBlobStorage(
      await config({ prefix: "folder/", baseUrl: "https://cdn.example.test/blobs" }),
      { fetch, now: () => Date.parse("2026-01-02T03:00:00.000Z") },
    );

    const result = await storage.put("hello", {
      id: "abc_123",
      mimeType: "text/plain",
      metadata: { Trace: "abc" },
      ttl: 60,
    });

    const parts = assertion.split(".");
    assertEquals(parts.length, 3);
    const [encodedHeader, encodedClaims, encodedSignature] = parts;
    assert(encodedHeader && encodedClaims && encodedSignature);
    const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedHeader)));
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedClaims)));
    assertEquals(header, { alg: "RS256", typ: "JWT" });
    assertEquals(claims.iss, "blob-test@example-project.iam.gserviceaccount.com");
    assertEquals(claims.aud, "https://oauth2.googleapis.com/token");
    assertEquals(claims.exp - claims.iat, 3_600);
    assert(
      await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        (await getTestCredentials()).keyPair.publicKey,
        decodeBase64Url(encodedSignature).buffer as ArrayBuffer,
        new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`),
      ),
    );

    assertEquals(initiationUrl?.searchParams.get("name"), "folder/abc_123");
    assertEquals(initiationUrl?.searchParams.get("uploadType"), "resumable");
    const initiationHeaders = new Headers(initiationInit?.headers);
    assertEquals(initiationInit?.redirect, "error");
    assertEquals(initiationHeaders.get("authorization"), "Bearer access-token");
    assertEquals(initiationHeaders.get("x-upload-content-length"), "5");
    assertEquals(initiationHeaders.get("x-upload-content-type"), "text/plain");
    assert(initiationInit?.body instanceof Uint8Array);
    assertEquals(
      JSON.parse(new TextDecoder().decode(initiationInit.body)),
      {
        name: "folder/abc_123",
        contentType: "text/plain",
        metadata: {
          trace: "abc",
          expiresat: "2026-01-02T03:01:00.000Z",
        },
      },
    );
    assertEquals(uploadUrl?.searchParams.get("upload_id"), "session-id");
    const uploadHeaders = new Headers(uploadInit?.headers);
    assertEquals(uploadInit?.redirect, "error");
    assertEquals(uploadHeaders.get("authorization"), null);
    assertEquals(uploadHeaders.get("content-length"), "5");
    assertEquals(
      result.url,
      "https://cdn.example.test/blobs/folder%2Fabc_123",
    );
    assertEquals(result.expiresAt?.toISOString(), "2026-01-02T03:01:00.000Z");
  });

  it("coalesces concurrent token requests and caches only validated tokens", async () => {
    let tokenCalls = 0;
    let releaseToken: (() => void) | undefined;
    const tokenGate = new Promise<void>((resolve) => {
      releaseToken = resolve;
    });
    const fetch = authenticatedFetch(
      (url) => missingObjectResponse(url),
      async () => {
        tokenCalls++;
        await tokenGate;
        return tokenResponse();
      },
    );
    const storage = new GCSBlobStorage(await config(), {
      fetch,
      now: () => 1_000_000,
    });
    const first = storage.exists("first");
    const second = storage.exists("second");
    await Promise.resolve();
    releaseToken?.();
    assertEquals(await Promise.all([first, second]), [false, false]);
    assertEquals(await storage.exists("third"), false);
    assertEquals(tokenCalls, 1);

    let retryTokenCalls = 0;
    const retryingStorage = new GCSBlobStorage(await config(), {
      fetch: authenticatedFetch(
        (url) => missingObjectResponse(url),
        () => {
          retryTokenCalls += 1;
          return retryTokenCalls === 1
            ? Response.json({ access_token: "invalid\ntoken", expires_in: 3_600 })
            : tokenResponse();
        },
      ),
    });
    await assertRejects(
      () => retryingStorage.exists("invalid-token"),
      Error,
      "invalid access_token",
    );
    assertEquals(await retryingStorage.exists("valid-token"), false);
    assertEquals(retryTokenCalls, 2);
  });

  it("forwards network and abort failures with exact identity", async () => {
    const networkFailure = new Error("network failed");
    const networkStorage = new GCSBlobStorage(await config(), {
      fetch: () => Promise.reject(networkFailure),
    });
    let caught: unknown;
    try {
      await networkStorage.exists("object");
    } catch (error) {
      caught = error;
    }
    assertStrictEquals(caught, networkFailure);

    const controller = new AbortController();
    const abortReason = new DOMException("caller stopped", "AbortError");
    controller.abort(abortReason);
    const abortedStorage = new GCSBlobStorage(await config({ signal: controller.signal }), {
      fetch: () => Promise.reject(new Error("fetch must not run")),
    });
    caught = undefined;
    try {
      await abortedStorage.exists("object");
    } catch (error) {
      caught = error;
    }
    assertStrictEquals(caught, abortReason);
  });

  it("aborts in-flight transport when storage closes", async () => {
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const storage = new GCSBlobStorage(await config(), {
      fetch: authenticatedFetch((_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          markStarted?.();
          if (signal?.aborted) reject(signal.reason);
          else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        })
      ),
    });
    const pending = storage.exists("object");
    await started;
    storage.close();
    await assertRejects(() => pending, DOMException, "GCS blob storage is closing");
    await assertRejects(() => storage.exists("object"), DOMException, "closed");
  });

  it("returns provider streams without buffering and preserves cancellation", async () => {
    const cancelReason = new Error("consumer stopped");
    let observedReason: unknown;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
      },
      cancel(reason) {
        observedReason = reason;
      },
    });
    const storage = new GCSBlobStorage(await config(), {
      fetch: authenticatedFetch(() => new Response(source)),
    });
    const stream = await storage.getStream("folder_object");
    assert(stream);
    await stream.cancel(cancelReason);
    assertStrictEquals(observedReason, cancelReason);
  });

  it("implements text, bytes, existence, and delete operations exactly", async () => {
    const storageRequests: Array<{ url: URL; method: string }> = [];
    const storage = new GCSBlobStorage(await config(), {
      fetch: authenticatedFetch((url, init) => {
        const method = init?.method ?? "GET";
        storageRequests.push({ url, method });
        if (method === "DELETE") return new Response(null, { status: 204 });
        if (url.searchParams.get("alt") === "media") {
          return new Response(new Uint8Array([104, 101, 108, 108, 111]));
        }
        assertEquals(url.searchParams.get("fields"), "id");
        return Response.json({ id: "example-bucket/object" });
      }),
    });

    assertEquals(await storage.getText("object"), "hello");
    assertEquals(
      await storage.getBytes("object"),
      new Uint8Array([104, 101, 108, 108, 111]),
    );
    assert(await storage.exists("object"));
    await storage.delete("object");
    assertEquals(storageRequests.map(({ method }) => method), ["GET", "GET", "GET", "DELETE"]);
  });

  it("streams unknown-length uploads through a trusted resumable session", async () => {
    const minimumChunkSize = 256 * 1024;
    const chunkSize = minimumChunkSize * 2;
    const sourceBytes = new Uint8Array(chunkSize + 3);
    for (let index = 0; index < sourceBytes.byteLength; index++) {
      sourceBytes[index] = index % 251;
    }
    const uploadBodies: Uint8Array[] = [];
    const uploadHeaders: Headers[] = [];
    const fetch = authenticatedFetch(async (url, init) => {
      assertEquals(init?.redirect, "error");
      if (!url.searchParams.has("upload_id")) {
        const sessionUrl = new URL(url);
        sessionUrl.searchParams.set("upload_id", "stream-session");
        return new Response(null, { headers: { location: sessionUrl.href } });
      }
      const headers = new Headers(init?.headers);
      const bytes = new Uint8Array(await new Response(init?.body).arrayBuffer());
      uploadHeaders.push(headers);
      uploadBodies.push(bytes);
      assertEquals(headers.get("authorization"), null);
      if (uploadBodies.length === 1) {
        return new Response(null, {
          status: 308,
          headers: { range: `bytes=0-${minimumChunkSize - 1}` },
        });
      }
      if (uploadBodies.length === 2) {
        return new Response(null, {
          status: 308,
          headers: { range: `bytes=0-${chunkSize - 1}` },
        });
      }
      return objectResponse({ size: String(sourceBytes.byteLength) });
    });
    const storage = new GCSBlobStorage(await config({ resumableChunkSize: chunkSize }), { fetch });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(sourceBytes.subarray(0, 17));
        controller.enqueue(sourceBytes.subarray(17));
        controller.close();
      },
    });

    const result = await storage.put(stream, { id: "stream" });
    assertEquals(uploadBodies.length, 3);
    const [firstHeaders, resumedHeaders, finalHeaders] = uploadHeaders;
    assert(firstHeaders && resumedHeaders && finalHeaders);
    assertEquals(uploadBodies[0], sourceBytes.subarray(0, chunkSize));
    assertEquals(uploadBodies[1], sourceBytes.subarray(minimumChunkSize, chunkSize));
    assertEquals(uploadBodies[2], sourceBytes.subarray(chunkSize));
    assertEquals(firstHeaders.get("content-range"), `bytes 0-${chunkSize - 1}/*`);
    assertEquals(
      resumedHeaders.get("content-range"),
      `bytes ${minimumChunkSize}-${chunkSize - 1}/*`,
    );
    assertEquals(
      finalHeaders.get("content-range"),
      `bytes ${chunkSize}-${sourceBytes.byteLength - 1}/${sourceBytes.byteLength}`,
    );
    assertEquals(firstHeaders.get("content-length"), String(chunkSize));
    assertEquals(finalHeaders.get("content-length"), "3");
    assertEquals(result.size, sourceBytes.byteLength);
  });

  it("fails closed before sending object bytes to an untrusted session URI", async () => {
    let storageRequests = 0;
    const storage = new GCSBlobStorage(await config(), {
      fetch: authenticatedFetch(() => {
        storageRequests++;
        return new Response(null, {
          headers: {
            location:
              "https://attacker.example/upload/storage/v1/b/example-bucket/o?uploadType=resumable&upload_id=secret",
          },
        });
      }),
    });
    await assertRejects(
      () => storage.put("hello", { id: "object" }),
      Error,
      "untrusted session URI",
    );
    assertEquals(storageRequests, 1);

    const wrongBucketStorage = new GCSBlobStorage(await config(), {
      fetch: authenticatedFetch(() =>
        new Response(null, {
          headers: {
            location:
              "https://storage.googleapis.com/upload/storage/v1/b/different-bucket/o?uploadType=resumable&upload_id=secret",
          },
        })
      ),
    });
    await assertRejects(
      () => wrongBucketStorage.put("hello", { id: "object" }),
      Error,
      "untrusted session URI",
    );
  });

  it("encodes configured prefixes as one object-name segment", async () => {
    const requested: URL[] = [];
    const storage = new GCSBlobStorage(await config({ prefix: "tenant/" }), {
      fetch: authenticatedFetch((url) => {
        requested.push(url);
        return missingObjectResponse(url);
      }),
    });
    assertEquals(await storage.getStream("object_1"), null);
    assertEquals(await storage.stat("object_1"), null);
    assertEquals(await storage.exists("object_1"), false);
    await storage.delete("object_1");
    assertEquals(
      requested.filter((url) => url.pathname.includes("/o/")).map((url) => url.pathname),
      Array(4).fill(
        "/storage/v1/b/example-bucket/o/tenant%2Fobject_1",
      ),
    );
    assertEquals(
      requested.filter((url) => url.pathname === "/storage/v1/b/example-bucket").length,
      4,
    );
  });

  it("does not reduce a missing bucket to a missing object", async () => {
    const storage = new GCSBlobStorage(await config(), {
      fetch: authenticatedFetch((url) =>
        url.pathname === "/storage/v1/b/example-bucket"
          ? new Response("bucket unavailable", { status: 404 })
          : new Response(null, { status: 404 })
      ),
    });
    await assertRejects(
      () => storage.exists("object"),
      Error,
      "existence check bucket verification failed with HTTP 404",
    );
  });

  it("rejects unsafe blob ids for every operation before transport", async () => {
    let requests = 0;
    const storage = new GCSBlobStorage(await config(), {
      fetch: () => {
        requests++;
        return Promise.reject(new Error("transport must not run"));
      },
    });
    const operations: Array<() => Promise<unknown>> = [
      () => storage.put("value", { id: "path/segment" }),
      () => storage.getStream("../escape"),
      () => storage.getText("contains space"),
      () => storage.getBytes("query?value"),
      () => storage.delete("."),
      () => storage.exists(""),
      () => storage.stat("fragment#value"),
    ];
    for (const operation of operations) {
      await assertRejects(
        operation,
        Error,
        "Blob IDs must contain at most 256 alphanumeric characters, hyphens, and underscores",
      );
    }
    assertEquals(requests, 0);
  });

  it("returns exact metadata and hides the provider-internal expiry key", async () => {
    const storage = new GCSBlobStorage(
      await config({ prefix: "folder/", baseUrl: "https://cdn.example.test/base/" }),
      {
        fetch: authenticatedFetch(() =>
          objectResponse({
            size: "12",
            contentType: "application/json",
            metadata: {
              Trace: "abc",
              expiresat: "2026-01-03T00:00:00.000Z",
            },
          })
        ),
      },
    );
    const result = await storage.stat("object");
    assert(result);
    assertEquals(result.size, 12);
    assertEquals(result.metadata, { trace: "abc" });
    assertEquals(result.expiresAt?.toISOString(), "2026-01-03T00:00:00.000Z");
    assertEquals(result.url, "https://cdn.example.test/base/folder%2Fobject");
  });

  it("fails closed on malformed success payloads and metadata collisions", async () => {
    const invalidPayload = new GCSBlobStorage(await config(), {
      fetch: authenticatedFetch(() => objectResponse({ size: "NaN" })),
    });
    await assertRejects(
      () => invalidPayload.stat("object"),
      Error,
      "invalid object size",
    );

    const providerMediaLink = new GCSBlobStorage(await config(), {
      fetch: authenticatedFetch(() =>
        objectResponse({ mediaLink: "https://attacker.example/download/object" })
      ),
    });
    assertEquals((await providerMediaLink.stat("object"))?.url, undefined);

    const collidingProviderMetadata = new GCSBlobStorage(await config(), {
      fetch: authenticatedFetch(() => objectResponse({ metadata: { Trace: "a", trace: "b" } })),
    });
    await assertRejects(
      () => collidingProviderMetadata.stat("object"),
      Error,
      "colliding metadata keys",
    );

    let requests = 0;
    const storage = new GCSBlobStorage(await config(), {
      fetch: authenticatedFetch(() => {
        requests += 1;
        return objectResponse();
      }),
    });
    await assertRejects(
      () => storage.put("hello", { metadata: { Trace: "a", trace: "b" } }),
      Error,
      "unique ignoring case",
    );
    await assertRejects(
      () => storage.put("hello", { metadata: { expiresAt: "caller-owned" } }),
      Error,
      "is reserved",
    );
    await assertRejects(
      () => storage.put("hello", { mimeType: "text/plain\ninvalid: true" }),
      Error,
      "header-safe",
    );
    await assertRejects(
      () =>
        storage.put("hello", {
          metadata: { a: "x".repeat(8 * 1024 - 1) },
          ttl: 1,
        }),
      Error,
      "metadata including expiry must not exceed 8192",
    );
    assertEquals(requests, 0);
  });

  it("reserves one metadata entry for TTL before transport", async () => {
    const documents: Array<Record<string, unknown>> = [];
    let storageRequests = 0;
    const storage = new GCSBlobStorage(await config(), {
      fetch: authenticatedFetch(async (url, init) => {
        storageRequests++;
        if (!url.searchParams.has("upload_id")) {
          const body = new Uint8Array(await new Response(init?.body).arrayBuffer());
          documents.push(JSON.parse(new TextDecoder().decode(body)));
          const sessionUrl = new URL(url);
          sessionUrl.searchParams.set("upload_id", `session-${documents.length}`);
          return new Response(null, { headers: { location: sessionUrl.href } });
        }
        return objectResponse();
      }),
    });
    const hundredEntries = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`key${index}`, "v"]),
    );
    const ninetyNineEntries = Object.fromEntries(
      Array.from({ length: 99 }, (_, index) => [`key${index}`, "v"]),
    );

    await storage.put("hello", { id: "hundred", metadata: hundredEntries });
    await storage.put("hello", { id: "ninety_nine", metadata: ninetyNineEntries, ttl: 60 });
    assertEquals(Object.keys(documents[0]?.metadata as object).length, 100);
    assertEquals(Object.keys(documents[1]?.metadata as object).length, 100);

    const requestsBeforeRejectedUpload = storageRequests;
    await assertRejects(
      () => storage.put("hello", { id: "overflow", metadata: hundredEntries, ttl: 60 }),
      Error,
      "metadata including expiry must contain at most 100 entries",
    );
    assertEquals(storageRequests, requestsBeforeRejectedUpload);
  });

  it("does not replace a provider HTTP failure with response parsing fallbacks", async () => {
    const storage = new GCSBlobStorage(await config(), {
      fetch: authenticatedFetch(() =>
        new Response("permission denied", {
          status: 403,
          statusText: "Forbidden",
        })
      ),
    });
    await assertRejects(
      () => storage.exists("object"),
      Error,
      "HTTP 403 (Forbidden: permission denied)",
    );
  });

  it("bounds and cancels provider response bodies", async () => {
    let errorBodyCancelled = false;
    const oversizedErrorBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4 * 1024 + 1).fill(97));
      },
      cancel() {
        errorBodyCancelled = true;
      },
    });
    const errorStorage = new GCSBlobStorage(await config(), {
      fetch: authenticatedFetch(() => new Response(oversizedErrorBody, { status: 500 })),
    });
    await assertRejects(() => errorStorage.exists("object"), Error, "HTTP 500");
    assert(errorBodyCancelled);

    let successBodyCancelled = false;
    const oversizedSuccessBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024 + 1).fill(123));
      },
      cancel() {
        successBodyCancelled = true;
      },
    });
    const successStorage = new GCSBlobStorage(await config(), {
      fetch: authenticatedFetch(() => new Response(oversizedSuccessBody)),
    });
    await assertRejects(
      () => successStorage.stat("object"),
      Error,
      "response body exceeded 1048576 bytes",
    );
    assert(successBodyCancelled);
  });

  it("registers only the framework BlobStorage contract", async () => {
    const extension = extBlobGCS(await config());
    let providedName: string | undefined;
    let provided: BlobStorage | undefined;
    extension.setup?.({
      get: () => undefined,
      require: () => {
        throw new Error("unexpected requirement");
      },
      provide: (name, value) => {
        providedName = name;
        provided = value as BlobStorage;
      },
      config: {},
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    assertEquals(extension.contracts?.provides, [BlobStorageContractName]);
    assertEquals(providedName, BlobStorageContractName);
    assert(provided !== undefined);
    assertThrows(
      () =>
        extension.setup?.({
          get: () => undefined,
          require: () => {
            throw new Error("unexpected requirement");
          },
          provide() {},
          config: {},
          logger: { debug() {}, info() {}, warn() {}, error() {} },
        }),
      Error,
      "already set up",
    );
    extension.teardown?.();
    await assertRejects(() => provided!.exists("object"), DOMException, "closed");
    extension.setup?.({
      get: () => undefined,
      require: () => {
        throw new Error("unexpected requirement");
      },
      provide() {},
      config: {},
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    extension.teardown?.();
  });

  it("sets up when AbortSignal.any is unavailable", async () => {
    const extension = extBlobGCS(await config());
    withoutAbortSignalAny(() => {
      extension.setup?.({
        get: () => undefined,
        require: () => {
          throw new Error("unexpected requirement");
        },
        provide() {},
        config: {},
        logger: { debug() {}, info() {}, warn() {}, error() {} },
      });
      extension.teardown?.();
    });
  });

  it("rolls setup back and forwards context revocation exactly", async () => {
    const failed = extBlobGCS(await config());
    assertThrows(
      () =>
        failed.setup?.({
          get: () => undefined,
          require: () => {
            throw new Error("unexpected requirement");
          },
          provide: () => {
            throw new Error("provide failed");
          },
          config: {},
          logger: { debug() {}, info() {}, warn() {}, error() {} },
        }),
      Error,
      "provide failed",
    );
    failed.setup?.({
      get: () => undefined,
      require: () => {
        throw new Error("unexpected requirement");
      },
      provide() {},
      config: {},
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    failed.teardown?.();

    const contextController = new AbortController();
    const extension = extBlobGCS(await config());
    let storage: BlobStorage | undefined;
    extension.setup?.({
      get: () => undefined,
      require: () => {
        throw new Error("unexpected requirement");
      },
      provide: (_name, value) => {
        storage = value as BlobStorage;
      },
      signal: contextController.signal,
      config: {},
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    const reason = new Error("context revoked");
    contextController.abort(reason);
    let caught: unknown;
    try {
      await storage!.exists("object");
    } catch (error) {
      caught = error;
    }
    assertStrictEquals(caught, reason);
    extension.teardown?.();
  });
});
