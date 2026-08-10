import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { assert, assertEquals, assertRejects, assertStrictEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { type BlobStorage, BlobStorageContractName } from "veryfront/workflow/blob";
import extBlobS3 from "./index.ts";
import {
  S3BlobStorage,
  type S3BlobStorageClient,
  type S3BlobStorageCommand,
  type S3BlobStorageConfig,
  type S3BlobStorageSendOptions,
} from "./s3-storage.ts";
import type {
  S3BlobStorageStreamUploader,
  S3BlobStorageStreamUploadInput,
} from "./multipart-upload.ts";

type CommandHandler = (
  command: S3BlobStorageCommand,
  options?: S3BlobStorageSendOptions,
) => unknown | Promise<unknown>;

class StubClient implements S3BlobStorageClient {
  readonly commands: S3BlobStorageCommand[] = [];
  readonly options: (S3BlobStorageSendOptions | undefined)[] = [];
  destroyed = false;

  constructor(private readonly handler: CommandHandler = () => ({})) {}

  async send(
    command: S3BlobStorageCommand,
    options?: S3BlobStorageSendOptions,
  ): Promise<unknown> {
    this.commands.push(command);
    this.options.push(options);
    return await this.handler(command, options);
  }

  destroy(): void {
    this.destroyed = true;
  }
}

class StubStreamUploader implements S3BlobStorageStreamUploader {
  readonly inputs: S3BlobStorageStreamUploadInput[] = [];

  constructor(
    private readonly handler: (input: S3BlobStorageStreamUploadInput) => Promise<number>,
  ) {}

  async upload(input: S3BlobStorageStreamUploadInput): Promise<number> {
    this.inputs.push(input);
    return await this.handler(input);
  }
}

function config(overrides: Partial<S3BlobStorageConfig> = {}): S3BlobStorageConfig {
  return {
    region: "eu-north-1",
    bucket: "example-bucket",
    accessKeyId: "access-key",
    secretAccessKey: "secret-key",
    ...overrides,
  };
}

function notFound(name = "NotFound"): Error & { $metadata: { httpStatusCode: number } } {
  return Object.assign(new Error("missing"), {
    name,
    $metadata: { httpStatusCode: 404 },
  });
}

async function consumeUploadBody(value: ReadableStream): Promise<number> {
  let size = 0;
  const reader = value.getReader();
  while (true) {
    const result = await reader.read();
    if (result.done) return size;
    assert(result.value instanceof Uint8Array);
    size += result.value.byteLength;
  }
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

describe("S3BlobStorage", () => {
  it("validates required configuration synchronously", () => {
    assertThrows(
      () => new S3BlobStorage(config({ bucket: "" })),
      Error,
      "bucket must be a non-empty string",
    );
    assertThrows(
      () => new S3BlobStorage(config({ endpoint: "file:///tmp/s3" })),
      Error,
      "endpoint must use HTTP or HTTPS",
    );
    assertThrows(
      () => new S3BlobStorage(config({ endpoint: "http://storage.example.test" })),
      Error,
      "endpoint must use HTTPS unless its host is localhost or a loopback IP",
    );
    new S3BlobStorage(config({ endpoint: "http://127.0.0.1:4566" }), {
      client: new StubClient(),
    }).close();
    assertThrows(
      () => new S3BlobStorage(config({ defaultTtl: Number.POSITIVE_INFINITY })),
      Error,
      "defaultTtl must be a finite non-negative number",
    );
    assertThrows(
      () => new S3BlobStorage(config({ sessionToken: 123 as unknown as string })),
      Error,
      "sessionToken must be a non-empty string",
    );
    assertThrows(
      () => new S3BlobStorage(config({ baseUrl: "https://user:secret@cdn.example.test" })),
      Error,
      "must not contain credentials",
    );
    assertThrows(
      () => new S3BlobStorage(config({ multipartPartSize: 1024 })),
      Error,
      "multipartPartSize",
    );
    assertThrows(
      () => new S3BlobStorage(config({ multipartQueueSize: 0 })),
      Error,
      "multipartQueueSize",
    );
    assertThrows(
      () => new S3BlobStorage(config(), { client: {} as S3BlobStorageClient }),
      Error,
      "dependencies.client must implement send",
    );
    assertThrows(
      () =>
        new S3BlobStorage(config(), {
          client: new StubClient(),
          streamUploader: {} as S3BlobStorageStreamUploader,
        }),
      Error,
      "dependencies.streamUploader must implement upload",
    );
  });

  it("uploads bytes once and returns an exact detached snapshot", async () => {
    const client = new StubClient();
    const storage = new S3BlobStorage(
      config({ prefix: "tenant/", baseUrl: "https://cdn.example.test/blobs" }),
      { client },
    );
    const metadata = { Trace: "abc" };
    const result = await storage.put("hello", {
      id: "abc_123",
      mimeType: "text/plain",
      metadata,
      ttl: 30,
    });

    assertEquals(client.commands.length, 1);
    const command = client.commands[0];
    assert(command instanceof PutObjectCommand);
    assertEquals(command.input.Bucket, "example-bucket");
    assertEquals(command.input.Key, "tenant/abc_123");
    assertEquals(command.input.ContentLength, 5);
    assertEquals(command.input.ContentType, "text/plain");
    assertEquals(command.input.Metadata, { trace: "abc" });
    assert(command.input.Expires instanceof Date);
    assertEquals(result.size, 5);
    assertEquals(result.metadata, { trace: "abc" });
    assertEquals(
      result.url,
      "https://cdn.example.test/blobs/tenant%2Fabc_123",
    );

    metadata.Trace = "mutated";
    assertEquals(result.metadata, { trace: "abc" });
  });

  it("rejects unsafe blob ids for every operation before transport", async () => {
    const client = new StubClient();
    const storage = new S3BlobStorage(config(), { client });
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
    assertEquals(client.commands.length, 0);
  });

  it("counts the exact bytes consumed from a streaming upload", async () => {
    let consumed = -1;
    const client = new StubClient();
    const streamUploader = new StubStreamUploader(async (input) => {
      consumed = await consumeUploadBody(input.stream);
      return consumed;
    });
    const storage = new S3BlobStorage(config(), { client, streamUploader });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4, 5]));
        controller.close();
      },
    });

    const result = await storage.put(stream, { id: "stream" });
    assertEquals(consumed, 5);
    assertEquals(result.size, 5);
    assertEquals(client.commands.length, 0);
    assertEquals(streamUploader.inputs[0]?.partSize, 8 * 1024 * 1024);
    assertEquals(streamUploader.inputs[0]?.queueSize, 2);
  });

  it("rejects non-byte stream chunks instead of reporting a false size", async () => {
    const client = new StubClient();
    const streamUploader = new StubStreamUploader(async (input) => {
      const result = await input.stream.getReader().read();
      if (!result.done && !(result.value instanceof Uint8Array)) {
        throw new Error("ReadableStream chunks must be Uint8Array values");
      }
      return result.done ? 0 : result.value.byteLength;
    });
    const storage = new S3BlobStorage(config(), { client, streamUploader });
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue("not bytes");
        controller.close();
      },
    });
    await assertRejects(
      () => storage.put(stream, { id: "invalid-stream" }),
      Error,
      "ReadableStream chunks must be Uint8Array",
    );
  });

  it("rejects ambiguous metadata and unsafe content types before transport", async () => {
    const client = new StubClient();
    const storage = new S3BlobStorage(config({ autoCreateBucket: true }), { client });
    await assertRejects(
      () => storage.put("value", { metadata: { Trace: "a", trace: "b" } }),
      Error,
      "unique ignoring case",
    );
    await assertRejects(
      () => storage.put("value", { mimeType: "text/plain\r\nx-injected: true" }),
      Error,
      "header-safe",
    );
    assertEquals(client.commands.length, 0);
    await storage.put("value", { metadata: { a: "x".repeat(2_047) } });
    await assertRejects(
      () => storage.put("value", { metadata: { a: "x".repeat(2_048) } }),
      Error,
      "must not exceed 2048",
    );
    assertEquals(client.commands.length, 2);
    assert(client.commands[0] instanceof HeadBucketCommand);
    assert(client.commands[1] instanceof PutObjectCommand);
  });

  it("initializes a missing regional bucket before consuming an upload", async () => {
    const client = new StubClient((command) => {
      if (command instanceof HeadBucketCommand) throw notFound("NoSuchBucket");
      return {};
    });
    const storage = new S3BlobStorage(config({ autoCreateBucket: true }), { client });

    await storage.put(new Uint8Array([1]), { id: "first" });
    await storage.put(new Uint8Array([2]), { id: "second" });

    assert(client.commands[0] instanceof HeadBucketCommand);
    const create = client.commands[1];
    assert(create instanceof CreateBucketCommand);
    assertEquals(
      create.input.CreateBucketConfiguration?.LocationConstraint,
      "eu-north-1",
    );
    assert(client.commands[2] instanceof PutObjectCommand);
    assert(client.commands[3] instanceof PutObjectCommand);
  });

  it("coalesces concurrent bucket initialization", async () => {
    let releaseBucketCheck: (() => void) | undefined;
    const bucketCheck = new Promise<void>((resolve) => {
      releaseBucketCheck = resolve;
    });
    let bucketChecks = 0;
    const client = new StubClient(async (command) => {
      if (command instanceof HeadBucketCommand) {
        bucketChecks++;
        await bucketCheck;
      }
      return {};
    });
    const storage = new S3BlobStorage(config({ autoCreateBucket: true }), { client });

    const first = storage.put(new Uint8Array([1]), { id: "first" });
    const second = storage.put(new Uint8Array([2]), { id: "second" });
    await Promise.resolve();
    assertEquals(bucketChecks, 1);

    releaseBucketCheck?.();
    await Promise.all([first, second]);
    assertEquals(bucketChecks, 1);
    assertEquals(
      client.commands.filter((command) => command instanceof PutObjectCommand).length,
      2,
    );
  });

  it("allows bucket initialization to retry after a provider failure", async () => {
    const providerFailure = new Error("bucket check failed");
    let bucketChecks = 0;
    const client = new StubClient((command) => {
      if (command instanceof HeadBucketCommand) {
        bucketChecks++;
        if (bucketChecks === 1) throw providerFailure;
      }
      return {};
    });
    const storage = new S3BlobStorage(config({ autoCreateBucket: true }), { client });

    let caught: unknown;
    try {
      await storage.put(new Uint8Array([1]), { id: "first" });
    } catch (error) {
      caught = error;
    }
    assertStrictEquals(caught, providerFailure);

    await storage.put(new Uint8Array([2]), { id: "second" });
    assertEquals(bucketChecks, 2);
  });

  it("does not perform bucket discovery unless auto-create is selected", async () => {
    const client = new StubClient();
    const storage = new S3BlobStorage(config(), { client });
    await storage.put(new Uint8Array(), { id: "empty" });
    assertEquals(client.commands.length, 1);
    assert(client.commands[0] instanceof PutObjectCommand);
  });

  it("forwards provider errors and abort signals without replacing their identity", async () => {
    const providerError = new Error("provider unavailable");
    const controller = new AbortController();
    const client = new StubClient((_command, options) => {
      assert(options?.abortSignal instanceof AbortSignal);
      assert(options.abortSignal !== controller.signal);
      throw providerError;
    });
    const storage = new S3BlobStorage(config({ signal: controller.signal }), { client });

    let caught: unknown;
    try {
      await storage.exists("object");
    } catch (error) {
      caught = error;
    }
    assertStrictEquals(caught, providerError);

    let abortedCalls = 0;
    const abortedClient = new StubClient(() => {
      abortedCalls++;
      throw new Error("transport must not run");
    });
    const abortedController = new AbortController();
    const abortReason = new Error("configuration revoked");
    abortedController.abort(abortReason);
    const abortedStorage = new S3BlobStorage(
      config({ signal: abortedController.signal }),
      { client: abortedClient },
    );
    caught = undefined;
    try {
      await abortedStorage.exists("object");
    } catch (error) {
      caught = error;
    }
    assertStrictEquals(caught, abortReason);
    assertEquals(abortedCalls, 0);
  });

  it("aborts in-flight transport when storage closes", async () => {
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const client = new StubClient((_command, options) =>
      new Promise((_resolve, reject) => {
        const signal = options?.abortSignal;
        markStarted?.();
        if (signal?.aborted) reject(signal.reason);
        else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      })
    );
    const storage = new S3BlobStorage(config(), { client });
    const pending = storage.exists("object");
    await started;
    storage.close();
    await assertRejects(() => pending, DOMException, "S3 blob storage is closing");
    await assertRejects(() => storage.exists("object"), Error, "closed");
  });

  it("normalizes SDK download bodies to web streams and preserves the stream", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("payload"));
        controller.close();
      },
    });
    const client = new StubClient((command) => {
      assert(command instanceof GetObjectCommand);
      return { Body: { transformToWebStream: () => stream } };
    });
    const storage = new S3BlobStorage(config(), { client });
    assertEquals(await storage.getText("object"), "payload");
  });

  it("implements read, metadata, existence, and delete operations exactly", async () => {
    const lastModified = new Date("2026-01-02T03:04:05.000Z");
    const expiry = new Date("2026-01-03T03:04:05.000Z");
    const client = new StubClient((command) => {
      if (command instanceof GetObjectCommand) {
        return {
          Body: {
            transformToWebStream: () =>
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(new Uint8Array([1, 2, 3]));
                  controller.close();
                },
              }),
          },
        };
      }
      if (command instanceof HeadObjectCommand) {
        return {
          LastModified: lastModified,
          ContentLength: 3,
          ContentType: "application/octet-stream",
          Expires: expiry,
          Metadata: { Trace: "abc" },
        };
      }
      assert(command instanceof DeleteObjectCommand);
      return {};
    });
    const storage = new S3BlobStorage(
      config({ prefix: "tenant/", baseUrl: "https://cdn.example.test/blobs" }),
      { client },
    );

    assertEquals(await storage.getBytes("object"), new Uint8Array([1, 2, 3]));
    assert(await storage.exists("object"));
    const metadata = await storage.stat("object");
    assert(metadata);
    assertEquals(metadata, {
      __kind: "blob",
      id: "object",
      size: 3,
      mimeType: "application/octet-stream",
      createdAt: lastModified,
      expiresAt: expiry,
      metadata: { trace: "abc" },
      url: "https://cdn.example.test/blobs/tenant%2Fobject",
    });
    await storage.delete("object");
    assert(client.commands[0] instanceof GetObjectCommand);
    assert(client.commands[1] instanceof HeadObjectCommand);
    assert(client.commands[2] instanceof HeadObjectCommand);
    assert(client.commands[3] instanceof DeleteObjectCommand);
  });

  it("fails closed on malformed provider success values", async () => {
    const invalidBodyClient = new StubClient((command) => {
      assert(command instanceof GetObjectCommand);
      return { Body: { transformToWebStream: () => ({}) } };
    });
    await assertRejects(
      () => new S3BlobStorage(config(), { client: invalidBodyClient }).getStream("object"),
      Error,
      "invalid download stream",
    );

    const invalidMetadataClient = new StubClient((command) => {
      assert(command instanceof HeadObjectCommand);
      return {
        LastModified: new Date("2026-01-02T03:04:05.000Z"),
        ContentLength: 1,
        ContentType: "text/plain",
        Metadata: { Trace: "a", trace: "b" },
      };
    });
    await assertRejects(
      () => new S3BlobStorage(config(), { client: invalidMetadataClient }).stat("object"),
      Error,
      "colliding metadata keys",
    );
  });

  it("maps only object absence and never hides a missing bucket", async () => {
    const forbidden = new Error("forbidden");
    const explicitObjectMissing = new StubClient((command) => {
      assert(command instanceof GetObjectCommand);
      throw notFound("NoSuchKey");
    });
    assertEquals(
      await new S3BlobStorage(config(), { client: explicitObjectMissing }).getStream("missing"),
      null,
    );
    assertEquals(explicitObjectMissing.commands.length, 1);

    const ambiguousObjectMissing = new StubClient((command) => {
      if (command instanceof HeadObjectCommand) throw notFound();
      assert(command instanceof HeadBucketCommand);
      return {};
    });
    assertEquals(
      await new S3BlobStorage(config(), { client: ambiguousObjectMissing }).stat("missing"),
      null,
    );
    assert(ambiguousObjectMissing.commands[0] instanceof HeadObjectCommand);
    assert(ambiguousObjectMissing.commands[1] instanceof HeadBucketCommand);

    const bucketMissing = notFound("NoSuchBucket");
    const missingBucketClient = new StubClient((command) => {
      if (command instanceof HeadObjectCommand) throw notFound();
      assert(command instanceof HeadBucketCommand);
      throw bucketMissing;
    });
    let caught: unknown;
    try {
      await new S3BlobStorage(config(), { client: missingBucketClient }).exists("missing");
    } catch (error) {
      caught = error;
    }
    assertStrictEquals(caught, bucketMissing);

    const forbiddenClient = new StubClient(() => {
      throw forbidden;
    });
    caught = undefined;
    try {
      await new S3BlobStorage(config(), { client: forbiddenClient }).exists("forbidden");
    } catch (error) {
      caught = error;
    }
    assertStrictEquals(caught, forbidden);
  });

  it("uses idempotent S3 deletion and closes its client exactly once", async () => {
    const client = new StubClient();
    const storage = new S3BlobStorage(config(), { client });
    await storage.delete("object");
    assert(client.commands[0] instanceof DeleteObjectCommand);
    storage.close();
    storage.close();
    assert(client.destroyed);
    await assertRejects(() => storage.exists("object"), Error, "closed");
  });

  it("registers only the framework BlobStorage contract", async () => {
    const extension = extBlobS3(config());
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
    await assertRejects(() => provided!.exists("object"), Error, "closed");
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

  it("sets up when AbortSignal.any is unavailable", () => {
    const extension = extBlobS3(config());
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
    const failed = extBlobS3(config());
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
    const extension = extBlobS3(config());
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
