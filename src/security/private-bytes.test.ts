import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  privateByteLength,
  privateByteSubarray,
  PrivateUint8Array,
  setPrivateBytes,
  toPrivateUint8Array,
} from "./private-bytes.ts";

describe("private binary views", () => {
  it("views and copies bytes without consulting metadata or species getters", () => {
    const bytes = new Uint8Array([11, 22, 33, 44]);
    let reads = 0;
    for (const key of ["constructor", "buffer", "byteOffset", "byteLength"] as const) {
      const value = bytes[key];
      Object.defineProperty(bytes, key, {
        get() {
          reads++;
          return value;
        },
      });
    }
    const target = new PrivateUint8Array(3);
    setPrivateBytes(target, privateByteSubarray(bytes, -3, -1), 1);
    assertEquals(privateByteLength(bytes), 4);
    assertEquals(target, new Uint8Array([0, 22, 33]));
    assertEquals(reads, 0);
    assertEquals(toPrivateUint8Array(new DataView(target.buffer, 1, 2)), new Uint8Array([22, 33]));
    assertEquals(toPrivateUint8Array(target.buffer), target);
    assertEquals(toPrivateUint8Array("invalid"), undefined);
  });

  it("keeps normalization within the supplied view's byte window", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
    for (
      const view of [
        new Uint8Array(bytes.buffer, 2, 2),
        new DataView(bytes.buffer, 2, 2),
        new Uint16Array(bytes.buffer, 2, 1),
      ]
    ) {
      assertEquals(toPrivateUint8Array(view), new Uint8Array([3, 4]));
    }
    assertEquals(toPrivateUint8Array(bytes.buffer), bytes);
    assertEquals(toPrivateUint8Array("invalid"), undefined);
  });

  it("keeps subarrays within their source view while preserving relative bounds", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const view = new Uint8Array(bytes.buffer, 1, 4);
    assertEquals(privateByteSubarray(view, 1, 3), new Uint8Array([3, 4]));
    assertEquals(privateByteSubarray(view, -2, -1), new Uint8Array([4]));
    assertEquals(privateByteSubarray(view, -Infinity, Infinity), view);
    assertEquals(privateByteSubarray(view, NaN, 1), new Uint8Array([2]));
    assertEquals(privateByteSubarray(view, 3, 1), new Uint8Array());
    assertEquals(privateByteSubarray(view, 99), new Uint8Array());
  });
});
