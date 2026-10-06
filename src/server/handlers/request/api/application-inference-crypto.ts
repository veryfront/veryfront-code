import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  Decipheriv,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  KeyObject,
  randomBytes,
} from "node:crypto";

const AES_KEY_BYTES = 32;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
export const MAX_APPLICATION_INFERENCE_TOKEN_BYTES = 6000;
export const MAX_ENCRYPTED_INFERENCE_TOKEN_FIELD_BYTES = 8192;
const JSON_STRINGIFY = JSON.stringify;
const utf8Decoder = new TextDecoder();
const textDecoderDecode = TextDecoder.prototype.decode;
const createObject = Object.create;
const defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const hasOwn = Object.hasOwn;
const ownKeys = Reflect.ownKeys;
const deleteProperty = Reflect.deleteProperty;
const bufferFrom = Buffer.from;
const bufferFromDescriptor = clonePropertyDescriptor(getOwnPropertyDescriptor(Buffer, "from")!);
const bufferAllocUnsafe = Buffer.allocUnsafe;
const bufferAllocUnsafeDescriptor = clonePropertyDescriptor(
  getOwnPropertyDescriptor(Buffer, "allocUnsafe")!,
);
const bufferAlloc = Buffer.alloc;
const bufferToString = Buffer.prototype.toString;
const bufferFill = Buffer.prototype.fill;
const uint8ArraySet = Uint8Array.prototype.set;
const typedArrayLength = getOwnPropertyDescriptor(getPrototypeOf(Uint8Array.prototype), "length")!
  .get!;
const apply = Reflect.apply;
const bootstrapKeyPair = generateKeyPairSync("x25519");
const publicKeyExport = getPrototypeOf(bootstrapKeyPair.publicKey).export;
const privateKeyPrototype = getPrototypeOf(bootstrapKeyPair.privateKey);

function dataDescriptor(
  value: unknown,
  writable = false,
  enumerable = false,
  configurable = false,
): PropertyDescriptor {
  const descriptor = createObject(null) as PropertyDescriptor;
  descriptor.value = value;
  descriptor.writable = writable;
  descriptor.enumerable = enumerable;
  descriptor.configurable = configurable;
  return descriptor;
}

function clonePropertyDescriptor(descriptor: PropertyDescriptor): PropertyDescriptor {
  const clone = createObject(null) as PropertyDescriptor;
  if (hasOwn(descriptor, "value")) clone.value = descriptor.value;
  if (hasOwn(descriptor, "writable")) clone.writable = descriptor.writable;
  if (hasOwn(descriptor, "get")) clone.get = descriptor.get;
  if (hasOwn(descriptor, "set")) clone.set = descriptor.set;
  clone.enumerable = descriptor.enumerable;
  clone.configurable = descriptor.configurable;
  return clone;
}

const spkiDerExportOptions = createObject(null) as {
  readonly type: "spki";
  readonly format: "der";
};
defineProperty(spkiDerExportOptions, "type", dataDescriptor("spki", false, true));
defineProperty(spkiDerExportOptions, "format", dataDescriptor("der", false, true));
interface CapturedPrototypeProperty {
  readonly owner: object;
  readonly property: string;
  readonly descriptor: PropertyDescriptor;
  readonly shadowPrototypes: readonly object[];
}

interface PrototypePropertySnapshot {
  readonly target: object;
  readonly property: string;
  readonly descriptor: PropertyDescriptor | undefined;
}

interface CapturedOwnProperty {
  readonly key: PropertyKey;
  readonly descriptor: PropertyDescriptor;
}

interface OwnPropertySnapshot {
  readonly key: PropertyKey;
  readonly descriptor: PropertyDescriptor;
}

interface PrototypeBaseline {
  readonly target: object;
  readonly parent: object | null;
  readonly properties: readonly CapturedOwnProperty[];
}

interface PrototypeBaselineSnapshot {
  readonly target: object;
  readonly properties: readonly OwnPropertySnapshot[];
}

function appendCapturedOwnProperty(
  properties: CapturedOwnProperty[],
  property: CapturedOwnProperty,
): void {
  defineProperty(properties, properties.length, dataDescriptor(property, true, true, true));
}

