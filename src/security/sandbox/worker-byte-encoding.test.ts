import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { encodeSandboxBytesAsBase64, encodeSandboxBytesAsHex } from "./worker-byte-encoding.ts";

describe("sandbox worker byte encoding", () => {
  it("encodes hex without Uint8Array proposal methods", () => {
    assertEquals(encodeSandboxBytesAsHex(new Uint8Array()), "");
    assertEquals(
      encodeSandboxBytesAsHex(new Uint8Array([0x00, 0x0f, 0x10, 0x80, 0xff])),
      "000f1080ff",
    );
  });

  it("encodes padded base64 without Uint8Array proposal methods", () => {
    assertEquals(encodeSandboxBytesAsBase64(new Uint8Array()), "");
    assertEquals(encodeSandboxBytesAsBase64(new Uint8Array([0x66])), "Zg==");
    assertEquals(encodeSandboxBytesAsBase64(new Uint8Array([0x66, 0x6f])), "Zm8=");
    assertEquals(
      encodeSandboxBytesAsBase64(new Uint8Array([0x66, 0x6f, 0x6f])),
      "Zm9v",
    );
    assertEquals(
      encodeSandboxBytesAsBase64(new Uint8Array([0x00, 0xff, 0x80, 0x40, 0x20])),
      "AP+AQCA=",
    );
  });

  it("does not consult mutable proposal methods or btoa after initialization", () => {
    const bytesPrototype = Uint8Array.prototype as Uint8Array & {
      toBase64?: () => string;
      toHex?: () => string;
    };
    const originalToBase64 = Object.getOwnPropertyDescriptor(bytesPrototype, "toBase64");
    const originalToHex = Object.getOwnPropertyDescriptor(bytesPrototype, "toHex");
    const originalBtoa = Object.getOwnPropertyDescriptor(globalThis, "btoa");
    const poisoned = () => {
      throw new Error("mutable encoding global was used");
    };

    try {
      Object.defineProperty(bytesPrototype, "toBase64", {
        configurable: true,
        value: poisoned,
      });
      Object.defineProperty(bytesPrototype, "toHex", {
        configurable: true,
        value: poisoned,
      });
      Object.defineProperty(globalThis, "btoa", {
        configurable: true,
        value: poisoned,
      });

      assertEquals(encodeSandboxBytesAsHex(new Uint8Array([0xde, 0xad])), "dead");
      assertEquals(encodeSandboxBytesAsBase64(new Uint8Array([0xde, 0xad])), "3q0=");
    } finally {
      if (originalToBase64) {
        Object.defineProperty(bytesPrototype, "toBase64", originalToBase64);
      } else {
        delete bytesPrototype.toBase64;
      }
      if (originalToHex) {
        Object.defineProperty(bytesPrototype, "toHex", originalToHex);
      } else {
        delete bytesPrototype.toHex;
      }
      if (originalBtoa) {
        Object.defineProperty(globalThis, "btoa", originalBtoa);
      } else {
        delete (globalThis as { btoa?: unknown }).btoa;
      }
    }
  });
});
