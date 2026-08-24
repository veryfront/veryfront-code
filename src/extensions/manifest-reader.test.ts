import "#veryfront/schemas/_test-setup.ts";

import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertStringIncludes,
  fail,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { join } from "#veryfront/compat/path";
import {
  type ExtensionManifestFileHandle,
  type ExtensionManifestFileInfo,
  type ExtensionManifestFileSystem,
  MAX_EXTENSION_MANIFEST_BYTES,
  parseExtensionManifest,
  readExtensionManifest,
} from "./manifest-reader.ts";

const encoder = new TextEncoder();

const FILE_ID = { dev: 11, ino: 29 } as const;

interface FakeFileSystemOptions {
  readonly data?: Uint8Array;
  readonly pathInfos?: Array<ExtensionManifestFileInfo | Error>;
  readonly handleInfo?: ExtensionManifestFileInfo;
  readonly statError?: Error;
  readonly readError?: Error;
  readonly closeError?: Error;
  readonly chunkSize?: number;
  readonly invalidReadLength?: number;
  readonly initialError?: Error;
  readonly missingError?: Error;
  readonly onLstat?: (call: number) => void;
}

interface FakeFileSystemState {
  openCalls: number;
  lstatCalls: number;
  readCalls: number;
  closeCalls: number;
}

function fileInfo(
  size: number | bigint,
  identity: { dev: number | bigint | null; ino: number | bigint | null } = FILE_ID,
  overrides: Partial<ExtensionManifestFileInfo> = {},
): ExtensionManifestFileInfo {
  return {
    isFile: true,
    isSymlink: false,
    size,
    ...identity,
    ...overrides,
  };
}

function createFakeFileSystem(
  options: FakeFileSystemOptions = {},
): { fileSystem: ExtensionManifestFileSystem; state: FakeFileSystemState } {
  const data = options.data ?? encoder.encode("{}");
  const defaultInfo = fileInfo(data.length);
  const pathInfos = options.pathInfos ?? [defaultInfo, defaultInfo, defaultInfo];
  const handleInfo = options.handleInfo ?? defaultInfo;
  const state: FakeFileSystemState = {
    openCalls: 0,
    lstatCalls: 0,
    readCalls: 0,
    closeCalls: 0,
  };
  let offset = 0;

  const handle: ExtensionManifestFileHandle = {
    async read(buffer): Promise<number | null> {
      state.readCalls++;
      if (options.readError) throw options.readError;
      if (options.invalidReadLength !== undefined) return options.invalidReadLength;
      if (offset >= data.length) return null;
      const chunkSize = Math.min(
        buffer.length,
        options.chunkSize ?? buffer.length,
        data.length - offset,
      );
      for (let index = 0; index < chunkSize; index++) {
        buffer[index] = data[offset + index] as number;
      }
      offset += chunkSize;
      return chunkSize;
    },
    async stat(): Promise<ExtensionManifestFileInfo> {
      if (options.statError) throw options.statError;
      return handleInfo;
    },
    async close(): Promise<void> {
      state.closeCalls++;
      if (options.closeError) throw options.closeError;
    },
  };

  const fileSystem: ExtensionManifestFileSystem = {
    async lstat(): Promise<ExtensionManifestFileInfo> {
      const call = state.lstatCalls++;
      options.onLstat?.(call);
      if (call === 0 && options.initialError) throw options.initialError;
      const selected = pathInfos[Math.min(call, pathInfos.length - 1)] ?? defaultInfo;
      if (selected instanceof Error) throw selected;
      return selected;
    },
    async open(): Promise<ExtensionManifestFileHandle> {
      state.openCalls++;
      return handle;
    },
    isNotFound(error): boolean {
      return error === options.missingError;
    },
  };

  return { fileSystem, state };
}

function captureSyncManifestError(action: () => unknown): VeryfrontError {
  try {
    action();
  } catch (error) {
    assertInstanceOf(error, VeryfrontError);
    return error;
  }
  return fail("Expected a typed manifest error");
}

async function captureManifestError(action: () => Promise<unknown>): Promise<VeryfrontError> {
  try {
    await action();
  } catch (error) {
    assertInstanceOf(error, VeryfrontError);
    return error;
  }
  return fail("Expected a typed manifest error");
}