function appendOwnPropertySnapshot(
  snapshots: OwnPropertySnapshot[],
  snapshot: OwnPropertySnapshot,
): void {
  defineProperty(snapshots, snapshots.length, dataDescriptor(snapshot, true, true, true));
}

function appendPrototypeBaseline(
  baselines: PrototypeBaseline[],
  baseline: PrototypeBaseline,
): void {
  defineProperty(baselines, baselines.length, dataDescriptor(baseline, true, true, true));
}

function appendPrototypeBaselineSnapshot(
  snapshots: PrototypeBaselineSnapshot[],
  snapshot: PrototypeBaselineSnapshot,
): void {
  defineProperty(snapshots, snapshots.length, dataDescriptor(snapshot, true, true, true));
}

function captureOwnProperties<Target extends object>(target: Target): CapturedOwnProperty[] {
  const properties: CapturedOwnProperty[] = [];
  const keys = ownKeys(target);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) throw new TypeError("Own property key is invalid");
    const descriptor = getOwnPropertyDescriptor(target, key);
    if (!descriptor) throw new TypeError("Own property descriptor is unavailable");
    appendCapturedOwnProperty(properties, { key, descriptor: clonePropertyDescriptor(descriptor) });
  }
  return properties;
}

function findCapturedOwnProperty(
  properties: readonly CapturedOwnProperty[],
  key: PropertyKey,
): CapturedOwnProperty | undefined {
  for (let index = 0; index < properties.length; index += 1) {
    const property = properties[index];
    if (property === undefined) throw new TypeError("Own property snapshot is invalid");
    if (property.key === key) return property;
  }
  return undefined;
}

function hasPrototypeBaseline<Target extends object>(
  baselines: readonly PrototypeBaseline[],
  target: Target,
): boolean {
  for (let index = 0; index < baselines.length; index += 1) {
    const baseline = baselines[index];
    if (baseline === undefined) throw new TypeError("Prototype baseline is invalid");
    if (baseline.target === target) return true;
  }
  return false;
}

function appendPrototypeChainBaselines<Target extends object>(
  baselines: PrototypeBaseline[],
  start: Target,
): void {
  let prototype: object | null = start;
  while (prototype !== null) {
    if (!hasPrototypeBaseline(baselines, prototype)) {
      appendPrototypeBaseline(baselines, {
        target: prototype,
        parent: getPrototypeOf(prototype),
        properties: captureOwnProperties(prototype),
      });
    }
    prototype = getPrototypeOf(prototype);
  }
}

function capturePrototypeBaselines(starts: readonly object[]): PrototypeBaseline[] {
  const baselines: PrototypeBaseline[] = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    if (start === undefined) throw new TypeError("Prototype baseline target is invalid");
    appendPrototypeChainBaselines(baselines, start);
  }
  return baselines;
}

function capturePrototypeProperty<Target extends object>(
  start: Target,
  property: string,
): CapturedPrototypeProperty {
  const shadowPrototypes: object[] = [];
  let prototype: object | null = start;
  while (prototype !== null) {
    const descriptor = getOwnPropertyDescriptor(prototype, property);
    if (descriptor) {
      return {
        owner: prototype,
        property,
        descriptor: clonePropertyDescriptor(descriptor),
        shadowPrototypes,
      };
    }
    shadowPrototypes.push(prototype);
    prototype = getPrototypeOf(prototype);
  }
  throw new TypeError(`Private key prototype ${property} is unavailable`);
}

