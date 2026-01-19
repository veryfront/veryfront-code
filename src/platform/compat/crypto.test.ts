import { assert, assertEquals, assertExists, assertNotEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createCrypto } from "./crypto.ts";

describe("Crypto Compat", () => {
  describe("createCrypto", () => {
    it("returns crypto instance", () => {
      const crypto = createCrypto();
      assertExists(crypto);
      assertExists(crypto.getRandomValues);
      assertExists(crypto.randomUUID);
      assertExists(crypto.subtle);
    });
  });

  describe("getRandomValues", () => {
    it("fills Uint8Array", () => {
      const crypto = createCrypto();
      const array = new Uint8Array(16);

      array.fill(0);

      const result = crypto.getRandomValues(array);

      assertEquals(result, array);

      const hasNonZero = array.some((byte) => byte !== 0);
      assert(hasNonZero, "Array should contain non-zero values");
    });

    it("works with different array sizes", () => {
      const crypto = createCrypto();

      const sizes = [8, 16, 32, 64, 128, 256];

      for (const size of sizes) {
        const array = new Uint8Array(size);
        crypto.getRandomValues(array);

        assertEquals(array.length, size);
        const hasNonZero = array.some((byte) => byte !== 0);
        assert(hasNonZero, `Array of size ${size} should contain non-zero values`);
      }
    });

    it("produces different values", () => {
      const crypto = createCrypto();

      const array1 = new Uint8Array(32);
      const array2 = new Uint8Array(32);

      crypto.getRandomValues(array1);
      crypto.getRandomValues(array2);

      const areSame = array1.every((byte, index) => byte === array2[index]);
      assert(!areSame, "Two random arrays should be different");
    });

    it("handles edge cases", () => {
      const crypto = createCrypto();

      const small = new Uint8Array(1);
      crypto.getRandomValues(small);
      assertEquals(small.length, 1);

      const large = new Uint8Array(65536);
      crypto.getRandomValues(large);
      assertEquals(large.length, 65536);
    });
  });

  describe("randomUUID", () => {
    it("generates valid UUIDs", () => {
      const crypto = createCrypto();
      const uuid = crypto.randomUUID();

      assertExists(uuid);
      assertEquals(typeof uuid, "string");

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      assert(uuidRegex.test(uuid), `UUID should match v4 format: ${uuid}`);
    });

    it("generates unique UUIDs", () => {
      const crypto = createCrypto();

      const uuids = new Set<string>();
      const count = 1000;

      for (let i = 0; i < count; i++) {
        const uuid = crypto.randomUUID();
        uuids.add(uuid);
      }

      assertEquals(uuids.size, count, "All generated UUIDs should be unique");
    });
  });

  describe("subtle crypto", () => {
    it("is available", () => {
      const crypto = createCrypto();
      const subtle = crypto.subtle;

      assertExists(subtle);
      assertExists(subtle.digest);
      assertExists(subtle.encrypt);
      assertExists(subtle.decrypt);
      assertExists(subtle.sign);
      assertExists(subtle.verify);
      assertExists(subtle.generateKey);
      assertExists(subtle.deriveKey);
      assertExists(subtle.deriveBits);
      assertExists(subtle.importKey);
      assertExists(subtle.exportKey);
      assertExists(subtle.wrapKey);
      assertExists(subtle.unwrapKey);
    });

    it("digest with SHA-256", async () => {
      const crypto = createCrypto();
      const data = new TextEncoder().encode("Hello World");

      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = new Uint8Array(hashBuffer);

      assertEquals(hashArray.length, 32);

      const hashHex = Array.from(hashArray)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

      const expectedHash = "a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e";
      assertEquals(hashHex, expectedHash);
    });

    it("digest with SHA-1", async () => {
      const crypto = createCrypto();
      const data = new TextEncoder().encode("test");

      const hashBuffer = await crypto.subtle.digest("SHA-1", data);
      const hashArray = new Uint8Array(hashBuffer);

      assertEquals(hashArray.length, 20);
    });

    it("digest with SHA-384", async () => {
      const crypto = createCrypto();
      const data = new TextEncoder().encode("test");

      const hashBuffer = await crypto.subtle.digest("SHA-384", data);
      const hashArray = new Uint8Array(hashBuffer);

      assertEquals(hashArray.length, 48);
    });

    it("digest with SHA-512", async () => {
      const crypto = createCrypto();
      const data = new TextEncoder().encode("test");

      const hashBuffer = await crypto.subtle.digest("SHA-512", data);
      const hashArray = new Uint8Array(hashBuffer);

      assertEquals(hashArray.length, 64);
    });

    it("digest with empty data", async () => {
      const crypto = createCrypto();
      const emptyData = new Uint8Array(0);

      const hashBuffer = await crypto.subtle.digest("SHA-256", emptyData);
      const hashArray = new Uint8Array(hashBuffer);

      assertEquals(hashArray.length, 32);

      const hashHex = Array.from(hashArray)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const expectedHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
      assertEquals(hashHex, expectedHash);
    });

    it("generateKey for AES", async () => {
      const crypto = createCrypto();

      const key = await crypto.subtle.generateKey(
        {
          name: "AES-GCM",
          length: 256,
        },
        true,
        ["encrypt", "decrypt"],
      );

      assertExists(key);
      assertEquals(key.type, "secret");
      assertEquals((key.algorithm as any).name, "AES-GCM");
      assertEquals((key.algorithm as any).length, 256);
    });

    it("generateKey for RSA", async () => {
      const crypto = createCrypto();

      const keyPair = (await crypto.subtle.generateKey(
        {
          name: "RSA-OAEP",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        },
        true,
        ["encrypt", "decrypt"],
      )) as CryptoKeyPair;

      assertExists(keyPair);
      assertExists(keyPair.publicKey);
      assertExists(keyPair.privateKey);
      assertEquals(keyPair.publicKey.type, "public");
      assertEquals(keyPair.privateKey.type, "private");
    });

    it("generateKey for HMAC", async () => {
      const crypto = createCrypto();

      const key = await crypto.subtle.generateKey(
        {
          name: "HMAC",
          hash: "SHA-256",
        },
        true,
        ["sign", "verify"],
      );

      assertExists(key);
      assertEquals(key.type, "secret");
      assertEquals((key.algorithm as any).name, "HMAC");
    });

    it("encrypt/decrypt with AES-GCM", async () => {
      const crypto = createCrypto();

      const key = await crypto.subtle.generateKey(
        {
          name: "AES-GCM",
          length: 256,
        },
        true,
        ["encrypt", "decrypt"],
      );

      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = new TextEncoder().encode("Secret message");

      const encrypted = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: new Uint8Array(iv),
        },
        key as CryptoKey,
        new Uint8Array(data),
      );

      assertExists(encrypted);

      const decrypted = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: new Uint8Array(iv),
        },
        key as CryptoKey,
        new Uint8Array(encrypted),
      );

      const decryptedText = new TextDecoder().decode(decrypted);
      assertEquals(decryptedText, "Secret message");
    });

    it("sign/verify with HMAC", async () => {
      const crypto = createCrypto();

      const key = await crypto.subtle.generateKey(
        {
          name: "HMAC",
          hash: "SHA-256",
        },
        true,
        ["sign", "verify"],
      );

      const data = new TextEncoder().encode("Message to sign");

      const signature = await crypto.subtle.sign("HMAC", key as CryptoKey, data);

      assertExists(signature);

      const isValid = await crypto.subtle.verify("HMAC", key as CryptoKey, signature, data);

      assert(isValid, "Signature should be valid");

      const wrongData = new TextEncoder().encode("Wrong message");
      const isInvalid = await crypto.subtle.verify("HMAC", key as CryptoKey, signature, wrongData);

      assert(!isInvalid, "Signature should be invalid for wrong data");
    });

    it("importKey/exportKey", async () => {
      const crypto = createCrypto();

      const keyData = crypto.getRandomValues(new Uint8Array(32));

      const key = await crypto.subtle.importKey(
        "raw",
        new Uint8Array(keyData),
        {
          name: "AES-GCM",
          length: 256,
        },
        true,
        ["encrypt", "decrypt"],
      );

      assertExists(key);

      const exportedKey = await crypto.subtle.exportKey("raw", key);

      assertExists(exportedKey);
      const exportedArray = new Uint8Array(exportedKey as ArrayBuffer);
      assertEquals(exportedArray.length, 32);
      // Compare byte by byte to handle Buffer vs Uint8Array
      for (let i = 0; i < keyData.length; i++) {
        assertEquals(exportedArray[i], keyData[i]);
      }
    });

    it("deriveBits with PBKDF2", async () => {
      const crypto = createCrypto();

      const password = new TextEncoder().encode("password");
      const salt = crypto.getRandomValues(new Uint8Array(16));

      const baseKey = await crypto.subtle.importKey("raw", password, "PBKDF2", false, [
        "deriveBits",
      ]);

      const derivedBits = await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          salt: new Uint8Array(salt),
          iterations: 1000,
          hash: "SHA-256",
        },
        baseKey,
        256,
      );

      assertExists(derivedBits);
      assertEquals(new Uint8Array(derivedBits).length, 32);
    });
  });

  describe("multiple instances", () => {
    it("use same underlying crypto", () => {
      const crypto1 = createCrypto();
      const crypto2 = createCrypto();

      const uuid1 = crypto1.randomUUID();
      const uuid2 = crypto2.randomUUID();

      assertExists(uuid1);
      assertExists(uuid2);
      assertNotEquals(uuid1, uuid2);
    });
  });
});