function jsonDocumentOfByteLength(byteLength: number): string {
  const prefix = '{"value":"';
  const suffix = '"}';
  const valueLength = byteLength - prefix.length - suffix.length;
  assert(valueLength >= 0);
  const document = `${prefix}${"a".repeat(valueLength)}${suffix}`;
  assertEquals(encoder.encode(document).byteLength, byteLength);
  return document;
}

describe("parseExtensionManifest()", () => {
  it("keeps comment tokens inside JSONC strings", () => {
    const manifest = parseExtensionManifest<Record<string, string>>(
      '{"url":"https://example.test/a//b","block":"/* literal */","line":"// literal"}',
      "jsonc",
    );

    assertEquals(manifest, {
      url: "https://example.test/a//b",
      block: "/* literal */",
      line: "// literal",
    });
  });

  it("accepts line comments, block comments, and nested trailing commas", () => {
    const manifest = parseExtensionManifest<Record<string, unknown>>(
      `{
        // package activation policy
        "activation": "explicit",
        "contracts": [
          "AssetEngine", /* supplied by an extension */
        ],
      }`,
      "jsonc",
    );

    assertEquals(manifest, {
      activation: "explicit",
      contracts: ["AssetEngine"],
    });
  });

  it("accepts Deno JSONC whitespace outside strings", () => {
    const acceptedWhitespace = [
      0x09,
      0x0a,
      0x0b,
      0x0c,
      0x0d,
      0x20,
      0x85,
      0xa0,
      0x1680,
      ...Array.from({ length: 11 }, (_, index) => 0x2000 + index),
      0x2028,
      0x2029,
      0x202f,
      0x205f,
      0x3000,
    ];
    for (const codePoint of acceptedWhitespace) {
      const whitespace = String.fromCodePoint(codePoint);
      const manifest = parseExtensionManifest<{ activation: string }>(
        `{${whitespace}\"activation\"${whitespace}:${whitespace}\"explicit\",${whitespace}}`,
        "jsonc",
      );
      assertEquals(manifest, { activation: "explicit" });
    }

    for (const codePoint of [0xfeff, 0x180e, 0x200b]) {
      const whitespace = String.fromCodePoint(codePoint);
      const error = captureSyncManifestError(() =>
        parseExtensionManifest(`{${whitespace}\"activation\":\"explicit\"}`, "jsonc")
      );
      assertEquals(error.slug, "extension-manifest-parse-failed");
    }

    const strictError = captureSyncManifestError(() =>
      parseExtensionManifest(`{\u00a0\"activation\":\"explicit\"}`, "json")
    );
    assertEquals(strictError.slug, "extension-manifest-parse-failed");

    const stringSafeWhitespace = [
      0x85,
      0xa0,
      0x1680,
      ...Array.from({ length: 11 }, (_, index) => 0x2000 + index),
      0x2028,
      0x2029,
      0x202f,
      0x205f,
      0x3000,
    ];
    for (const codePoint of stringSafeWhitespace) {
      const whitespace = String.fromCodePoint(codePoint);
      const manifest = parseExtensionManifest<{ value: string }>(
        `{\"value\":\"a${whitespace}b\"}`,
        "jsonc",
      );
      assertEquals(
        manifest.value,
        `a${whitespace}b`,
        "Deno whitespace inside a JSONC string must survive verbatim",
      );
    }
  });

  it("matches Deno line-comment termination semantics", () => {
    for (const newline of ["\n", "\r\n"]) {
      assertEquals(
        parseExtensionManifest(`{"first":1,// comment${newline}"second":2}`, "jsonc"),
        { first: 1, second: 2 },
      );
    }
    for (const nonTerminator of ["\r", "\u2028", "\u2029"]) {
      const error = captureSyncManifestError(() =>
        parseExtensionManifest(
          `{"first":1,// comment${nonTerminator}"second":2}`,
          "jsonc",
        )
      );
      assertEquals(error.slug, "extension-manifest-parse-failed");
    }
  });

  it("treats empty and comment-only Deno manifests as empty objects", () => {
    for (const source of ["", "  \u2003\n", "// comment", "/* comment */\u3000"]) {
      assertEquals(parseExtensionManifest(source, "jsonc"), {});
    }
    const strictError = captureSyncManifestError(() => parseExtensionManifest("", "json"));
    assertEquals(strictError.slug, "extension-manifest-parse-failed");
  });

  it("fails closed with profile diagnostics for unsupported Deno loose syntax", () => {
    for (const source of ["{activation:'explicit'}", '{"value":+1}', '{"value":0x1}']) {
      const error = captureSyncManifestError(() => parseExtensionManifest(source, "jsonc"));
      assertInstanceOf(error.cause, SyntaxError);
      assertStringIncludes(
        (error.cause as SyntaxError).message,
        "Activation JSONC security profile",
      );
      assertStringIncludes((error.cause as SyntaxError).message, "double-quoted JSON keys");
    }
  });

  it("rejects duplicate object keys, including escaped security keys", () => {
    for (
      const [source, syntax] of [
        ['{"activation":"explicit","activation":"auto"}', "json"],
        ['{"veryfront":{},"veryfront":{"activation":"auto",}}', "jsonc"],
        ['{"activ\\u0061tion":"explicit","activation":"auto"}', "jsonc"],
      ] as const
    ) {
      const error = captureSyncManifestError(() => parseExtensionManifest(source, syntax));
      assertEquals(error.slug, "extension-manifest-parse-failed");
      assertInstanceOf(error.cause, SyntaxError);
      assertStringIncludes((error.cause as SyntaxError).message, "Duplicate object key");
    }

    assertEquals(
      parseExtensionManifest('{"first":{"key":1},"second":{"key":2}}', "json"),
      { first: { key: 1 }, second: { key: 2 } },
    );
  });

  it("uses captured Set intrinsics for duplicate-key checks", () => {
    const hasDescriptor = Object.getOwnPropertyDescriptor(Set.prototype, "has");
    const addDescriptor = Object.getOwnPropertyDescriptor(Set.prototype, "add");
    try {
      Object.defineProperty(Set.prototype, "has", {
        configurable: true,
        value: () => {
          throw new Error("poisoned Set.has");
        },
      });
      Object.defineProperty(Set.prototype, "add", {
        configurable: true,
        value: () => {
          throw new Error("poisoned Set.add");
        },
      });
      const error = captureSyncManifestError(() =>
        parseExtensionManifest('{"key":1,"key":2}', "json")
      );
      assertStringIncludes((error.cause as SyntaxError).message, "Duplicate object key");
    } finally {
      if (hasDescriptor) Object.defineProperty(Set.prototype, "has", hasDescriptor);
      if (addDescriptor) Object.defineProperty(Set.prototype, "add", addDescriptor);
    }
  });

  it("rejects comments and trailing commas in strict JSON mode", () => {
    const commentError = captureSyncManifestError(() =>
      parseExtensionManifest('{/* no comments */"value":1}', "json")
    );
    const commaError = captureSyncManifestError(() =>
      parseExtensionManifest('{"value":1,}', "json")
    );

    assertEquals(commentError.slug, "extension-manifest-parse-failed");
    assertEquals(commaError.slug, "extension-manifest-parse-failed");
  });

  it("rejects malformed JSONC after removing valid comments", () => {
    const error = captureSyncManifestError(() =>
      parseExtensionManifest('{"value": /* missing value */ }', "jsonc")
    );

    assertEquals(error.slug, "extension-manifest-parse-failed");
  });

  it("rejects unterminated block comments", () => {
    const error = captureSyncManifestError(() =>
      parseExtensionManifest('{"value": 1 /* never closed', "jsonc")
    );

    assertEquals(error.slug, "extension-manifest-parse-failed");
    assertInstanceOf(error.cause, SyntaxError);
    assertStringIncludes((error.cause as SyntaxError).message, "Unterminated block comment");
  });

  it("does not reinterpret orphan commas as trailing commas", () => {
    for (const source of ["[,]", "{,}", "[/* comment */,]", "{/* comment */,}"]) {
      const error = captureSyncManifestError(() => parseExtensionManifest(source, "jsonc"));
      assertEquals(error.slug, "extension-manifest-parse-failed");
    }
  });

  it("rejects an unsupported runtime grammar selector", () => {
    const error = captureSyncManifestError(() => parseExtensionManifest("{}", "yaml" as never));

    assertEquals(error.slug, "extension-manifest-parse-failed");
    assertEquals((error.context as { operation: string }).operation, "select-syntax");
  });
});

