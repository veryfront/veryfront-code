import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  captureBlobBytes,
  captureStoreBlobOptions,
  MAX_BLOB_BUFFER_BYTES,
  MAX_BLOB_METADATA_ENTRIES,
  MAX_BLOB_METADATA_KEY_CODE_UNITS,
  MAX_BLOB_METADATA_TOTAL_CODE_UNITS,
  MAX_BLOB_METADATA_VALUE_CODE_UNITS,
  MAX_BLOB_MIME_TYPE_CODE_UNITS,
} from "./contract.ts";

describe("blob input contract", () => {
  it("rejects Proxy and accessor-backed options without invoking caller hooks", () => {
    let proxyHooks = 0;
    const optionsProxy = new Proxy({}, {
      get() {
        proxyHooks++;
        throw new Error("must not run");
      },
      getOwnPropertyDescriptor() {
        proxyHooks++;
        throw new Error("must not run");
      },
      getPrototypeOf() {
        proxyHooks++;
        throw new Error("must not run");
      },
      ownKeys() {
        proxyHooks++;
        throw new Error("must not run");
      },
    });
    assertThrows(
      () => captureStoreBlobOptions(optionsProxy),
      Error,
      "non-Proxy plain record",
    );
    assertEquals(proxyHooks, 0);

    let accessorHooks = 0;
    const accessorOptions = Object.create(null);
    Object.defineProperty(accessorOptions, "id", {
      enumerable: true,
      get() {
        accessorHooks++;
        return "unsafe";
      },
    });
    assertThrows(
      () => captureStoreBlobOptions(accessorOptions),
      Error,
      "enumerable own data property",
    );
    assertEquals(accessorHooks, 0);
  });

  it("rejects hostile metadata without invoking hooks", () => {
    let hooks = 0;
    const metadata = Object.create(null);
    Object.defineProperty(metadata, "filename", {
      enumerable: true,
      get() {
        hooks++;
        return "secret.txt";
      },
    });
    assertThrows(
      () => captureStoreBlobOptions({ metadata }),
      Error,
      "enumerable own data property",
    );
    assertEquals(hooks, 0);

    const metadataProxy = new Proxy({}, {
      ownKeys() {
        hooks++;
        throw new Error("must not run");
      },
    });
    assertThrows(
      () => captureStoreBlobOptions({ metadata: metadataProxy }),
      Error,
      "non-Proxy plain record",
    );
    assertEquals(hooks, 0);
  });

  it("enforces MIME and metadata ceilings", () => {
    assertThrows(
      () => captureStoreBlobOptions({ mimeType: "x".repeat(MAX_BLOB_MIME_TYPE_CODE_UNITS + 1) }),
      Error,
      "at most",
    );
    assertThrows(
      () => captureStoreBlobOptions({ mimeType: "text/plain\r\nX-Unsafe: yes" }),
      Error,
      "control characters",
    );
    assertThrows(
      () =>
        captureStoreBlobOptions({
          metadata: Object.fromEntries(
            Array.from({ length: MAX_BLOB_METADATA_ENTRIES + 1 }, (_, index) => [
              `key-${index}`,
              "value",
            ]),
          ),
        }),
      Error,
      "more than",
    );
    assertThrows(
      () =>
        captureStoreBlobOptions({
          metadata: { ["k".repeat(MAX_BLOB_METADATA_KEY_CODE_UNITS + 1)]: "value" },
        }),
      Error,
      "metadata keys",
    );
    assertThrows(
      () =>
        captureStoreBlobOptions({
          metadata: { key: "v".repeat(MAX_BLOB_METADATA_VALUE_CODE_UNITS + 1) },
        }),
      Error,
      "metadata values",
    );
    assertThrows(
      () =>
        captureStoreBlobOptions({
          metadata: Object.fromEntries(
            Array.from({ length: 5 }, (_, index) => [
              `key-${index}`,
              "v".repeat(Math.floor(MAX_BLOB_METADATA_TOTAL_CODE_UNITS / 5)),
            ]),
          ),
        }),
      Error,
      "total code units",
    );
  });

  it("detaches byte inputs and ignores overridden Blob methods", async () => {
    const input = new Uint8Array([1, 2, 3]);
    const captured = await captureBlobBytes(input);
    input[0] = 9;
    assertEquals([...captured], [1, 2, 3]);

    let hooks = 0;
    const blob = new Blob(["safe"]);
    Object.defineProperty(blob, "arrayBuffer", {
      get() {
        hooks++;
        throw new Error("must not run");
      },
    });
    assertEquals(new TextDecoder().decode(await captureBlobBytes(blob)), "safe");
    assertEquals(hooks, 0);
  });

  it("rejects Proxy payloads without invoking traps", async () => {
    let hooks = 0;
    const payload = new Proxy(new Blob(["unsafe"]), {
      get() {
        hooks++;
        throw new Error("must not run");
      },
      getPrototypeOf() {
        hooks++;
        throw new Error("must not run");
      },
    });
    await assertRejects(
      () => captureBlobBytes(payload),
      Error,
      "non-Proxy",
    );
    assertEquals(hooks, 0);
  });

  it("applies one bounded-buffer contract to strings, blobs, and streams", async () => {
    const testLimit = 8;
    assertEquals(MAX_BLOB_BUFFER_BYTES >= testLimit, true);
    await assertRejects(
      () => captureBlobBytes("123456789", testLimit),
      Error,
      "cannot exceed 8 buffered bytes",
    );
    await assertRejects(
      () => captureBlobBytes(new Blob(["123456789"]), testLimit),
      Error,
      "cannot exceed 8 buffered bytes",
    );

    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4, 5]));
        controller.enqueue(new Uint8Array([6, 7, 8, 9]));
      },
      cancel() {
        canceled = true;
      },
    });
    await assertRejects(
      () => captureBlobBytes(stream, testLimit),
      Error,
      "cannot exceed 8 buffered bytes",
    );
    assertEquals(canceled, true);
  });
});
