import { assertEquals } from "#veryfront/testing/assert.ts";
import { Buffer } from "node:buffer";
import { createHash, Hash } from "node:crypto";
import { privateSha256Hex } from "./private-sha256.ts";

Deno.test("private SHA-256 ignores mutable outer and native hash prototypes", () => {
  const reference = createHash("sha256");
  const handleKey = Reflect.ownKeys(reference).find((key) => String(key) === "Symbol(kHandle)");
  const nativePrototype = handleKey === undefined
    ? undefined
    : Object.getPrototypeOf(Reflect.get(reference, handleKey));
  const originalUpdate = Hash.prototype.update;
  const originalDigest = Hash.prototype.digest;
  const originalBufferToString = Buffer.prototype.toString;
  const nativeUpdate = nativePrototype?.update;
  const nativeDigest = nativePrototype?.digest;
  let result: string;
  let binaryResult: string;
  try {
    Hash.prototype.update = function () {
      throw new Error("project outer update");
    };
    Hash.prototype.digest = function () {
      throw new Error("project outer digest");
    };
    Buffer.prototype.toString = () => "forged";
    if (nativeUpdate) {
      nativePrototype.update = () => {
        throw new Error("project native update");
      };
    }
    if (nativeDigest) nativePrototype.digest = () => "0".repeat(64);
    result = privateSha256Hex("hello");
    binaryResult = privateSha256Hex(new Uint8Array([0, 255, 128, 10]));
  } finally {
    Hash.prototype.update = originalUpdate;
    Hash.prototype.digest = originalDigest;
    Buffer.prototype.toString = originalBufferToString;
    if (nativeUpdate) nativePrototype.update = nativeUpdate;
    if (nativeDigest) nativePrototype.digest = nativeDigest;
  }
  assertEquals(result, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  assertEquals(binaryResult, "6d6f7836f1e146dc0204afb5133dae52fdc05603d8ac2dc793b481b0e0829fd1");
});

Deno.test("private SHA-256 hashes non-UTF8 bytes without text conversion", () => {
  assertEquals(
    privateSha256Hex(new Uint8Array([99, 0, 255, 128, 10, 99]).subarray(1, 5)),
    "6d6f7836f1e146dc0204afb5133dae52fdc05603d8ac2dc793b481b0e0829fd1",
  );
});