describe("readExtensionManifest() bounded reads", () => {
  it("accepts a manifest whose encoded length equals the fixed maximum", async () => {
    const source = jsonDocumentOfByteLength(MAX_EXTENSION_MANIFEST_BYTES);
    const data = encoder.encode(source);
    const { fileSystem, state } = createFakeFileSystem({ data, chunkSize: 64 * 1024 });

    const result = await readExtensionManifest<{ value: string }>("manifest.json", {
      syntax: "json",
      fileSystem,
    });

    assertEquals(result.kind, "found");
    if (result.kind === "found") {
      assertEquals(result.bytesRead, MAX_EXTENSION_MANIFEST_BYTES);
      assertEquals(result.manifest.value.length, MAX_EXTENSION_MANIFEST_BYTES - 12);
    }
    assertEquals(state.openCalls, 1);
    assertEquals(state.closeCalls, 1);
  });

  it("rejects an initially oversized manifest before opening it", async () => {
    const oversized = fileInfo(MAX_EXTENSION_MANIFEST_BYTES + 1);
    const { fileSystem, state } = createFakeFileSystem({ pathInfos: [oversized] });

    const error = await captureManifestError(() =>
      readExtensionManifest("manifest.json", { syntax: "json", fileSystem })
    );

    assertEquals(error.slug, "extension-manifest-too-large");
    assertEquals(state.openCalls, 0);
    assertEquals(state.closeCalls, 0);
  });

  it("uses MAX + 1 bytes to reject a stream that grows after stat", async () => {
    const data = encoder.encode(jsonDocumentOfByteLength(MAX_EXTENSION_MANIFEST_BYTES + 1));
    const initiallySmall = fileInfo(2);
    const { fileSystem, state } = createFakeFileSystem({
      data,
      handleInfo: initiallySmall,
      pathInfos: [initiallySmall, initiallySmall],
      chunkSize: 8191,
    });

    const error = await captureManifestError(() =>
      readExtensionManifest("manifest.json", { syntax: "json", fileSystem })
    );

    assertEquals(error.slug, "extension-manifest-too-large");
    assertEquals(state.openCalls, 1);
    assertEquals(state.closeCalls, 1);
    assert(state.readCalls > 1);
  });

  it("rejects invalid read lengths from the filesystem seam", async () => {
    const { fileSystem, state } = createFakeFileSystem({ invalidReadLength: 0 });

    const error = await captureManifestError(() =>
      readExtensionManifest("manifest.json", { syntax: "json", fileSystem })
    );

    assertEquals(error.slug, "extension-manifest-file-invalid");
    assertEquals(state.closeCalls, 1);
  });
});

