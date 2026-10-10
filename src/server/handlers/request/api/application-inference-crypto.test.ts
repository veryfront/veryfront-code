import { Buffer } from "node:buffer";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  decryptApplicationInferenceToken,
  encryptApplicationInferenceToken,
  generateApplicationInferenceEncryptionKeyPair,
  MAX_APPLICATION_INFERENCE_TOKEN_BYTES,
  MAX_ENCRYPTED_INFERENCE_TOKEN_FIELD_BYTES,
} from "./application-inference-crypto.ts";

const RUN_ID = "33333333-3333-4333-8333-333333333333";
const EXPIRES_AT = "2030-01-01T00:00:00.000Z";
const INFERENCE_TOKEN = "synthetic-inference-token";

async function encrypted() {
  const keyPair = generateApplicationInferenceEncryptionKeyPair();
  const encryptedInferenceToken = encryptApplicationInferenceToken({
    publicKey: keyPair.publicKey,
    runId: RUN_ID,
    expiresAt: EXPIRES_AT,
    inferenceToken: INFERENCE_TOKEN,
  });
  return { keyPair, encryptedInferenceToken };
}

function tamperBase64(value: string): string {
  return `${value.slice(0, -1)}${value.endsWith("A") ? "B" : "A"}`;
}

describe("application inference admission crypto", () => {
  it("decrypts an encrypted inference token for the matching key and metadata", async () => {
    const { keyPair, encryptedInferenceToken } = await encrypted();

    assertEquals(Object.hasOwn(keyPair, "then"), true);
    assertEquals(Reflect.get(keyPair, "then"), undefined);
    assertEquals(
      decryptApplicationInferenceToken({
        privateKey: keyPair.privateKey,
        runId: RUN_ID,
        expiresAt: EXPIRES_AT,
        encryptedInferenceToken,
      }),
      INFERENCE_TOKEN,
    );
  });

  it("authenticates the run metadata as additional data", async () => {
    const { keyPair, encryptedInferenceToken } = await encrypted();

    assertThrows(() =>
      decryptApplicationInferenceToken({
        privateKey: keyPair.privateKey,
        runId: "44444444-4444-4444-8444-444444444444",
        expiresAt: EXPIRES_AT,
        encryptedInferenceToken,
      })
    );
  });

  it("rejects tampered encrypted fields", async () => {
    const { keyPair, encryptedInferenceToken } = await encrypted();

    assertThrows(() =>
      decryptApplicationInferenceToken({
        privateKey: keyPair.privateKey,
        runId: RUN_ID,
        expiresAt: EXPIRES_AT,
        encryptedInferenceToken: {
          ...encryptedInferenceToken,
          ciphertext: tamperBase64(encryptedInferenceToken.ciphertext),
        },
      })
    );
  });

  it("rejects malformed encrypted fields", async () => {
    const { keyPair, encryptedInferenceToken } = await encrypted();

    assertThrows(() =>
      decryptApplicationInferenceToken({
        privateKey: keyPair.privateKey,
        runId: RUN_ID,
        expiresAt: EXPIRES_AT,
        encryptedInferenceToken: {
          ...encryptedInferenceToken,
          ephemeralPublicKey: "not-base64",
        },
      })
    );
  });

  it("rejects an encrypted token for a different private key", async () => {
    const { encryptedInferenceToken } = await encrypted();
    const otherKeyPair = await generateApplicationInferenceEncryptionKeyPair();

    assertThrows(() =>
      decryptApplicationInferenceToken({
        privateKey: otherKeyPair.privateKey,
        runId: RUN_ID,
        expiresAt: EXPIRES_AT,
        encryptedInferenceToken,
      })
    );
  });

  it("rejects encrypted field values outside the encoded bounds", async () => {
    const { keyPair, encryptedInferenceToken } = await encrypted();

    assertThrows(() =>
      decryptApplicationInferenceToken({
        privateKey: keyPair.privateKey,
        runId: RUN_ID,
        expiresAt: EXPIRES_AT,
        encryptedInferenceToken: {
          ...encryptedInferenceToken,
          ephemeralPublicKey: "",
        },
      })
    );
    assertThrows(() =>
      decryptApplicationInferenceToken({
        privateKey: keyPair.privateKey,
        runId: RUN_ID,
        expiresAt: EXPIRES_AT,
        encryptedInferenceToken: {
          ...encryptedInferenceToken,
          ephemeralPublicKey: "A".repeat(MAX_ENCRYPTED_INFERENCE_TOKEN_FIELD_BYTES + 1),
        },
      })
    );
  });

  it("rejects encrypted metadata with invalid iv or tag sizes", async () => {
    const { keyPair, encryptedInferenceToken } = await encrypted();

    assertThrows(() =>
      decryptApplicationInferenceToken({
        privateKey: keyPair.privateKey,
        runId: RUN_ID,
        expiresAt: EXPIRES_AT,
        encryptedInferenceToken: {
          ...encryptedInferenceToken,
          iv: Buffer.alloc(11).toString("base64"),
        },
      })
    );
    assertThrows(() =>
      decryptApplicationInferenceToken({
        privateKey: keyPair.privateKey,
        runId: RUN_ID,
        expiresAt: EXPIRES_AT,
        encryptedInferenceToken: {
          ...encryptedInferenceToken,
          tag: Buffer.alloc(15).toString("base64"),
        },
      })
    );
  });
  it("rejects oversized plaintext tokens before encryption", async () => {
    const keyPair = await generateApplicationInferenceEncryptionKeyPair();

    assertThrows(() =>
      encryptApplicationInferenceToken({
        publicKey: keyPair.publicKey,
        runId: RUN_ID,
        expiresAt: EXPIRES_AT,
        inferenceToken: "x".repeat(MAX_APPLICATION_INFERENCE_TOKEN_BYTES + 1),
      })
    );
  });
});
