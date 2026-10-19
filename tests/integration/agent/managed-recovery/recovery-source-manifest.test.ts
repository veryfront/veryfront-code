import "#veryfront/schemas/_test-setup.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { createRecoverySourceManifest } from "#veryfront/internal-agents/recovery-source-manifest.ts";

it("immutable release manifest matches the API Unicode golden and exact bytes", () => {
  const files = [
    { path: "設定.json", entityType: "virtual_file", content: "こんにちは🌍" },
    { path: "a.ts", entityType: "function", content: "hello" },
  ];
  const expected = {
    version: 1,
    hash: "780172ddfa4b6e81048a8f85deb2661cff8e5354d56bee0b237aff2cd7c4564e",
    fileCount: 2,
    totalBytes: 24,
  };
  assertEquals(createRecoverySourceManifest(files), expected);
  assertEquals(createRecoverySourceManifest([...files].reverse()), expected);
  assertEquals(
    createRecoverySourceManifest([{ ...files[1], content: "hello\n" }, files[0]]).hash ===
      expected.hash,
    false,
  );
  assertEquals(
    createRecoverySourceManifest([{ ...files[1], entityType: "page" }, files[0]]).hash ===
      expected.hash,
    false,
  );
});

it("release manifest rejects duplicate, incomplete, aliased or excessive listings", () => {
  const file = { path: "a.ts", entityType: "function", content: "hello" };
  assertThrows(() => createRecoverySourceManifest([file, file]));
  assertThrows(() => createRecoverySourceManifest([{ path: "a.ts", entityType: "function" }]));
  assertThrows(() => createRecoverySourceManifest([{ ...file, entityType: "file" }]));
  assertThrows(() => createRecoverySourceManifest([{ ...file, version_id: "untrusted-metadata" }]));
  assertThrows(() => createRecoverySourceManifest(Array.from({ length: 10001 }, () => file)));
});

it("mutable array hooks cannot forge a pinned source manifest", () => {
  const files = [{ path: "a.ts", entityType: "function", content: "secret-source" }];
  const expected = createRecoverySourceManifest(files);
  const map = Array.prototype.map;
  const sort = Array.prototype.sort;
  try {
    Array.prototype.map = function (...args) {
      return this === files ? [] : Reflect.apply(map, this, args);
    };
    Array.prototype.sort = function () {
      return this;
    };
    assertEquals(createRecoverySourceManifest(files), expected);
    assertThrows(() => createRecoverySourceManifest([files[0], files[0]]));
  } finally {
    Array.prototype.map = map;
    Array.prototype.sort = sort;
  }
});

const nativeBinary = {
  kind: "binary",
  path: "knowledge/raw.bin",
  entityType: "virtual_file",
  contentBase64: "AP+ACg==",
  contentType: "application/octet-stream",
  contentHash: "6d6f7836f1e146dc0204afb5133dae52fdc05603d8ac2dc793b481b0e0829fd1",
  byteSize: 4,
};
const nativeText = { kind: "text", path: "a.ts", entityType: "function", content: "hello" };

it("native mixed source hashes exact non-UTF8 bytes with the canonical v2 digest", () => {
  const expected = {
    version: 2,
    hash: "f41a2ea57c6e706a4c469dcf8167adf5882e810d1f3dece05de0ba2de17b8e58",
    fileCount: 2,
    totalBytes: 9,
  };
  assertEquals(createRecoverySourceManifest([nativeBinary, nativeText]), expected);
  assertEquals(createRecoverySourceManifest([nativeText, nativeBinary]), expected);
  assertThrows(() =>
    createRecoverySourceManifest([nativeBinary, { ...nativeText, kind: undefined }])
  );
});

it("native source rejects malformed, truncated, noncanonical or corrupted binary content", () => {
  for (
    const contentBase64 of ["AP+ACg=", "AP+ACn==", "AP-ACg==", "AP+ACg==\n", "!!!!!!!!", "AP+ACw=="]
  ) {
    assertThrows(() => createRecoverySourceManifest([{ ...nativeBinary, contentBase64 }]));
  }
  assertThrows(() => createRecoverySourceManifest([{ ...nativeBinary, byteSize: 3 }]));
  assertThrows(() =>
    createRecoverySourceManifest([{ ...nativeBinary, contentHash: "a".repeat(64) }])
  );
  assertThrows(() => createRecoverySourceManifest([nativeBinary, nativeBinary]));
  assertThrows(() => createRecoverySourceManifest([{ ...nativeBinary, entityType: "file" }]));
  assertThrows(() =>
    createRecoverySourceManifest([{ ...nativeBinary, byteSize: 8 * 1024 * 1024 + 1 }])
  );
});