describe("readExtensionManifest() file identity", () => {
  it("rejects a path swapped after the handle is opened", async () => {
    const original = fileInfo(2, { dev: 1, ino: 10 });
    const replacement = fileInfo(2, { dev: 1, ino: 11 });
    const { fileSystem, state } = createFakeFileSystem({
      handleInfo: original,
      pathInfos: [original, replacement],
    });

    const error = await captureManifestError(() =>
      readExtensionManifest("manifest.json", { syntax: "json", fileSystem })
    );

    assertEquals(error.slug, "extension-manifest-file-invalid");
    assertStringIncludes(error.message, "identity changed");
    assertEquals(state.readCalls, 0);
    assertEquals(state.closeCalls, 1);
  });

  it("rejects a handle opened for a different file", async () => {
    const pathInfo = fileInfo(2, { dev: 1, ino: 10 });
    const handleInfo = fileInfo(2, { dev: 2, ino: 20 });
    const { fileSystem, state } = createFakeFileSystem({
      handleInfo,
      pathInfos: [pathInfo, pathInfo],
    });

    const error = await captureManifestError(() =>
      readExtensionManifest("manifest.json", { syntax: "json", fileSystem })
    );

    assertEquals(error.slug, "extension-manifest-file-invalid");
    assertEquals(state.closeCalls, 1);
  });

  it("rejects path replacement while bytes are being read", async () => {
    const original = fileInfo(2, { dev: 1, ino: 10 });
    const replacement = fileInfo(2, { dev: 1, ino: 12 });
    const { fileSystem, state } = createFakeFileSystem({
      handleInfo: original,
      pathInfos: [original, original, replacement],
    });

    const error = await captureManifestError(() =>
      readExtensionManifest("manifest.json", { syntax: "json", fileSystem })
    );

    assertEquals(error.slug, "extension-manifest-file-invalid");
    assertEquals(state.closeCalls, 1);
  });

  it("fails closed when stable file identity is unavailable", async () => {
    const unverifiable = fileInfo(2, { dev: null, ino: null });
    const { fileSystem, state } = createFakeFileSystem({ pathInfos: [unverifiable] });

    const error = await captureManifestError(() =>
      readExtensionManifest("manifest.json", { syntax: "json", fileSystem })
    );

    assertEquals(error.slug, "extension-manifest-file-invalid");
    assertEquals(state.openCalls, 0);
  });

  it("applies identity and size validation to bigint stat results", async () => {
    const data = encoder.encode('{"activation":"explicit"}');
    const bigintInfo = fileInfo(BigInt(data.length), { dev: 11n, ino: 29n });
    const accepted = createFakeFileSystem({
      data,
      handleInfo: bigintInfo,
      pathInfos: [bigintInfo, bigintInfo, bigintInfo],
    });

    const result = await readExtensionManifest<{ activation: string }>("manifest.json", {
      syntax: "json",
      fileSystem: accepted.fileSystem,
    });

    assertEquals(
      result.kind,
      "found",
      "a bigint dev and ino pair must verify the same way as numbers",
    );
    if (result.kind === "found") {
      assertEquals(
        result.manifest.activation,
        "explicit",
        "the parsed manifest must survive a bigint stat result unchanged",
      );
      assertEquals(
        result.bytesRead,
        data.length,
        "bytesRead must report the byte length the bigint size described",
      );
    }
    assertEquals(
      accepted.state.closeCalls,
      1,
      "an accepted bigint stat read must still close its handle exactly once",
    );

    const oversized = fileInfo(BigInt(MAX_EXTENSION_MANIFEST_BYTES + 1), {
      dev: 11n,
      ino: 29n,
    });
    const large = createFakeFileSystem({ pathInfos: [oversized] });
    const sizeFailure = await captureManifestError(() =>
      readExtensionManifest("manifest.json", {
        syntax: "json",
        fileSystem: large.fileSystem,
      })
    );

    assertEquals(
      sizeFailure.slug,
      "extension-manifest-too-large",
      "the bigint pre-open size gate must reject an oversized manifest",
    );
    assertEquals(
      large.state.openCalls,
      0,
      "an oversized manifest must be rejected before the file is opened",
    );

    const original = fileInfo(2n, { dev: 1n, ino: 10n });
    const replacement = fileInfo(2n, { dev: 1n, ino: 11n });
    const swapped = createFakeFileSystem({
      handleInfo: original,
      pathInfos: [original, replacement],
    });
    const identityFailure = await captureManifestError(() =>
      readExtensionManifest("manifest.json", {
        syntax: "json",
        fileSystem: swapped.fileSystem,
      })
    );

    assertEquals(
      identityFailure.slug,
      "extension-manifest-file-invalid",
      "a bigint identity swap must surface as an invalid manifest file",
    );
    assertStringIncludes(
      identityFailure.message,
      "identity changed",
      "a bigint identity swap must be detected, not silently accepted",
    );
    assertEquals(
      swapped.state.closeCalls,
      1,
      "a rejected identity swap must still close the handle exactly once",
    );

    const negative = createFakeFileSystem({ pathInfos: [fileInfo(-1n)] });
    const negativeFailure = await captureManifestError(() =>
      readExtensionManifest("manifest.json", {
        syntax: "json",
        fileSystem: negative.fileSystem,
      })
    );

    assertEquals(
      negativeFailure.slug,
      "extension-manifest-file-invalid",
      "a negative bigint size must surface as an invalid manifest file",
    );
    assertStringIncludes(
      negativeFailure.message,
      "invalid negative size",
      "a negative bigint size must fail closed before the file is opened",
    );
    assertEquals(
      negative.state.openCalls,
      0,
      "a negative size must be rejected before the file is opened",
    );
  });
});

