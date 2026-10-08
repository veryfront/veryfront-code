// These security boundary tests intentionally mutate shared-realm prototypes,
// so they live in the semantic integration suite rather than a unit module.
import "#veryfront/schemas/_test-setup.ts";
import { Buffer } from "node:buffer";
import { Decipheriv } from "node:crypto";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  decryptApplicationInferenceToken,
  encryptApplicationInferenceToken,
  generateApplicationInferenceEncryptionKeyPair,
} from "#veryfront/server/handlers/request/api/application-inference-crypto.ts";

const RUN_ID = "33333333-3333-4333-8333-333333333333";
const EXPIRES_AT = "2030-01-01T00:00:00.000Z";
const INFERENCE_TOKEN = "synthetic-inference-token";
const INFERENCE_TOKEN_BYTES = new TextEncoder().encode(INFERENCE_TOKEN);

function encrypted() {
  const keyPair = generateApplicationInferenceEncryptionKeyPair();
  const encryptedInferenceToken = encryptApplicationInferenceToken({
    publicKey: keyPair.publicKey,
    runId: RUN_ID,
    expiresAt: EXPIRES_AT,
    inferenceToken: INFERENCE_TOKEN,
  });
  return { keyPair, encryptedInferenceToken };
}

function decodedEncryptedFields(
  encryptedInferenceToken: ReturnType<typeof encrypted>["encryptedInferenceToken"],
) {
  return {
    iv: Buffer.from(encryptedInferenceToken.iv, "base64"),
    tag: Buffer.from(encryptedInferenceToken.tag, "base64"),
    ciphertext: Buffer.from(encryptedInferenceToken.ciphertext, "base64"),
  };
}

function installOwnContextStealingSetter<Target extends object>(
  target: Target,
  input: {
    readonly aad: Buffer;
    readonly tag: Buffer;
    readonly ciphertext: Buffer;
    readonly observed: string[];
  },
): void {
  Object.defineProperty(target, "_context", {
    configurable: true,
    set(value) {
      Object.defineProperty(this, "_context", {
        value,
        writable: true,
        configurable: true,
      });
      try {
        const decipher = this as {
          setAAD(aad: Buffer): void;
          setAuthTag(tag: Buffer): void;
          update(ciphertext: Buffer): Buffer;
        };
        decipher.setAAD(input.aad);
        decipher.setAuthTag(input.tag);
        input.observed.push(decipher.update(input.ciphertext).toString("utf8"));
      } catch {
        input.observed.push("setter-error");
      }
    },
  });
}

function installContextStealingSetter<Target extends object>(
  target: Target,
  input: {
    readonly aad: Buffer;
    readonly tag: Buffer;
    readonly ciphertext: Buffer;
    readonly observed: string[];
  },
): PropertyDescriptor | undefined {
  const original = Object.getOwnPropertyDescriptor(target, "_context");
  Object.defineProperty(target, "_context", {
    configurable: true,
    set(value) {
      Object.defineProperty(this, "_context", {
        value,
        writable: true,
        configurable: true,
      });
      if (
        typeof this === "object" && this !== null &&
        typeof (this as { setAuthTag?: unknown }).setAuthTag === "function"
      ) {
        try {
          const decipher = this as {
            setAAD(aad: Buffer): void;
            setAuthTag(tag: Buffer): void;
            update(ciphertext: Buffer): Buffer;
          };
          decipher.setAAD(input.aad);
          decipher.setAuthTag(input.tag);
          input.observed.push(decipher.update(input.ciphertext).toString("utf8"));
        } catch {
          input.observed.push("setter-error");
        }
      }
    },
  });
  return original;
}

function restorePropertyDescriptor<Target extends object>(
  target: Target,
  property: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) Object.defineProperty(target, property, descriptor);
  else Reflect.deleteProperty(target, property);
}

function testAccessorDescriptor(getter: () => unknown): PropertyDescriptor {
  const descriptor = Object.create(null) as PropertyDescriptor;
  descriptor.configurable = true;
  descriptor.get = getter;
  return descriptor;
}

