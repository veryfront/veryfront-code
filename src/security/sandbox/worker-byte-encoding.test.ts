import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { encodeSandboxBytesAsBase64, encodeSandboxBytesAsHex } from "./worker-byte-encoding.ts";

/** Mirrors the encoder chunk size so the fixture crosses a chunk boundary. */
const BASE64_CHUNK_BYTES = 3 * 8 * 1024;

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
        delete (bytesPrototype as { toBase64?: unknown }).toBase64;
      }
      if (originalToHex) {
        Object.defineProperty(bytesPrototype, "toHex", originalToHex);
      } else {
        delete (bytesPrototype as { toHex?: unknown }).toHex;
      }
      if (originalBtoa) {
        Object.defineProperty(globalThis, "btoa", originalBtoa);
      } else {
        delete (globalThis as { btoa?: unknown }).btoa;
      }
    }
  });

  it("encodes tenant bytes when project code hooks species and length", () => {
    const source = new Uint8Array(BASE64_CHUNK_BYTES + 5);
    for (let index = 0; index < source.length; index++) {
      source[index] = index % 256;
    }
    const expectedHex = encodeSandboxBytesAsHex(source);
    const expectedBase64 = encodeSandboxBytesAsBase64(source);
    const arrayConstructor = Uint8Array as unknown as Record<symbol, unknown>;
    const originalSpecies = Object.getOwnPropertyDescriptor(
      arrayConstructor,
      Symbol.species,
    );
    const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
    const originalLength = Object.getOwnPropertyDescriptor(
      typedArrayPrototype,
      "length",
    )!;

    try {
      Object.defineProperty(arrayConstructor, Symbol.species, {
        configurable: true,
        get() {
          throw new Error("project code controlled typed array construction");
        },
      });
      Object.defineProperty(typedArrayPrototype, "length", {
        configurable: true,
        get() {
          throw new Error("project code controlled typed array length");
        },
      });

      assertEquals(encodeSandboxBytesAsHex(source), expectedHex);
      assertEquals(encodeSandboxBytesAsBase64(source), expectedBase64);
    } finally {
      Object.defineProperty(typedArrayPrototype, "length", originalLength);
      if (originalSpecies) {
        Object.defineProperty(arrayConstructor, Symbol.species, originalSpecies);
      } else {
        delete arrayConstructor[Symbol.species];
      }
    }
  });
});