describe("readExtensionManifest() cleanup and errors", () => {
  it("returns a distinct missing result", async () => {
    const missing = new Error("missing");
    const { fileSystem, state } = createFakeFileSystem({
      initialError: missing,
      missingError: missing,
    });

    assertEquals(
      await readExtensionManifest("absent.json", { syntax: "json", fileSystem }),
      { kind: "missing" },
    );
    assertEquals(state.openCalls, 0);
  });

  it("closes the handle after success and parse failures", async () => {
    const cases: FakeFileSystemOptions[] = [
      {},
      { data: encoder.encode("{") },
    ];

    for (const options of cases) {
      const { fileSystem, state } = createFakeFileSystem(options);
      try {
        await readExtensionManifest("manifest.json", { syntax: "json", fileSystem });
      } catch (error) {
        assertInstanceOf(error, VeryfrontError);
      }
      assertEquals(state.openCalls, 1);
      assertEquals(state.closeCalls, 1);
    }
  });

  it("classifies stat, path, and read I/O failures as typed read errors", async () => {
    const cases: Array<{ options: FakeFileSystemOptions; cause: string }> = [
      { options: { statError: new Error("stat failed") }, cause: "stat failed" },
      {
        options: { pathInfos: [fileInfo(2), new Error("path failed")] },
        cause: "path failed",
      },
      { options: { readError: new Error("read failed") }, cause: "read failed" },
    ];

    for (const { options, cause } of cases) {
      const { fileSystem, state } = createFakeFileSystem(options);
      const error = await captureManifestError(() =>
        readExtensionManifest("manifest.json", { syntax: "json", fileSystem })
      );

      assertEquals(
        error.slug,
        "extension-manifest-read-failed",
        "an I/O failure must be a typed read error, never a truncated manifest",
      );
      assertEquals(
        (error.context as { operation: string }).operation,
        "read",
        "the typed read error must carry the read operation in its context",
      );
      assertStringIncludes(
        String(error.cause),
        cause,
        "the originating I/O failure must be preserved as the error cause",
      );
      assertEquals(
        state.openCalls,
        1,
        "a classified I/O failure must open the file exactly once",
      );
      assertEquals(
        state.closeCalls,
        1,
        "a classified I/O failure must still close the handle exactly once",
      );
    }
  });

  it("never accepts a failed read as an empty JSONC manifest", async () => {
    const { fileSystem, state } = createFakeFileSystem({
      readError: new Error("read failed"),
    });

    const error = await captureManifestError(() =>
      readExtensionManifest("manifest.jsonc", { syntax: "jsonc", fileSystem })
    );

    assertEquals(
      error.slug,
      "extension-manifest-read-failed",
      "a mid-stream read failure must not be reported as an empty JSONC manifest",
    );
    assertEquals(
      state.closeCalls,
      1,
      "a failed JSONC read must still close the handle exactly once",
    );
  });

  it("surfaces close failure as a contextual typed error", async () => {
    const { fileSystem, state } = createFakeFileSystem({
      closeError: new Error("close failed"),
    });

    const error = await captureManifestError(() =>
      readExtensionManifest("manifest.json", { syntax: "json", fileSystem })
    );

    assertEquals(error.slug, "extension-manifest-read-failed");
    assertStringIncludes(error.message, "close");
    assertEquals(state.closeCalls, 1);
  });

  it("ignores a poisoned AggregateError has-instance hook", async () => {
    const originalHasInstance = Object.getOwnPropertyDescriptor(
      AggregateError,
      Symbol.hasInstance,
    );
    const denied = new Error("denied");
    const { fileSystem } = createFakeFileSystem({
      initialError: denied,
      onLstat(call) {
        if (call !== 0) return;
        Object.defineProperty(AggregateError, Symbol.hasInstance, {
          configurable: true,
          value() {
            throw new Error("poisoned has-instance hook ran");
          },
        });
      },
    });

    let caught: unknown;
    try {
      await readExtensionManifest("manifest.json", { syntax: "json", fileSystem });
    } catch (error) {
      caught = error;
    } finally {
      if (originalHasInstance) {
        Object.defineProperty(AggregateError, Symbol.hasInstance, originalHasInstance);
      } else {
        Reflect.deleteProperty(AggregateError, Symbol.hasInstance);
      }
    }

    assertInstanceOf(caught, VeryfrontError);
    assertEquals(caught.slug, "extension-manifest-read-failed");
  });

  it("keeps parse errors typed when VeryfrontError has-instance is poisoned", async () => {
    const originalHasInstance = Object.getOwnPropertyDescriptor(
      VeryfrontError,
      Symbol.hasInstance,
    );
    const { fileSystem, state } = createFakeFileSystem({
      data: encoder.encode("{"),
      onLstat(call) {
        if (call !== 0) return;
        Object.defineProperty(VeryfrontError, Symbol.hasInstance, {
          configurable: true,
          value() {
            throw new Error("poisoned VeryfrontError has-instance hook ran");
          },
        });
      },
    });

    let caught: unknown;
    try {
      await readExtensionManifest("manifest.json", { syntax: "json", fileSystem });
    } catch (error) {
      caught = error;
    } finally {
      if (originalHasInstance) {
        Object.defineProperty(VeryfrontError, Symbol.hasInstance, originalHasInstance);
      } else {
        Reflect.deleteProperty(VeryfrontError, Symbol.hasInstance);
      }
    }

    assertInstanceOf(caught, VeryfrontError);
    assertEquals(caught.slug, "extension-manifest-parse-failed");
    assertEquals(state.closeCalls, 1);
  });

  it("does not consume a poisoned array iterator when operation and close fail", async () => {
    const originalIterator = Object.getOwnPropertyDescriptor(
      Array.prototype,
      Symbol.iterator,
    );
    assert(originalIterator);
    const { fileSystem, state } = createFakeFileSystem({
      data: encoder.encode("{"),
      closeError: new Error("close failed"),
      onLstat(call) {
        if (call !== 0) return;
        Object.defineProperty(Array.prototype, Symbol.iterator, {
          configurable: true,
          value() {
            throw new Error("poisoned array iterator ran");
          },
        });
      },
    });

    let caught: unknown;
    try {
      await readExtensionManifest("manifest.json", { syntax: "json", fileSystem });
    } catch (error) {
      caught = error;
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, originalIterator);
    }

    assertInstanceOf(caught, VeryfrontError);
    assertEquals(caught.slug, "extension-manifest-read-failed");
    assertEquals(state.closeCalls, 1);
  });

  it("sanitizes cyclic aggregate causes without recursion", async () => {
    const cyclic = new AggregateError([], "cyclic failure");
    cyclic.errors.push(cyclic);
    const { fileSystem } = createFakeFileSystem({ initialError: cyclic });

    const error = await captureManifestError(() =>
      readExtensionManifest("manifest.json", { syntax: "json", fileSystem })
    );

    assertEquals(error.slug, "extension-manifest-read-failed");
    assertInstanceOf(error.cause, Error);
    assertStringIncludes((error.cause as Error).message, "cyclic failure");
  });

  it("uses captured JSON intrinsics when globals change during inspection", async () => {
    const originalJson = Object.getOwnPropertyDescriptor(globalThis, "JSON");
    assert(originalJson);
    const { fileSystem, state } = createFakeFileSystem({
      onLstat(call) {
        if (call !== 0) return;
        Object.defineProperty(globalThis, "JSON", {
          configurable: true,
          get() {
            throw new Error("mutated JSON global was read");
          },
        });
      },
    });

    let result;
    try {
      result = await readExtensionManifest("manifest.json", { syntax: "json", fileSystem });
    } finally {
      Object.defineProperty(globalThis, "JSON", originalJson);
    }

    assertEquals(result, { kind: "found", manifest: {}, bytesRead: 2 });
    assertEquals(state.closeCalls, 1);
  });

  it("uses captured typed-array slots when accessors and species change in flight", async () => {
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
    const originalByteLength = Object.getOwnPropertyDescriptor(
      typedArrayPrototype,
      "byteLength",
    );
    const originalSpecies = Object.getOwnPropertyDescriptor(Uint8Array, Symbol.species);
    assert(originalByteLength);
    const { fileSystem, state } = createFakeFileSystem({
      onLstat(call) {
        if (call !== 0) return;
        Object.defineProperty(typedArrayPrototype, "byteLength", {
          configurable: true,
          get: () => 0,
        });
        Object.defineProperty(Uint8Array, Symbol.species, {
          configurable: true,
          get() {
            throw new Error("mutated typed-array species was read");
          },
        });
      },
    });

    let result;
    try {
      result = await readExtensionManifest("manifest.json", { syntax: "json", fileSystem });
    } finally {
      Object.defineProperty(typedArrayPrototype, "byteLength", originalByteLength);
      if (originalSpecies) {
        Object.defineProperty(Uint8Array, Symbol.species, originalSpecies);
      } else {
        Reflect.deleteProperty(Uint8Array, Symbol.species);
      }
    }

    assertEquals(result, { kind: "found", manifest: {}, bytesRead: 2 });
    assertEquals(state.closeCalls, 1);
  });

  it("escapes control characters in diagnostic paths", async () => {
    const path = 'manifest\nforged\t"entry\u0085nel\u2028line\u2029paragraph.json';
    const denied = new Error(`denied ${path}`);
    const { fileSystem } = createFakeFileSystem({ initialError: denied });

    const error = await captureManifestError(() =>
      readExtensionManifest(path, { syntax: "json", fileSystem })
    );

    assertEquals(error.message.includes("\n"), false);
    assertStringIncludes(
      error.message,
      '"manifest\\nforged\\t\\"entry\\u0085nel\\u2028line\\u2029paragraph.json"',
    );
    assertInstanceOf(error.cause, Error);
    assertEquals((error.cause as Error).message.includes("\n"), false);
    for (const separator of ["\u0085", "\u2028", "\u2029"]) {
      assertEquals(error.message.includes(separator), false);
      assertEquals((error.cause as Error).message.includes(separator), false);
    }
    assertEquals((error.context as { path: string }).path, path);
  });

  it("reports malformed UTF-8 as a parse error and closes the handle", async () => {
    const { fileSystem, state } = createFakeFileSystem({ data: new Uint8Array([0xff]) });

    const error = await captureManifestError(() =>
      readExtensionManifest("manifest.json", { syntax: "json", fileSystem })
    );

    assertEquals(error.slug, "extension-manifest-parse-failed");
    assertEquals(state.closeCalls, 1);
  });

  it("rejects a leading UTF-8 BOM like Deno config parsing", async () => {
    const { fileSystem, state } = createFakeFileSystem({
      data: new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]),
    });

    const error = await captureManifestError(() =>
      readExtensionManifest("deno.json", { syntax: "jsonc", fileSystem })
    );
    assertEquals(error.slug, "extension-manifest-parse-failed");
    assertEquals(state.closeCalls, 1);
  });
});