function matchesInferenceTokenBytes(value: unknown, byteLength: number): boolean {
  if (!(value instanceof Uint8Array) || byteLength !== INFERENCE_TOKEN_BYTES.length) return false;
  for (let index = 0; index < INFERENCE_TOKEN_BYTES.length; index += 1) {
    if (value[index] !== INFERENCE_TOKEN_BYTES[index]) return false;
  }
  return true;
}

function findPrototypeDescriptor<Target extends object>(
  start: Target,
  property: string,
): { readonly prototype: object; readonly descriptor: PropertyDescriptor } {
  let prototype: object | null = start;
  while (prototype !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
    if (descriptor) return { prototype, descriptor };
    prototype = Object.getPrototypeOf(prototype);
  }
  throw new Error(`Expected ${property} on private key prototype chain`);
}

describe("application inference admission crypto intrinsic boundary", () => {
  it("does not expose generated key material through an inherited then getter", async () => {
    const originalThen = Object.getOwnPropertyDescriptor(Object.prototype, "then");
    let observed = "";
    Object.defineProperty(Object.prototype, "then", {
      configurable: true,
      get() {
        if (this !== null && typeof this === "object") {
          const privateKey = Object.getOwnPropertyDescriptor(this, "privateKey")?.value;
          if (privateKey && typeof privateKey === "object") {
            observed = "privateKey";
          }
          if (this instanceof Uint8Array) observed = "bytes";
        }
        return undefined;
      },
    });
    try {
      const keyPair = await generateApplicationInferenceEncryptionKeyPair();
      assertEquals(Object.hasOwn(keyPair, "then"), true);
      assertEquals(Reflect.get(keyPair, "then"), undefined);
      assertEquals(keyPair.publicKey.length > 0, true);
    } finally {
      if (originalThen) Object.defineProperty(Object.prototype, "then", originalThen);
      else Reflect.deleteProperty(Object.prototype, "then");
    }

    assertEquals(observed, "");
  });

  it("does not expose private key or plaintext token material through mutable Node hooks", async () => {
    const { keyPair, encryptedInferenceToken } = encrypted();
    const bufferFromDescriptor = Object.getOwnPropertyDescriptor(Buffer, "from");
    const allocUnsafeDescriptor = Object.getOwnPropertyDescriptor(Buffer, "allocUnsafe");
    const toStringDescriptor = Object.getOwnPropertyDescriptor(Buffer.prototype, "toString");
    const lengthDescriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(Uint8Array.prototype),
      "length",
    );
    const utf8SliceDescriptor = Object.getOwnPropertyDescriptor(Buffer.prototype, "utf8Slice");
    const utf8WriteDescriptor = Object.getOwnPropertyDescriptor(Buffer.prototype, "utf8Write");
    const privateKeyPrototype = Object.getPrototypeOf(keyPair.privateKey);
    const exportProperty = findPrototypeDescriptor(privateKeyPrototype, "export");
    const typeProperty = findPrototypeDescriptor(privateKeyPrototype, "type");
    const asymmetricKeyTypeProperty = findPrototypeDescriptor(
      privateKeyPrototype,
      "asymmetricKeyType",
    );
    const asymmetricKeyDetailsProperty = findPrototypeDescriptor(
      privateKeyPrototype,
      "asymmetricKeyDetails",
    );
    if (
      !bufferFromDescriptor?.configurable || typeof bufferFromDescriptor.value !== "function" ||
      !allocUnsafeDescriptor?.configurable || typeof allocUnsafeDescriptor.value !== "function" ||
      !toStringDescriptor?.configurable || typeof toStringDescriptor.value !== "function" ||
      typeof lengthDescriptor?.get !== "function" ||
      !exportProperty.descriptor.configurable ||
      typeof exportProperty.descriptor.value !== "function" ||
      !typeProperty.descriptor.configurable || typeof typeProperty.descriptor.get !== "function" ||
      !asymmetricKeyTypeProperty.descriptor.configurable ||
      typeof asymmetricKeyTypeProperty.descriptor.get !== "function" ||
      !asymmetricKeyDetailsProperty.descriptor.configurable ||
      typeof asymmetricKeyDetailsProperty.descriptor.get !== "function"
    ) {
      throw new Error("Expected mutable Node hooks to be replaceable for this regression test");
    }
    const originalFrom = bufferFromDescriptor.value as typeof Buffer.from;
    const originalAllocUnsafe = allocUnsafeDescriptor.value as typeof Buffer.allocUnsafe;
    const originalToString = toStringDescriptor.value as typeof Buffer.prototype.toString;
    const originalLength = lengthDescriptor.get;
    const originalExport = exportProperty.descriptor.value as (...args: unknown[]) => unknown;
    const originalType = typeProperty.descriptor.get;
    const originalAsymmetricKeyType = asymmetricKeyTypeProperty.descriptor.get;
    const originalAsymmetricKeyDetails = asymmetricKeyDetailsProperty.descriptor.get;
    const retainedAllocations: Buffer[] = [];
    const observed: string[] = [];
    let observedPrivateKeyHandle = false;
    Object.defineProperty(Buffer, "from", {
      ...bufferFromDescriptor,
      value(value: unknown, ...args: unknown[]) {
        if (
          typeof value === "string" &&
          (value.includes("PRIVATE KEY") || value.includes(INFERENCE_TOKEN))
        ) {
          observed.push(`from:${value}`);
        }
        if (value instanceof ArrayBuffer && value.byteLength === 32) {
          observed.push("from:32-byte-array-buffer");
        }
        if (ArrayBuffer.isView(value) && value.byteLength === 32) {
          observed.push("from:32-byte-view");
        }
        return Reflect.apply(originalFrom, this, [value, ...args]);
      },
    });
    Object.defineProperty(Buffer, "allocUnsafe", {
      ...allocUnsafeDescriptor,
      value(...args: unknown[]) {
        const allocated = Reflect.apply(originalAllocUnsafe, this, args) as Buffer;
        retainedAllocations.push(allocated);
        return allocated;
      },
    });
    Object.defineProperty(Buffer.prototype, "toString", {
      ...toStringDescriptor,
      value(...args: unknown[]) {
        const decoded = Reflect.apply(originalToString, this, args) as string;
        if (decoded.includes(INFERENCE_TOKEN)) observed.push(`toString:${decoded}`);
        return decoded;
      },
    });
    Object.defineProperty(Buffer.prototype, "length", {
      configurable: true,
      get() {
        const byteLength = Reflect.apply(originalLength, this, []);
        if (matchesInferenceTokenBytes(this, byteLength)) {
          observed.push("length:plaintext");
        }
        return byteLength;
      },
    });
    if (utf8SliceDescriptor?.configurable && typeof utf8SliceDescriptor.value === "function") {
      const originalUtf8Slice = utf8SliceDescriptor.value as (...args: unknown[]) => string;
      Object.defineProperty(Buffer.prototype, "utf8Slice", {
        ...utf8SliceDescriptor,
        value(...args: unknown[]) {
          const decoded = Reflect.apply(originalUtf8Slice, this, args);
          if (typeof decoded === "string" && decoded.includes(INFERENCE_TOKEN)) {
            observed.push(`utf8Slice:${decoded}`);
          }
          return decoded;
        },
      });
    }
    if (utf8WriteDescriptor?.configurable && typeof utf8WriteDescriptor.value === "function") {
      const originalUtf8Write = utf8WriteDescriptor.value as (...args: unknown[]) => number;
      Object.defineProperty(Buffer.prototype, "utf8Write", {
        ...utf8WriteDescriptor,
        value(value: unknown, ...args: unknown[]) {
          if (
            typeof value === "string" &&
            (value.includes("PRIVATE KEY") || value.includes(INFERENCE_TOKEN))
          ) {
            observed.push(`utf8Write:${value}`);
          }
          return Reflect.apply(originalUtf8Write, this, [value, ...args]);
        },
      });
    }
    Object.defineProperty(exportProperty.prototype, "export", {
      ...exportProperty.descriptor,
      value(...args: unknown[]) {
        const exported = Reflect.apply(originalExport, this, args);
        if (typeof exported === "string" && exported.includes("PRIVATE KEY")) {
          observed.push("privateKeyExport");
        }
        return exported;
      },
    });
    Object.defineProperty(typeProperty.prototype, "type", {
      ...typeProperty.descriptor,
      get() {
        if (this === keyPair.privateKey) observedPrivateKeyHandle = true;
        return Reflect.apply(originalType, this, []);
      },
    });
    Object.defineProperty(asymmetricKeyTypeProperty.prototype, "asymmetricKeyType", {
      ...asymmetricKeyTypeProperty.descriptor,
      get() {
        if (this === keyPair.privateKey) observedPrivateKeyHandle = true;
        return Reflect.apply(originalAsymmetricKeyType, this, []);
      },
    });
    Object.defineProperty(asymmetricKeyDetailsProperty.prototype, "asymmetricKeyDetails", {
      ...asymmetricKeyDetailsProperty.descriptor,
      get() {
        if (this === keyPair.privateKey) observedPrivateKeyHandle = true;
        return Reflect.apply(originalAsymmetricKeyDetails, this, []);
      },
    });
    try {
      assertEquals(
        decryptApplicationInferenceToken({
          privateKey: keyPair.privateKey,
          runId: RUN_ID,
          expiresAt: EXPIRES_AT,
          encryptedInferenceToken,
        }),
        INFERENCE_TOKEN,
      );
    } finally {
      Object.defineProperty(
        asymmetricKeyDetailsProperty.prototype,
        "asymmetricKeyDetails",
        asymmetricKeyDetailsProperty.descriptor,
      );
      Object.defineProperty(
        asymmetricKeyTypeProperty.prototype,
        "asymmetricKeyType",
        asymmetricKeyTypeProperty.descriptor,
      );
      Object.defineProperty(typeProperty.prototype, "type", typeProperty.descriptor);
      Object.defineProperty(exportProperty.prototype, "export", exportProperty.descriptor);
      if (utf8WriteDescriptor?.configurable) {
        Object.defineProperty(Buffer.prototype, "utf8Write", utf8WriteDescriptor);
      }
      if (utf8SliceDescriptor?.configurable) {
        Object.defineProperty(Buffer.prototype, "utf8Slice", utf8SliceDescriptor);
      }
      Reflect.deleteProperty(Buffer.prototype, "length");
      Object.defineProperty(Buffer.prototype, "toString", toStringDescriptor);
      Object.defineProperty(Buffer, "allocUnsafe", allocUnsafeDescriptor);
      Object.defineProperty(Buffer, "from", bufferFromDescriptor);
    }

    const retainedPlaintext = retainedAllocations.some((buffer) => {
      const decoded = Reflect.apply(originalToString, buffer, ["utf8"]);
      return typeof decoded === "string" && decoded.includes(INFERENCE_TOKEN);
    });
    const retainedPrivateBytes = retainedAllocations.some((buffer) => buffer.byteLength === 32);
    assertEquals(observed, []);
    assertEquals(observedPrivateKeyHandle, false);
    assertEquals(retainedPlaintext, false);
    assertEquals(retainedPrivateBytes, false);
  });
  it("does not expose plaintext through a hostile Decipher constructor hook", () => {
    const { keyPair, encryptedInferenceToken } = encrypted();
    const fields = decodedEncryptedFields(encryptedInferenceToken);
    const observed: string[] = [];
    const aad = Buffer.from(JSON.stringify({ runId: RUN_ID, expiresAt: EXPIRES_AT }), "utf8");
    const originalHasInstance = Object.getOwnPropertyDescriptor(Decipheriv, Symbol.hasInstance);
    const nativeHasInstance = Function.prototype[Symbol.hasInstance];
    Object.defineProperty(Decipheriv, Symbol.hasInstance, {
      configurable: true,
      value(instance: unknown) {
        if (instance !== null && typeof instance === "object") {
          installOwnContextStealingSetter(instance, {
            aad,
            tag: fields.tag,
            ciphertext: fields.ciphertext,
            observed,
          });
        }
        return Reflect.apply(nativeHasInstance, this, [instance]) as boolean;
      },
    });
    let decrypted = "";
    try {
      decrypted = decryptApplicationInferenceToken({
        privateKey: keyPair.privateKey,
        runId: RUN_ID,
        expiresAt: EXPIRES_AT,
        encryptedInferenceToken,
      });
    } finally {
      restorePropertyDescriptor(Decipheriv, Symbol.hasInstance, originalHasInstance);
    }

    assertEquals(decrypted, INFERENCE_TOKEN);
    assertEquals(observed, []);
  });

  it("does not expose plaintext through inherited decipher context setters", () => {
    const { keyPair, encryptedInferenceToken } = encrypted();
    const fields = decodedEncryptedFields(encryptedInferenceToken);
    const observed: string[] = [];
    const aad = Buffer.from(JSON.stringify({ runId: RUN_ID, expiresAt: EXPIRES_AT }), "utf8");
    const decipherPrototype = Decipheriv.prototype;
    const originalObjectContext = installContextStealingSetter(Object.prototype, {
      aad,
      tag: fields.tag,
      ciphertext: fields.ciphertext,
      observed,
    });
    const originalDecipherContext = installContextStealingSetter(decipherPrototype, {
      aad,
      tag: fields.tag,
      ciphertext: fields.ciphertext,
      observed,
    });
    let decrypted = "";
    try {
      decrypted = decryptApplicationInferenceToken({
        privateKey: keyPair.privateKey,
        runId: RUN_ID,
        expiresAt: EXPIRES_AT,
        encryptedInferenceToken,
      });
    } finally {
      restorePropertyDescriptor(decipherPrototype, "_context", originalDecipherContext);
      restorePropertyDescriptor(Object.prototype, "_context", originalObjectContext);
    }

    assertEquals(decrypted, INFERENCE_TOKEN);
    assertEquals(observed, []);
  });

  it("fails closed when the decipher prototype chain changes before decrypting", () => {
    const { keyPair, encryptedInferenceToken } = encrypted();
    const fields = decodedEncryptedFields(encryptedInferenceToken);
    const observed: string[] = [];
    const aad = Buffer.from(JSON.stringify({ runId: RUN_ID, expiresAt: EXPIRES_AT }), "utf8");
    const decipherPrototype = Decipheriv.prototype;
    const originalParent = Object.getPrototypeOf(decipherPrototype);
    const evilParent = Object.create(originalParent);
    installContextStealingSetter(evilParent, {
      aad,
      tag: fields.tag,
      ciphertext: fields.ciphertext,
      observed,
    });
    Object.setPrototypeOf(decipherPrototype, evilParent);
    try {
      assertThrows(() =>
        decryptApplicationInferenceToken({
          privateKey: keyPair.privateKey,
          runId: RUN_ID,
          expiresAt: EXPIRES_AT,
          encryptedInferenceToken,
        })
      );
    } finally {
      Object.setPrototypeOf(decipherPrototype, originalParent);
    }

    assertEquals(observed, []);
  });

  it("does not consult inherited descriptor callbacks while decrypting", () => {
    const { keyPair, encryptedInferenceToken } = encrypted();
    const originalValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
    const originalGet = Object.getOwnPropertyDescriptor(Object.prototype, "get");
    const originalSet = Object.getOwnPropertyDescriptor(Object.prototype, "set");
    let callbacks = 0;
    Object.defineProperty(
      Object.prototype,
      "value",
      testAccessorDescriptor(() => {
        callbacks += 1;
        return undefined;
      }),
    );
    Object.defineProperty(
      Object.prototype,
      "get",
      testAccessorDescriptor(() => {
        callbacks += 1;
        return undefined;
      }),
    );
    Object.defineProperty(
      Object.prototype,
      "set",
      testAccessorDescriptor(() => {
        callbacks += 1;
        return undefined;
      }),
    );
    let decrypted = "";
    try {
      decrypted = decryptApplicationInferenceToken({
        privateKey: keyPair.privateKey,
        runId: RUN_ID,
        expiresAt: EXPIRES_AT,
        encryptedInferenceToken,
      });
    } finally {
      if (originalSet) Object.defineProperty(Object.prototype, "set", originalSet);
      else Reflect.deleteProperty(Object.prototype, "set");
      if (originalGet) Object.defineProperty(Object.prototype, "get", originalGet);
      else Reflect.deleteProperty(Object.prototype, "get");
      if (originalValue) Object.defineProperty(Object.prototype, "value", originalValue);
      else Reflect.deleteProperty(Object.prototype, "value");
    }

    assertEquals(decrypted, INFERENCE_TOKEN);
    assertEquals(callbacks, 0);
  });
});
