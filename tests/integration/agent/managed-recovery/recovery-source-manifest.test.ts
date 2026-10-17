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