const privateKeyExportProperty = capturePrototypeProperty(privateKeyPrototype, "export");
const privateKeyTypeProperty = capturePrototypeProperty(privateKeyPrototype, "type");
const privateKeyAsymmetricKeyTypeProperty = capturePrototypeProperty(
  privateKeyPrototype,
  "asymmetricKeyType",
);
const privateKeyAsymmetricKeyDetailsProperty = capturePrototypeProperty(
  privateKeyPrototype,
  "asymmetricKeyDetails",
);
const bufferLengthProperty = capturePrototypeProperty(Buffer.prototype, "length");
const CipherPrototype = getPrototypeOf(
  createCipheriv("aes-256-gcm", bufferAlloc(AES_KEY_BYTES), bufferAlloc(AES_GCM_IV_BYTES)),
);
const DecipherPrototype = getPrototypeOf(
  createDecipheriv("aes-256-gcm", bufferAlloc(AES_KEY_BYTES), bufferAlloc(AES_GCM_IV_BYTES)),
);
const cipherSetAAD = CipherPrototype.setAAD;
const cipherUpdate = CipherPrototype.update;
const cipherFinal = CipherPrototype.final;
const cipherGetAuthTag = CipherPrototype.getAuthTag;
const decipherSetAAD = DecipherPrototype.setAAD;
const decipherSetAuthTag = DecipherPrototype.setAuthTag;
const decipherUpdate = DecipherPrototype.update;
const decipherFinal = DecipherPrototype.final;
const isolatedPrototypeBaselines = capturePrototypeBaselines([
  Decipheriv,
  KeyObject,
  Buffer,
  DecipherPrototype,
  privateKeyPrototype,
  Buffer.prototype,
]);

export interface ApplicationInferenceEncryptionKeyPair {
  readonly publicKey: string;
  readonly privateKey: KeyObject;
}

export interface EncryptedInferenceToken {
  readonly ephemeralPublicKey: string;
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
}

function byteLengthOf(value: Uint8Array): number {
  return apply(typedArrayLength, value, []) as number;
}

function concatBuffers(parts: readonly Buffer[]): Buffer {
  let length = 0;
  for (const part of parts) length += byteLengthOf(part);
  const output = bufferAlloc(length);
  let offset = 0;
  for (const part of parts) {
    apply(uint8ArraySet, output, [part, offset]);
    offset += byteLengthOf(part);
  }
  return output;
}

function deleteOwnProperty<Target extends object>(target: Target, property: string): void {
  if (!deleteProperty(target, property)) {
    throw new TypeError(`Private key prototype ${property} could not be restored`);
  }
}

function restorePrototypeSnapshot(snapshot: PrototypePropertySnapshot): void {
  if (snapshot.descriptor) {
    defineProperty(snapshot.target, snapshot.property, snapshot.descriptor);
    return;
  }
  deleteOwnProperty(snapshot.target, snapshot.property);
}

function appendPrototypeSnapshot(
  snapshots: PrototypePropertySnapshot[],
  snapshot: PrototypePropertySnapshot,
): void {
  defineProperty(snapshots, snapshots.length, dataDescriptor(snapshot, true, true, true));
}

function replacePrototypeProperty<Target extends object>(
  snapshots: PrototypePropertySnapshot[],
  target: Target,
  property: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  const currentDescriptor = getOwnPropertyDescriptor(target, property);
  if (!currentDescriptor) {
    if (!descriptor) return;
    appendPrototypeSnapshot(snapshots, { target, property, descriptor: undefined });
    defineProperty(target, property, descriptor);
    return;
  }
  if (!currentDescriptor.configurable) {
    throw new TypeError(`Private key prototype ${property} is not configurable`);
  }
  appendPrototypeSnapshot(snapshots, {
    target,
    property,
    descriptor: clonePropertyDescriptor(currentDescriptor),
  });
  if (descriptor) defineProperty(target, property, descriptor);
  else deleteOwnProperty(target, property);
}

function restoreCapturedPrivateKeyProperty(
  snapshots: PrototypePropertySnapshot[],
  captured: CapturedPrototypeProperty,
): void {
  for (let shadowIndex = 0; shadowIndex < captured.shadowPrototypes.length; shadowIndex += 1) {
    const shadowPrototype = captured.shadowPrototypes[shadowIndex];
    if (shadowPrototype === undefined) {
      throw new TypeError("Private key prototype snapshot is invalid");
    }
    replacePrototypeProperty(snapshots, shadowPrototype, captured.property, undefined);
  }
  replacePrototypeProperty(snapshots, captured.owner, captured.property, captured.descriptor);
}