it("native raw totals are admitted before decoding any binary payload", () => {
  assertThrows(
    () =>
      createRecoverySourceManifest(Array.from({ length: 9 }, (_, index) => ({
        ...nativeBinary,
        path: `knowledge/${index}.bin`,
        byteSize: 8 * 1024 * 1024,
        contentBase64: "", // deliberately invalid: aggregate admission must reject first
      }))),
    Error,
    "release bytes exceed",
  );
});

it("empty and all-text source retain v1 and cannot masquerade as native v2", () => {
  assertEquals(createRecoverySourceManifest([]), {
    version: 1,
    hash: "ad301433f67ec7108b54797ac5d7a61df8c92f62fa52ae631da3f49731576ac3",
    fileCount: 0,
    totalBytes: 0,
  });
  assertThrows(() => createRecoverySourceManifest([nativeText]), Error, "binary source membership");
});

it("native binary validation does not expose payloads to project RegExp hooks", () => {
  createRecoverySourceManifest([nativeBinary, nativeText]); // initialize trusted schemas before project hooks
  const ceil = Math.ceil;
  const test = RegExp.prototype.test;
  const exec = RegExp.prototype.exec;
  let exposures = 0;
  try {
    Math.ceil = () => {
      exposures++;
      throw new Error("project math hook");
    };
    RegExp.prototype.test = function () {
      exposures++;
      throw new Error("project test hook");
    };
    RegExp.prototype.exec = function () {
      exposures++;
      throw new Error("project exec hook");
    };
    const manifest = createRecoverySourceManifest([nativeBinary, nativeText]);
    assertEquals(manifest.hash, "f41a2ea57c6e706a4c469dcf8167adf5882e810d1f3dece05de0ba2de17b8e58");
    assertThrows(() =>
      createRecoverySourceManifest([{ ...nativeBinary, contentBase64: "!!!!!!!!" }])
    );
  } finally {
    Math.ceil = ceil;
    RegExp.prototype.test = test;
    RegExp.prototype.exec = exec;
  }
  assertEquals(exposures, 0);
});

it("legacy source discriminator ignores inherited getters and replaced Object.hasOwn", () => {
  const files = [{
    path: "private.ts",
    entityType: "function",
    content: "credential-protected-source",
  }];
  const expected = createRecoverySourceManifest(files);
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "kind");
  const originalHasOwn = Object.hasOwn;
  let exposed = 0;
  let actual: ReturnType<typeof createRecoverySourceManifest> | undefined;
  try {
    Object.defineProperty(Object.prototype, "kind", {
      configurable: true,
      get() {
        if (originalHasOwn(this, "content")) exposed++;
        return "binary";
      },
    });
    Object.hasOwn = () => true;
    actual = createRecoverySourceManifest(files);
  } finally {
    Object.hasOwn = originalHasOwn;
    if (descriptor) Object.defineProperty(Object.prototype, "kind", descriptor);
    else Reflect.deleteProperty(Object.prototype, "kind");
  }
  assertEquals(exposed, 0);
  assertEquals(actual, expected);
});

it("native identity preserves printable MIME and rejects missing or malformed binary types", () => {
  const original = createRecoverySourceManifest([nativeBinary, nativeText]);
  const changed = createRecoverySourceManifest([
    { ...nativeBinary, contentType: "image/png" },
    nativeText,
  ]);
  assertEquals(original.hash === changed.hash, false);
  const { contentType: _omitted, ...missing } = nativeBinary;
  assertThrows(() => createRecoverySourceManifest([missing, nativeText]));
  for (const contentType of ["", "x".repeat(201), "image/png\n", "image/画像"]) {
    assertThrows(() =>
      createRecoverySourceManifest([{ ...nativeBinary, contentType }, nativeText])
    );
  }
  createRecoverySourceManifest([{ ...nativeBinary, contentType: "x".repeat(200) }, nativeText]);
});

it("missing native MIME cannot expose source through an inherited contentType getter", () => {
  createRecoverySourceManifest([nativeBinary, nativeText]); // trusted schema initialization
  const { contentType: _omitted, ...missing } = nativeBinary;
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, "contentType");
  let exposed = 0;
  try {
    Object.defineProperty(Object.prototype, "contentType", {
      configurable: true,
      get() {
        exposed++;
        return "application/octet-stream";
      },
    });
    assertThrows(() => createRecoverySourceManifest([missing, nativeText]));
    const accessor = { ...nativeBinary };
    Object.defineProperty(accessor, "contentType", {
      configurable: true,
      get() {
        exposed++;
        return "application/octet-stream";
      },
    });
    assertThrows(() => createRecoverySourceManifest([accessor, nativeText]));
    createRecoverySourceManifest([nativeBinary, nativeText]);
  } finally {
    if (descriptor) Object.defineProperty(Object.prototype, "contentType", descriptor);
    else Reflect.deleteProperty(Object.prototype, "contentType");
  }
  assertEquals(exposed, 0);
});
