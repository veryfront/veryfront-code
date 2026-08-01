import { S3Client } from "@aws-sdk/client-s3";
import { assert, assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { createS3BlobStorageStreamUploader, MIN_MULTIPART_PART_SIZE } from "./multipart-upload.ts";

interface CapturedRequest {
  readonly method: string;
  readonly query?: Readonly<Record<string, string | undefined>>;
  readonly headers: Readonly<Record<string, string>>;
}

interface HandlerResponse {
  readonly response: {
    readonly statusCode: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: Uint8Array;
  };
}

class S3ProtocolHandler {
  readonly requests: CapturedRequest[] = [];
  failure: unknown;

  async handle(request: CapturedRequest): Promise<HandlerResponse> {
    this.requests.push(request);
    if (this.failure !== undefined) throw this.failure;

    if (request.method === "POST" && Object.hasOwn(request.query ?? {}, "uploads")) {
      return xmlResponse(
        "<InitiateMultipartUploadResult><Bucket>bucket</Bucket><Key>object</Key><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>",
      );
    }
    if (request.method === "PUT" && request.query?.partNumber !== undefined) {
      return {
        response: {
          statusCode: 200,
          headers: { etag: `\"part-${request.query.partNumber}\"` },
        },
      };
    }
    if (request.method === "POST" && request.query?.uploadId === "upload-1") {
      return xmlResponse(
        '<CompleteMultipartUploadResult><Location>https://bucket.s3.test/object</Location><Bucket>bucket</Bucket><Key>object</Key><ETag>"complete"</ETag></CompleteMultipartUploadResult>',
      );
    }
    if (request.method === "PUT") {
      return { response: { statusCode: 200, headers: { etag: '"single"' } } };
    }
    return { response: { statusCode: 500, headers: {} } };
  }
}

function xmlResponse(xml: string): HandlerResponse {
  return {
    response: {
      statusCode: 200,
      headers: { "content-type": "application/xml" },
      body: new TextEncoder().encode(xml),
    },
  };
}

function createClient(handler: S3ProtocolHandler): S3Client {
  return new S3Client({
    authSchemePreference: [],
    defaultsMode: "standard",
    defaultUserAgentProvider: async () => [
      ["aws-sdk-js"],
      ["lang/js"],
      ["app/veryfront-ext-blob-s3-test", "0.1.0"],
    ],
    disableClockSkewCorrection: false,
    disableS3ExpressSessionAuth: false,
    region: "eu-north-1",
    credentials: { accessKeyId: "access-key", secretAccessKey: "secret-key" },
    endpoint: "https://s3.test",
    forcePathStyle: true,
    maxAttempts: 1,
    requestChecksumCalculation: "WHEN_SUPPORTED",
    responseChecksumValidation: "WHEN_SUPPORTED",
    retryMode: "standard",
    sigv4aSigningRegionSet: ["eu-north-1"],
    useArnRegion: false,
    useDualstackEndpoint: false,
    useFipsEndpoint: false,
    userAgentAppId: "veryfront-ext-blob-s3-test",
    requestHandler: handler as never,
  });
}

function uploadInput(
  stream: ReadableStream,
  signal?: AbortSignal,
): Parameters<ReturnType<typeof createS3BlobStorageStreamUploader>["upload"]>[0] {
  return {
    bucket: "bucket",
    key: "object",
    stream,
    mimeType: "application/octet-stream",
    partSize: MIN_MULTIPART_PART_SIZE,
    queueSize: 1,
    signal,
  };
}

describe("S3 multipart stream adapter", () => {
  it("uses the official uploader for small and multipart unknown-length streams", async () => {
    const handler = new S3ProtocolHandler();
    const client = createClient(handler);
    const uploader = createS3BlobStorageStreamUploader(client);
    try {
      const small = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3]));
          controller.close();
        },
      });
      assertEquals(await uploader.upload(uploadInput(small)), 3);

      const largeSize = MIN_MULTIPART_PART_SIZE + 1;
      const large = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(2 * 1024 * 1024));
          controller.enqueue(new Uint8Array(largeSize - 2 * 1024 * 1024));
          controller.close();
        },
      });
      assertEquals(await uploader.upload(uploadInput(large)), largeSize);

      assertEquals(handler.requests.filter((request) => request.method === "PUT").length, 3);
      assert(
        handler.requests.some((request) => Object.hasOwn(request.query ?? {}, "uploads")),
      );
      assert(
        handler.requests.some((request) => request.query?.partNumber === "1"),
      );
      assert(
        handler.requests.some((request) => request.query?.partNumber === "2"),
      );
      assert(
        handler.requests.some((request) => request.query?.uploadId === "upload-1"),
      );
    } finally {
      client.destroy();
    }
  });

  it("cancels the Web source with the exact provider failure", async () => {
    const providerError = new Error("multipart provider failed");
    const handler = new S3ProtocolHandler();
    handler.failure = providerError;
    const client = createClient(handler);
    const uploader = createS3BlobStorageStreamUploader(client);
    let cancellationReason: unknown;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MIN_MULTIPART_PART_SIZE + 1));
      },
      cancel(reason) {
        cancellationReason = reason;
      },
    });
    try {
      let caught: unknown;
      try {
        await uploader.upload(uploadInput(stream));
      } catch (error) {
        caught = error;
      }
      assertStrictEquals(caught, providerError);
      assertStrictEquals(cancellationReason, providerError);
    } finally {
      client.destroy();
    }
  });

  it("cancels an idle source and rejects with the exact abort reason", async () => {
    const handler = new S3ProtocolHandler();
    const client = createClient(handler);
    const uploader = createS3BlobStorageStreamUploader(client);
    const controller = new AbortController();
    const abortReason = new Error("stop upload");
    let cancellationReason: unknown;
    const stream = new ReadableStream<Uint8Array>({
      cancel(reason) {
        cancellationReason = reason;
      },
    });
    try {
      const pending = uploader.upload(uploadInput(stream, controller.signal));
      controller.abort(abortReason);
      let caught: unknown;
      try {
        await pending;
      } catch (error) {
        caught = error;
      }
      assertStrictEquals(caught, abortReason);
      assertStrictEquals(cancellationReason, abortReason);
      assertEquals(handler.requests.length, 0);
    } finally {
      client.destroy();
    }
  });

  it("rejects non-byte stream chunks before provider transport", async () => {
    const handler = new S3ProtocolHandler();
    const client = createClient(handler);
    const uploader = createS3BlobStorageStreamUploader(client);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue("not bytes");
        controller.close();
      },
    });
    try {
      await assertRejects(
        () => uploader.upload(uploadInput(stream)),
        Error,
        "ReadableStream chunks must be Uint8Array",
      );
      assertEquals(handler.requests.length, 0);
    } finally {
      client.destroy();
    }
  });
});
