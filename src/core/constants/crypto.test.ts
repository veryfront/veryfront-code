import { describe, it } from "std/testing/bdd.ts";
import { assertEquals } from "std/assert/mod.ts";
import {
  HASH_ALGORITHM_SHA256,
  HASH_ALGORITHM_SHA1,
  HASH_ALGORITHM_MD5,
  SHA256_HEX_LENGTH,
  SHA1_HEX_LENGTH,
  MD5_HEX_LENGTH,
  FNV1A_PRIME_32,
  CSP_NONCE_LENGTH_BYTES,
} from "./crypto.ts";

describe("constants/crypto", () => {
  describe("hash algorithm names", () => {
    it("should export SHA-256 algorithm name", () => {
      assertEquals(HASH_ALGORITHM_SHA256, "SHA-256");
    });

    it("should export SHA-1 algorithm name", () => {
      assertEquals(HASH_ALGORITHM_SHA1, "SHA-1");
    });

    it("should export MD5 algorithm name", () => {
      assertEquals(HASH_ALGORITHM_MD5, "MD5");
    });
  });

  describe("hash hex lengths", () => {
    it("should export correct SHA-256 hex length (64 chars)", () => {
      assertEquals(SHA256_HEX_LENGTH, 64);
    });

    it("should export correct SHA-1 hex length (40 chars)", () => {
      assertEquals(SHA1_HEX_LENGTH, 40);
    });

    it("should export correct MD5 hex length (32 chars)", () => {
      assertEquals(MD5_HEX_LENGTH, 32);
    });

    it("should have SHA-256 length greater than SHA-1", () => {
      assertEquals(SHA256_HEX_LENGTH > SHA1_HEX_LENGTH, true);
    });

    it("should have SHA-1 length greater than MD5", () => {
      assertEquals(SHA1_HEX_LENGTH > MD5_HEX_LENGTH, true);
    });
  });

  describe("FNV1A hash constant", () => {
    it("should export correct FNV1A prime for 32-bit", () => {
      assertEquals(FNV1A_PRIME_32, 16777619);
    });

    it("should be a positive integer", () => {
      assertEquals(Number.isInteger(FNV1A_PRIME_32), true);
      assertEquals(FNV1A_PRIME_32 > 0, true);
    });
  });

  describe("CSP nonce length", () => {
    it("should export correct CSP nonce length in bytes", () => {
      assertEquals(CSP_NONCE_LENGTH_BYTES, 16);
    });

    it("should be 128 bits (16 bytes)", () => {
      assertEquals(CSP_NONCE_LENGTH_BYTES * 8, 128);
    });
  });

  describe("hash length relationships", () => {
    it("should have hash lengths as multiples of 8", () => {
      assertEquals(SHA256_HEX_LENGTH % 8, 0);
      assertEquals(SHA1_HEX_LENGTH % 8, 0);
      assertEquals(MD5_HEX_LENGTH % 8, 0);
    });

    it("should correspond to actual bit lengths", () => {
      // SHA-256: 256 bits = 64 hex chars (4 bits per hex char)
      assertEquals(SHA256_HEX_LENGTH, 256 / 4);
      // SHA-1: 160 bits = 40 hex chars
      assertEquals(SHA1_HEX_LENGTH, 160 / 4);
      // MD5: 128 bits = 32 hex chars
      assertEquals(MD5_HEX_LENGTH, 128 / 4);
    });
  });
});