function isolatePrototypeBaseline(baseline: PrototypeBaseline): PrototypeBaselineSnapshot {
  if (getPrototypeOf(baseline.target) !== baseline.parent) {
    throw new TypeError("Prototype chain changed during private crypto operation");
  }
  const snapshots: OwnPropertySnapshot[] = [];
  const keys = ownKeys(baseline.target);
  try {
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (key === undefined) throw new TypeError("Prototype property key is invalid");
      const currentDescriptor = getOwnPropertyDescriptor(baseline.target, key);
      if (!currentDescriptor) continue;
      appendOwnPropertySnapshot(snapshots, {
        key,
        descriptor: clonePropertyDescriptor(currentDescriptor),
      });
      const captured = findCapturedOwnProperty(baseline.properties, key);
      if (captured) {
        defineProperty(baseline.target, key, captured.descriptor);
      } else if (!currentDescriptor.configurable || !deleteProperty(baseline.target, key)) {
        throw new TypeError("Prototype property could not be isolated");
      }
    }
  } catch (error) {
    for (let index = snapshots.length - 1; index >= 0; index -= 1) {
      const snapshot = snapshots[index];
      if (snapshot !== undefined) {
        defineProperty(baseline.target, snapshot.key, snapshot.descriptor);
      }
    }
    throw error;
  }
  return { target: baseline.target, properties: snapshots };
}

function isolatePrivateCryptoPrototypes(): PrototypeBaselineSnapshot[] {
  const snapshots: PrototypeBaselineSnapshot[] = [];
  try {
    for (let index = 0; index < isolatedPrototypeBaselines.length; index += 1) {
      const baseline = isolatedPrototypeBaselines[index];
      if (baseline === undefined) throw new TypeError("Prototype baseline is invalid");
      appendPrototypeBaselineSnapshot(snapshots, isolatePrototypeBaseline(baseline));
    }
  } catch (error) {
    restorePrivateCryptoPrototypes(snapshots);
    throw error;
  }
  return snapshots;
}

function restoreIsolatedPrototype(snapshot: PrototypeBaselineSnapshot): void {
  const baseline = findPrototypeBaseline(snapshot.target);
  const keys = ownKeys(snapshot.target);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (key === undefined) throw new TypeError("Prototype property key is invalid");
    if (!findCapturedOwnProperty(baseline.properties, key)) {
      const descriptor = getOwnPropertyDescriptor(snapshot.target, key);
      if (descriptor && (!descriptor.configurable || !deleteProperty(snapshot.target, key))) {
        throw new TypeError("Prototype property could not be restored");
      }
    }
  }
  for (let index = snapshot.properties.length - 1; index >= 0; index -= 1) {
    const property = snapshot.properties[index];
    if (property !== undefined) defineProperty(snapshot.target, property.key, property.descriptor);
  }
}

function findPrototypeBaseline<Target extends object>(target: Target): PrototypeBaseline {
  for (let index = 0; index < isolatedPrototypeBaselines.length; index += 1) {
    const baseline = isolatedPrototypeBaselines[index];
    if (baseline === undefined) throw new TypeError("Prototype baseline is invalid");
    if (baseline.target === target) return baseline;
  }
  throw new TypeError("Prototype baseline is unavailable");
}

function restorePrivateCryptoPrototypes(snapshots: readonly PrototypeBaselineSnapshot[]): void {
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const snapshot = snapshots[index];
    if (snapshot !== undefined) restoreIsolatedPrototype(snapshot);
  }
}

function restoreCapturedPrivateKeyPrototypes(): PrototypePropertySnapshot[] {
  const snapshots: PrototypePropertySnapshot[] = [];
  try {
    restoreCapturedPrivateKeyProperty(snapshots, privateKeyExportProperty);
    restoreCapturedPrivateKeyProperty(snapshots, privateKeyTypeProperty);
    restoreCapturedPrivateKeyProperty(snapshots, privateKeyAsymmetricKeyTypeProperty);
    restoreCapturedPrivateKeyProperty(snapshots, privateKeyAsymmetricKeyDetailsProperty);
    restoreCapturedPrivateKeyProperty(snapshots, bufferLengthProperty);
  } catch (error) {
    for (let index = snapshots.length - 1; index >= 0; index -= 1) {
      const snapshot = snapshots[index];
      if (snapshot === undefined) {
        throw new TypeError("Private key prototype snapshot is invalid");
      }
      restorePrototypeSnapshot(snapshot);
    }
    throw error;
  }
  return snapshots;
}

