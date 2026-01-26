export { Deno } from "@deno/shim-deno";
import { Blob } from "buffer";
export { Blob } from "buffer";
export { crypto, type Crypto, type SubtleCrypto, type AlgorithmIdentifier, type Algorithm, type RsaOaepParams, type BufferSource, type AesCtrParams, type AesCbcParams, type AesGcmParams, type CryptoKey, type KeyAlgorithm, type KeyType, type KeyUsage, type EcdhKeyDeriveParams, type HkdfParams, type HashAlgorithmIdentifier, type Pbkdf2Params, type AesDerivedKeyParams, type HmacImportParams, type JsonWebKey, type RsaOtherPrimesInfo, type KeyFormat, type RsaHashedKeyGenParams, type RsaKeyGenParams, type BigInteger, type EcKeyGenParams, type NamedCurve, type CryptoKeyPair, type AesKeyGenParams, type HmacKeyGenParams, type RsaHashedImportParams, type EcKeyImportParams, type AesKeyAlgorithm, type RsaPssParams, type EcdsaParams } from "@deno/shim-crypto";
export { setInterval, setTimeout } from "@deno/shim-timers";
export { fetch, File, FormData, Headers, Request, Response, type BodyInit, type HeadersInit, type ReferrerPolicy, type RequestInit, type RequestCache, type RequestMode, type RequestRedirect, type ResponseInit } from "undici";
export declare const dntGlobalThis: Omit<typeof globalThis, "fetch" | "setInterval" | "setTimeout" | "Blob" | "File" | "FormData" | "Headers" | "Request" | "Response" | "crypto" | "Deno"> & {
    Deno: any;
    Blob: typeof Blob;
    crypto: any;
    setInterval: any;
    setTimeout: any;
    fetch: any;
    File: any;
    FormData: any;
    Headers: any;
    Request: any;
    Response: any;
};
//# sourceMappingURL=_dnt.shims.d.ts.map