describe("readExtensionManifest() real filesystem policy", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const directory of tempDirs.splice(0)) {
      await Deno.remove(directory, { recursive: true });
    }
  });

  it("reads a regular file and reports a missing path distinctly", async () => {
    const directory = await Deno.makeTempDir({ prefix: "vf-extension-manifest-" });
    tempDirs.push(directory);
    const path = join(directory, "extension.jsonc");
    await Deno.writeTextFile(path, '{/* policy */"activation":"explicit",}');

    const found = await readExtensionManifest<{ activation: string }>(path, { syntax: "jsonc" });
    const missing = await readExtensionManifest(join(directory, "missing.json"), {
      syntax: "json",
    });

    assertEquals(found.kind, "found");
    if (found.kind === "found") assertEquals(found.manifest.activation, "explicit");
    assertEquals(missing, { kind: "missing" });
  });

  it("rejects terminal symlinks and non-regular files", async () => {
    const directory = await Deno.makeTempDir({ prefix: "vf-extension-manifest-" });
    tempDirs.push(directory);
    const target = join(directory, "target.json");
    const link = join(directory, "link.json");
    await Deno.writeTextFile(target, "{}");
    await Deno.symlink(target, link);

    const symlinkError = await captureManifestError(() =>
      readExtensionManifest(link, { syntax: "json" })
    );
    const directoryError = await captureManifestError(() =>
      readExtensionManifest(directory, { syntax: "json" })
    );

    assertEquals(symlinkError.slug, "extension-manifest-file-invalid");
    assertEquals(directoryError.slug, "extension-manifest-file-invalid");
  });
});