// Deno diffieHellman and decipher.update currently resolve private material through mutable
// Buffer.from, Buffer.allocUnsafe, and KeyObject prototype properties. This guard restores
// captured intrinsics only for one synchronous crypto operation; it does not cross an await or
// invoke tenant callbacks.
function withCapturedPrivateCryptoIntrinsics<Result>(operation: () => Result): Result {
  const currentBufferFromDescriptor = getOwnPropertyDescriptor(Buffer, "from");
  const currentBufferAllocUnsafeDescriptor = getOwnPropertyDescriptor(Buffer, "allocUnsafe");
  if (!currentBufferFromDescriptor?.configurable) {
    throw new TypeError("Buffer.from is not configurable");
  }
  if (!currentBufferAllocUnsafeDescriptor?.configurable) {
    throw new TypeError("Buffer.allocUnsafe is not configurable");
  }
  const restoreBufferFromDescriptor = clonePropertyDescriptor(currentBufferFromDescriptor);
  const restoreBufferAllocUnsafeDescriptor = clonePropertyDescriptor(
    currentBufferAllocUnsafeDescriptor,
  );
  const restoreBufferFrom = restoreBufferFromDescriptor.value !== bufferFrom;
  const restoreBufferAllocUnsafe = restoreBufferAllocUnsafeDescriptor.value !== bufferAllocUnsafe;
  const isolatedPrototypeSnapshots = isolatePrivateCryptoPrototypes();
  const prototypeSnapshots = restoreCapturedPrivateKeyPrototypes();
  if (restoreBufferFrom) defineProperty(Buffer, "from", bufferFromDescriptor);
  if (restoreBufferAllocUnsafe) {
    defineProperty(Buffer, "allocUnsafe", bufferAllocUnsafeDescriptor);
  }
  try {
    return operation();
  } finally {
    for (let index = prototypeSnapshots.length - 1; index >= 0; index -= 1) {
      const snapshot = prototypeSnapshots[index];
      if (snapshot !== undefined) restorePrototypeSnapshot(snapshot);
    }
    restorePrivateCryptoPrototypes(isolatedPrototypeSnapshots);
    if (restoreBufferAllocUnsafe) {
      defineProperty(Buffer, "allocUnsafe", restoreBufferAllocUnsafeDescriptor);
    }
    if (restoreBufferFrom) defineProperty(Buffer, "from", restoreBufferFromDescriptor);
  }
}

export function generateApplicationInferenceEncryptionKeyPair(): ApplicationInferenceEncryptionKeyPair {
  const generated = generateKeyPairSync("x25519");
  const pair = createObject(null) as ApplicationInferenceEncryptionKeyPair & {
    readonly then?: undefined;
  };
  defineProperty(
    pair,
    "publicKey",
    dataDescriptor(
      apply(
        bufferToString,
        apply(publicKeyExport, generated.publicKey, [spkiDerExportOptions]) as Buffer,
        ["base64"],
      ),
      false,
      true,
    ),
  );
  defineProperty(pair, "privateKey", dataDescriptor(generated.privateKey, false, true));
  defineProperty(pair, "then", dataDescriptor(undefined));
  return pair;
}

function additionalData(runId: string, expiresAt: string): Buffer {
  return bufferFrom(JSON_STRINGIFY({ runId, expiresAt }), "utf8");
}

function decodeBase64(value: string, label: string): Buffer {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_ENCRYPTED_INFERENCE_TOKEN_FIELD_BYTES
  ) {
    throw new TypeError(`Encrypted inference token ${label} is invalid`);
  }
  const decoded = bufferFrom(value, "base64");
  if (byteLengthOf(decoded) === 0 || apply(bufferToString, decoded, ["base64"]) !== value) {
    throw new TypeError(`Encrypted inference token ${label} is invalid`);
  }
  return decoded;
}

