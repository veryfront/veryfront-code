import { Deno } from "@deno/shim-deno";
export { Deno } from "@deno/shim-deno";
import { Blob } from "buffer";
export { Blob } from "buffer";
import { crypto } from "@deno/shim-crypto";
export { crypto, type Crypto, type SubtleCrypto, type AlgorithmIdentifier, type Algorithm, type RsaOaepParams, type BufferSource, type AesCtrParams, type AesCbcParams, type AesGcmParams, type CryptoKey, type KeyAlgorithm, type KeyType, type KeyUsage, type EcdhKeyDeriveParams, type HkdfParams, type HashAlgorithmIdentifier, type Pbkdf2Params, type AesDerivedKeyParams, type HmacImportParams, type JsonWebKey, type RsaOtherPrimesInfo, type KeyFormat, type RsaHashedKeyGenParams, type RsaKeyGenParams, type BigInteger, type EcKeyGenParams, type NamedCurve, type CryptoKeyPair, type AesKeyGenParams, type HmacKeyGenParams, type RsaHashedImportParams, type EcKeyImportParams, type AesKeyAlgorithm, type RsaPssParams, type EcdsaParams } from "@deno/shim-crypto";
import { setInterval, setTimeout } from "@deno/shim-timers";
export { setInterval, setTimeout } from "@deno/shim-timers";
import { fetch, File, FormData, Headers, Request, Response } from "undici";
export { fetch, File, FormData, Headers, Request, Response, type BodyInit, type HeadersInit, type ReferrerPolicy, type RequestInit, type RequestCache, type RequestMode, type RequestRedirect, type ResponseInit } from "undici";

const dntGlobals = {
  Deno,
  Blob,
  crypto,
  setInterval,
  setTimeout,
  fetch,
  File,
  FormData,
  Headers,
  Request,
  Response,
};
export const dntGlobalThis = createMergeProxy(globalThis, dntGlobals);

function createMergeProxy<T extends object, U extends object>(
  baseObj: T,
  extObj: U,
): Omit<T, keyof U> & U {
  return new Proxy(baseObj, {
    get(_target, prop, _receiver) {
      if (prop in extObj) {
        return (extObj as any)[prop];
      } else {
        return (baseObj as any)[prop];
      }
    },
    set(_target, prop, value) {
      if (prop in extObj) {
        delete (extObj as any)[prop];
      }
      (baseObj as any)[prop] = value;
      return true;
    },
    deleteProperty(_target, prop) {
      let success = false;
      if (prop in extObj) {
        delete (extObj as any)[prop];
        success = true;
      }
      if (prop in baseObj) {
        delete (baseObj as any)[prop];
        success = true;
      }
      return success;
    },
    ownKeys(_target) {
      const baseKeys = Reflect.ownKeys(baseObj);
      const extKeys = Reflect.ownKeys(extObj);
      const extKeysSet = new Set(extKeys);
      return [...baseKeys.filter((k) => !extKeysSet.has(k)), ...extKeys];
    },
    defineProperty(_target, prop, desc) {
      if (prop in extObj) {
        delete (extObj as any)[prop];
      }
      Reflect.defineProperty(baseObj, prop, desc);
      return true;
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (prop in extObj) {
        return Reflect.getOwnPropertyDescriptor(extObj, prop);
      } else {
        return Reflect.getOwnPropertyDescriptor(baseObj, prop);
      }
    },
    has(_target, prop) {
      return prop in extObj || prop in baseObj;
    },
  }) as any;
}