function deriveApplicationInferenceKey(
  input: { readonly privateKey: KeyObject; readonly publicKey: string; readonly aad: Buffer },
): Buffer {
  const publicKeyDer = decodeBase64(input.publicKey, "publicKey");
  const publicKey = createPublicKey({ key: publicKeyDer, format: "der", type: "spki" });
  return withCapturedPrivateCryptoIntrinsics(() => {
    const sharedSecret = diffieHellman({ privateKey: input.privateKey, publicKey });
    try {
      const derivedKey = hkdfSync("sha256", sharedSecret, bufferAlloc(0), input.aad, AES_KEY_BYTES);
      return bufferFrom(derivedKey);
    } finally {
      apply(bufferFill, sharedSecret, [0]);
    }
  });
}

export function encryptApplicationInferenceToken(
  input: {
    readonly publicKey: string;
    readonly runId: string;
    readonly expiresAt: string;
    readonly inferenceToken: string;
  },
): EncryptedInferenceToken {
  const tokenBytes = bufferFrom(input.inferenceToken, "utf8");
  if (byteLengthOf(tokenBytes) > MAX_APPLICATION_INFERENCE_TOKEN_BYTES) {
    throw new TypeError("Application inference token is too large");
  }
  const ephemeral = generateApplicationInferenceEncryptionKeyPair();
  const aad = additionalData(input.runId, input.expiresAt);
  const key = deriveApplicationInferenceKey({
    privateKey: ephemeral.privateKey,
    publicKey: input.publicKey,
    aad,
  });
  try {
    const iv = randomBytes(AES_GCM_IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    apply(cipherSetAAD, cipher, [aad]);
    const ciphertext = concatBuffers([
      apply(cipherUpdate, cipher, [tokenBytes]) as Buffer,
      apply(cipherFinal, cipher, []) as Buffer,
    ]);
    const tag = apply(cipherGetAuthTag, cipher, []) as Buffer;
    return {
      ephemeralPublicKey: ephemeral.publicKey,
      iv: apply(bufferToString, iv, ["base64"]) as string,
      tag: apply(bufferToString, tag, ["base64"]) as string,
      ciphertext: apply(bufferToString, ciphertext, ["base64"]) as string,
    };
  } finally {
    apply(bufferFill, tokenBytes, [0]);
    apply(bufferFill, key, [0]);
  }
}

export function decryptApplicationInferenceToken(
  input: {
    readonly privateKey: KeyObject;
    readonly runId: string;
    readonly expiresAt: string;
    readonly encryptedInferenceToken: EncryptedInferenceToken;
  },
): string {
  const iv = decodeBase64(input.encryptedInferenceToken.iv, "iv");
  const tag = decodeBase64(input.encryptedInferenceToken.tag, "tag");
  const ciphertext = decodeBase64(input.encryptedInferenceToken.ciphertext, "ciphertext");
  if (byteLengthOf(iv) !== AES_GCM_IV_BYTES || byteLengthOf(tag) !== AES_GCM_TAG_BYTES) {
    throw new TypeError("Encrypted inference token metadata is invalid");
  }
  const aad = additionalData(input.runId, input.expiresAt);
  const key = deriveApplicationInferenceKey({
    privateKey: input.privateKey,
    publicKey: input.encryptedInferenceToken.ephemeralPublicKey,
    aad,
  });
  const plaintext = withCapturedPrivateCryptoIntrinsics(() => {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      apply(decipherSetAAD, decipher, [aad]);
      apply(decipherSetAuthTag, decipher, [tag]);
      const updated = apply(decipherUpdate, decipher, [ciphertext]) as Buffer;
      const final = apply(decipherFinal, decipher, []) as Buffer;
      if (
        byteLengthOf(final) !== 0 || byteLengthOf(updated) > MAX_APPLICATION_INFERENCE_TOKEN_BYTES
      ) {
        throw new TypeError("Encrypted inference token plaintext is invalid");
      }
      return updated;
    } finally {
      apply(bufferFill, key, [0]);
    }
  });
  try {
    return withCapturedPrivateCryptoIntrinsics(() =>
      apply(textDecoderDecode, utf8Decoder, [plaintext]) as string
    );
  } finally {
    withCapturedPrivateCryptoIntrinsics(() => {
      apply(bufferFill, plaintext, [0]);
    });
  }
}
